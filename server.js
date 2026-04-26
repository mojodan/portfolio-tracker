import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Node's native fetch (undici) rejects Yahoo Finance due to header count overflow.
// Use the built-in https module with maxHeaderSize instead.
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': YF_UA }, maxHeaderSize: 131072 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function fetchOneQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const r = await httpsGet(url);
  if (r.status !== 200) throw new Error(`Yahoo Finance HTTP ${r.status} for ${symbol}`);
  const meta = JSON.parse(r.body)?.chart?.result?.[0]?.meta;
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
    if (!symbols.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No symbols provided' }));
    }
    try {
      const out = await fetchYahooQuotes(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      console.error('Quote error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(404);
  res.end();
});

server.listen(3001, '0.0.0.0', () => console.log('API server on http://0.0.0.0:3001'));
