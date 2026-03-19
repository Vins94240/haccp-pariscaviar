const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_KEY;
const FB_PROJECT = 'paris-caviar-haccp';
const FB_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/`;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Firebase REST helper
function fbFetch(fbUrl, method, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(fbUrl);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: method, headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Convert JS object to Firestore fields
function toFirestore(obj) {
  const fields = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'object' && v !== null) fields[k] = { stringValue: JSON.stringify(v) };
    else fields[k] = { stringValue: String(v || '') };
  });
  return { fields };
}

// Convert Firestore fields to JS object
function fromFirestore(doc) {
  const obj = { id: doc.name.split('/').pop() };
  Object.keys(doc.fields || {}).forEach(k => {
    const f = doc.fields[k];
    if (f.integerValue !== undefined) obj[k] = parseInt(f.integerValue);
    else if (f.booleanValue !== undefined) obj[k] = f.booleanValue;
    else if (f.stringValue !== undefined) {
      try { obj[k] = JSON.parse(f.stringValue); } catch { obj[k] = f.stringValue; }
    }
  });
  return obj;
}

const server = http.createServer(async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Keep-alive ping
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong'); return;
  }

  // Anthropic API proxy
  if (req.method === 'POST' && req.url === '/api') {
    if (!API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_KEY manquante' })); return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const opts = {
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body)
        }
      };
      const pr = https.request(opts, pr2 => {
        let data = '';
        pr2.on('data', c => data += c);
        pr2.on('end', () => { res.writeHead(pr2.statusCode, { 'Content-Type': 'application/json' }); res.end(data); });
      });
      pr.on('error', e => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
      pr.write(body); pr.end();
    });
    return;
  }

  // Save to Firestore
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { collection, data } = JSON.parse(body);
        const fbBody = JSON.stringify(toFirestore(data));
        const result = await fbFetch(FB_BASE + collection, 'POST', fbBody);
        res.writeHead(result.status === 200 ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: result.status === 200 }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Load from Firestore
  if (req.method === 'GET' && req.url.startsWith('/load')) {
    try {
      const params = new URL('http://x' + req.url).searchParams;
      const col = params.get('collection') || 'fiches';
      const fbUrl = FB_BASE + col + '?orderBy=timestamp%20desc&pageSize=100';
      const result = await fbFetch(fbUrl, 'GET', null);
      const data = JSON.parse(result.body);
      const docs = (data.documents || []).map(fromFirestore);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(docs));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Paris Caviar HACCP server on port ${PORT}`);
  console.log('API Key:', API_KEY ? 'OK' : 'MANQUANTE!');
});
