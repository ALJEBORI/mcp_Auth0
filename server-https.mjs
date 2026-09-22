import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const options = {
  key: fs.readFileSync('./localhost+1-key.pem'),
  cert: fs.readFileSync('./localhost+1.pem')
};

const TARGET_PORT = 8787; // Wrangler's default port
const HTTPS_PORT = 8443;  // The secure port you'll use

https.createServer(options, (req, res) => {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });
  
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: Make sure Wrangler is running on port 8787.');
  });
}).listen(HTTPS_PORT, () => {
  console.log(`🔒 Secure local HTTPS proxy running at https://localhost:${HTTPS_PORT}`);
});