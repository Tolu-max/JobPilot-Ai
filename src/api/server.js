/**
 * JobPilot — Backend API Server
 * Runs on pxxl.app with PostgreSQL.
 * Zero external framework — uses Node built-in http.
 */
import 'dotenv/config';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { registerAuthRoutes } from './routes/auth.js';
import { registerJobsRoutes } from './routes/jobs.js';

const PORT = parseInt(process.env.API_PORT || '4000', 10);
const ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.JOBPILOT_ALLOWED_ORIGINS ||
  'http://localhost:3000'
);

// ---------------------------------------------------------------------------
// Tiny router
// ---------------------------------------------------------------------------

class Router {
  constructor() { this.routes = []; }

  add(method, path, ...handlers) {
    this.routes.push({ method: method.toUpperCase(), path, handlers });
  }

  get(path, ...handlers)    { this.add('GET',    path, ...handlers); }
  post(path, ...handlers)   { this.add('POST',   path, ...handlers); }
  put(path, ...handlers)    { this.add('PUT',    path, ...handlers); }
  delete(path, ...handlers) { this.add('DELETE', path, ...handlers); }

  handle(req, res) {
    const { method, url } = req;
    const [pathname, queryString = ''] = url.split('?');
    req.query = Object.fromEntries(new URLSearchParams(queryString));

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, pathname);
      if (!params) continue;
      req.params = params;
      return runHandlers(route.handlers, req, res);
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
  }
}

function matchPath(routePath, reqPath) {
  const rParts = routePath.split('/');
  const uParts = reqPath.split('/');
  if (rParts.length !== uParts.length) return null;
  const params = {};
  for (let i = 0; i < rParts.length; i++) {
    const r = rParts[i];
    if (r.startsWith(':')) params[r.slice(1)] = decodeURIComponent(uParts[i]);
    else if (r !== uParts[i]) return null;
  }
  return params;
}

function runHandlers(handlers, req, res) {
  let i = 0;
  const next = () => { if (i < handlers.length) handlers[i++](req, res, next); };
  next();
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const router = new Router();

// Health check
router.get('/health', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'jobpilot-api', ts: new Date().toISOString() }));
});

// Register route groups
registerAuthRoutes(router);
registerJobsRoutes(router);

const server = http.createServer(async (req, res) => {
  // CORS
  const allowedOrigin = resolveAllowedOrigin(req.headers.origin);
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(allowedOrigin ? 204 : 403);
    res.end();
    return;
  }

  // Parse JSON body
  if (req.method !== 'GET') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf-8');
      req.body = raw ? JSON.parse(raw) : {};
    } catch { req.body = {}; }
  }

  // Wrap handlers with try/catch
  try {
    router.handle(req, res);
  } catch (err) {
    console.error('[API]', err.message);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[JobPilot API] Running at http://localhost:${PORT}`);
  console.log(`[JobPilot API] Health: http://localhost:${PORT}/health`);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // already started above
}

export { server };

function parseAllowedOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(origin) {
  if (!origin) return '';
  if (ALLOWED_ORIGINS.includes('*')) return origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}
