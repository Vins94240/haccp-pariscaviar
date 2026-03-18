const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_KEY;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const server = http.createServer((req, res) => {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // Keep-alive ping
  if (req.url === '/ping') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('pong'); return;
  }

  // Proxy to Anthropic
  if (req.method === 'POST' && req.url === '/api') {
    if (!API_KEY) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'ANTHROPIC_KEY manquante'})); return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const proxyReq = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, {'Content-Type': 'application/json'});
          res.end(data);
        });
      });
      proxyReq.on('error', e => {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message}));
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, {'Content-Type': MIME[ext] || 'text/plain'});
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Paris Caviar HACCP server on port ' + PORT);
  console.log('API Key:', API_KEY ? 'OK' : 'MANQUANTE!');
});
