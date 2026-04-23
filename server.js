import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const BACKUP = path.join(PUBLIC, 'backup');

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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/savePortfolio') return saveHandler(req, res, 'portfolio.csv');
  if (req.method === 'POST' && req.url === '/saveRealized') return saveHandler(req, res, 'realized.csv');

  res.writeHead(404);
  res.end();
});

server.listen(3001, () => console.log('API server on http://localhost:3001'));
