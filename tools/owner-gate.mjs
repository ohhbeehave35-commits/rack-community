import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const cookieName = 'rack_owner';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const signature = (password, expires) => createHmac('sha256', password).update(`rack-owner:${expires}`).digest('hex');

export function ownerCookie(password, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + 43200);
  return `${expires}.${signature(password, expires)}`;
}

export function ownerAuthorized(cookie, password, now = Date.now()) {
  if (!password) return true;
  const value = String(cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const [expires, supplied] = value.split('.');
  return /^\d+$/.test(expires || '') && Number(expires) > now / 1000 && equal(supplied || '', signature(password, expires));
}

export function ownerGate(password = process.env.RACK_OWNER_PASSWORD || '') {
  return async (req, res, next) => {
    // The integrated apps are on loopback ports; allow their panel parent.
    res.setHeader('Content-Security-Policy', "frame-ancestors http://127.0.0.1:*");
    if (!password || ownerAuthorized(req.headers.cookie, password)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/rack-login' && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403).end('Cross-site login refused'); return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) { res.writeHead(413).end(); return; }
      }
      if (equal(new URLSearchParams(body).get('password') || '', password)) {
        res.setHeader('Set-Cookie', `${cookieName}=${ownerCookie(password)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
        res.writeHead(303, { Location: '/' }).end(); return;
      }
      res.writeHead(401).end('Incorrect owner password. Go back and try again.'); return;
    }
    if (req.method !== 'GET' || !(req.headers.accept || '').includes('text/html')) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Owner sign-in required"}'); return;
    }
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Rack owner sign-in</title><body style="font:18px system-ui;background:white;color:black;max-width:32rem;margin:10vh auto;padding:24px"><h1>Rack owner sign-in</h1><p>Unlock this local Rack for 12 hours.</p><form method="post" action="/rack-login"><label>Owner password <input name="password" type="password" autocomplete="current-password" required></label><button>Unlock Rack</button></form></body></html>');
  };
}

export function rackPlugin() {
  return {
    name: 'rack-owner-gate',
    configureServer(server) {
      server.middlewares.use(ownerGate());
      // Vite handles HMR upgrades outside Connect; gate that path too.
      server.httpServer?.prependListener('upgrade', (req, socket) => {
        if (!ownerAuthorized(req.headers.cookie, process.env.RACK_OWNER_PASSWORD || '')) socket.destroy();
      });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/grok' || url.pathname === '/wire-desk') {
          url.pathname = '/'; url.searchParams.set('desk', 'wire');
          res.writeHead(308, { Location: url.pathname + url.search }).end(); return;
        }
        if (url.searchParams.get('desk') === 'grok') {
          url.searchParams.set('desk', 'wire');
          res.writeHead(308, { Location: url.pathname + url.search }).end(); return;
        }
        next();
      });
    },
    configurePreviewServer(server) { server.middlewares.use(ownerGate()); },
  };
}
