#!/usr/bin/env node
// Requesty Tester – zero-dependency static server + pass-through proxy.
//
// The browser talks to /api/*, and this server forwards each request to the
// Requesty router (default https://router.requesty.ai/v1). Going through a
// local proxy avoids CORS problems and lets binary bodies (audio uploads,
// TTS audio) pass through untouched.
//
// The API key is entered in the UI and sent per request in the
// Authorization header. The server never stores it. You can also set
// REQUESTY_API_KEY, which is used when the browser sends no key.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = (process.env.REQUESTY_BASE_URL || 'https://router.requesty.ai/v1').replace(/\/+$/, '');
const ENV_KEY = process.env.REQUESTY_API_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Request headers we pass on to Requesty.
const FORWARD_REQ_HEADERS = ['authorization', 'content-type', 'accept', 'http-referer', 'x-title'];
// Response headers we drop (Node recomputes these, or fetch already decoded the body).
const DROP_RES_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxy(req, res) {
  const target = UPSTREAM + req.url.slice('/api'.length);
  const headers = {};
  for (const h of FORWARD_REQ_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  if (!headers.authorization && ENV_KEY) headers.authorization = `Bearer ${ENV_KEY}`;
  headers['http-referer'] ||= `http://${HOST}:${PORT}`;
  headers['x-title'] ||= 'Requesty Tester';

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const started = Date.now();
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await readBody(req) : undefined,
    });
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!DROP_RES_HEADERS.has(k)) outHeaders[k] = v;
    });
    outHeaders['x-tester-upstream-url'] = target;
    outHeaders['x-tester-upstream-ms'] = String(Date.now() - started);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, outHeaders);
    res.end(buf);
    console.log(`${req.method} ${target} -> ${upstream.status} (${Date.now() - started} ms)`);
  } catch (err) {
    console.error(`${req.method} ${target} failed:`, err);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Proxy could not reach ${target}: ${err.message}` } }));
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    if (req.url === '/config') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: UPSTREAM, hasEnvKey: Boolean(ENV_KEY) }));
    } else if (req.url.startsWith('/api/')) {
      proxy(req, res);
    } else {
      serveStatic(req, res);
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`Requesty Tester running at http://${HOST}:${PORT}`);
    console.log(`Proxying /api/* -> ${UPSTREAM}${ENV_KEY ? ' (REQUESTY_API_KEY set)' : ''}`);
  });
