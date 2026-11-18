// Tiny static server for the engine test (repo root, correct wasm MIME type).
const http = require('http');
const fs = require('fs');
const path = require('path');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
http.createServer((req, res) => {
  const file = path.join(__dirname, '..', decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}).listen(4173);
