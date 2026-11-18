// Local dev server: static files from ./public + the /api/timetable function.  `node dev.js`
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('./api/timetable.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/timetable') { console.log(req.url); return setTimeout(() => handler(req, res), +process.env.DELAY || 0); } // DELAY=ms simulates a slow API
  const f = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p));
  if (!f.startsWith(path.join(__dirname, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
