'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleConversationRequest } = require('./services/conversation.cjs');
const root = path.join(__dirname, 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.gif': 'image/gif', '.md': 'text/plain' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: http://127.0.0.1:* http://localhost:* http://[::1]:*; frame-src 'none'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function createServer(options = {}) {
  let policy = csp;
  if (options.conversationLivekitOrigin) {
    const url = new URL(options.conversationLivekitOrigin);
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw Error('Configure an exact WSS origin for private conversation.');
    policy = policy.replace("connect-src 'self'", `connect-src 'self' ${url.origin}`);
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (await handleConversationRequest(req, res, {
      service: options.conversationService,
      allowedOrigins: options.conversationOrigins || []
    })) return;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('DLang payment and mutation endpoints are disabled.');
    }
    let url, pathname;
    try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400); return res.end('Invalid path'); }
    if (pathname.includes('\0')) { res.writeHead(400); return res.end('Invalid path'); }
    if (pathname === '/dlang/pilot-roster.json' && options.fetchRoster) {
      return Promise.resolve().then(options.fetchRoster).then(roster => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
          members: roster.contributors.map(row => ({ label: row.github, walletAddress: row.walletAddress })) }));
      }).catch(() => { res.writeHead(503); res.end('Pilot roster unavailable'); });
    }
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(req.method === 'HEAD' ? '' : JSON.stringify({ product: 'DLang', payments: false, deployedContract: null }));
    }
    const relative = pathname === '/' || pathname === '/index.html' ? 'dlang.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !types[path.extname(file)] || pathname.includes('\\') || relative.split('/').some(part => part.startsWith('.'))) {
      res.writeHead(404); return res.end('DLang resource unavailable');
    }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end('DLang resource unavailable'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] + (/\.(html|js|mjs|css|json|md)$/.test(file) ? '; charset=utf-8' : '') });
      res.end(req.method === 'HEAD' ? '' : data);
    });
  });
}
module.exports = { createServer };
