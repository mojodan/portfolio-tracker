import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Node's native fetch (undici) rejects Yahoo Finance due to header count overflow.
// Use the built-in https module with maxHeaderSize instead.
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function httpsGet(url, extraHeaders = {}, log = false) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (log) apiLog('REQUEST', null, { url });
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': YF_UA, ...extraHeaders }, maxHeaderSize: 131072 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (log) apiLog('RESPONSE', res.statusCode, body);
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    }).on('error', reject);
  });
}

// Yahoo Finance now requires a crumb + cookie for API calls, especially for international symbols.
let yf_crumb = null;
let yf_cookie = null;
let yf_crumb_fetched_at = 0;
const CRUMB_TTL_MS = 55 * 60 * 1000; // 55 minutes

async function refreshYahooCrumb() {
  // Step 1: Visit Yahoo Finance to get session cookies
  const cookieRes = await new Promise((resolve, reject) => {
    https.get({
      hostname: 'finance.yahoo.com',
      path: '/quote/AAPL',
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html' },
      maxHeaderSize: 131072
    }, res => {
      let body = '';
      const rawCookies = res.headers['set-cookie'] || [];
      // Extract name=value from each Set-Cookie header
      const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ cookie }));
    }).on('error', reject);
  });
  yf_cookie = cookieRes.cookie;

  // Step 2: Fetch the crumb using the session cookie
  const crumbRes = await httpsGet(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    { 'Cookie': yf_cookie }
  );
  if (crumbRes.status !== 200 || !crumbRes.body || crumbRes.body.includes('{')) {
    throw new Error(`Failed to get Yahoo crumb (HTTP ${crumbRes.status}): ${crumbRes.body.slice(0, 100)}`);
  }
  yf_crumb = crumbRes.body.trim();
  yf_crumb_fetched_at = Date.now();
  console.log('Yahoo Finance crumb refreshed');
}

async function getYahooCrumb() {
  if (!yf_crumb || Date.now() - yf_crumb_fetched_at > CRUMB_TTL_MS) {
    await refreshYahooCrumb();
  }
  return { crumb: yf_crumb, cookie: yf_cookie };
}

async function fetchOneQuote(symbol) {
  const { crumb, cookie } = await getYahooCrumb();
  const encoded = encodeURIComponent(symbol);
  const qs = `interval=1d&range=1d&crumb=${encodeURIComponent(crumb)}`;
  const headers = { 'Cookie': cookie };

  // Try query2 first — it's more permissive for international/small-cap symbols
  for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
    const r = await httpsGet(`https://${host}/v8/finance/chart/${encoded}?${qs}`, headers, true);
    if (r.status === 401 || r.status === 403) {
      // Crumb expired — refresh once and retry this host
      yf_crumb = null;
      const { crumb: c2, cookie: ck2 } = await getYahooCrumb();
      const qs2 = `interval=1d&range=1d&crumb=${encodeURIComponent(c2)}`;
      const r2 = await httpsGet(`https://${host}/v8/finance/chart/${encoded}?${qs2}`, { 'Cookie': ck2 }, true);
      if (r2.status === 200) return parseQuoteMeta(r2.body, symbol);
    }
    if (r.status === 200) return parseQuoteMeta(r.body, symbol);
    console.warn(`${host} returned ${r.status} for ${symbol}, trying next...`);
  }

  // Last resort: v7 quote endpoint (no chart data needed, just current price)
  const v7 = await httpsGet(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}&fields=regularMarketPrice,regularMarketPreviousClose&crumb=${encodeURIComponent(crumb)}`,
    headers,
    true
  );
  if (v7.status !== 200) throw new Error(`All Yahoo Finance endpoints returned non-200 for ${symbol}`);
  const result = JSON.parse(v7.body)?.quoteResponse?.result?.[0];
  if (!result) return null;
  const price = result.regularMarketPrice ?? null;
  const prevClose = result.regularMarketPreviousClose ?? null;
  const dayChangePct = (price != null && prevClose != null && prevClose !== 0)
    ? ((price - prevClose) / prevClose) * 100
    : null;
  return { price, prevClose, dayChangePct };
}

function parseQuoteMeta(body, symbol) {
  const meta = JSON.parse(body)?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? null;
  const prevClose = meta.chartPreviousClose ?? null;
  const dayChangePct = (price != null && prevClose != null && prevClose !== 0)
    ? ((price - prevClose) / prevClose) * 100
    : null;
  return { price, prevClose, dayChangePct };
}

async function fetchYahooQuotes(symbols) {
  const results = await Promise.allSettled(symbols.map(s => fetchOneQuote(s).then(q => ({ s, q }))));
  const out = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.q) out[r.value.s] = r.value.q;
    else if (r.status === 'rejected') console.warn('Quote failed:', r.reason?.message);
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const BACKUP = path.join(PUBLIC, 'backup');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const API_LOG = path.join(__dirname, 'api.log');

function apiLog(direction, statusCode, payload) {
  const ts = new Date().toISOString();
  const status = statusCode != null ? String(statusCode) : '-';
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const truncated = body.length > 2000 ? body.slice(0, 2000) + '...[truncated]' : body;
  const line = `${ts} | ${status} | ${direction} | ${truncated}\n`;
  fs.appendFileSync(API_LOG, line);
}

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveHandler(req, res, filename) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      fs.mkdirSync(BACKUP, { recursive: true });
      const target = path.join(PUBLIC, filename);
      if (fs.existsSync(target)) {
        fs.copyFileSync(target, path.join(BACKUP, `${timestamp()}-${filename}`));
      }
      fs.writeFileSync(target, body, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/savePortfolio') return saveHandler(req, res, 'portfolio.csv');
  if (req.method === 'POST' && req.url === '/saveRealized') return saveHandler(req, res, 'realized.csv');

  if (req.method === 'POST' && req.url === '/saveSettings') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        fs.writeFileSync(SETTINGS_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/settings') {
    try {
      const content = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, 'utf8') : JSON.stringify({ summaryVisible: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(content);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ summaryVisible: true }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/quotes')) {
    const urlObj = new URL(req.url, 'http://localhost:3001');
    const symbols = (urlObj.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    apiLog('REQUEST', null, { url: req.url, symbols });
    if (!symbols.length) {
      apiLog('RESPONSE', 400, { error: 'No symbols provided' });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No symbols provided' }));
    }
    try {
      const out = await fetchYahooQuotes(symbols);
      apiLog('RESPONSE', 200, out);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      console.error('Quote error:', e.message);
      apiLog('RESPONSE', 502, { error: e.message });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(404);
  res.end();
});

server.listen(3001, '0.0.0.0', () => console.log('API server on http://0.0.0.0:3001'));
