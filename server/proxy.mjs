import http from 'node:http';
import { Readable } from 'node:stream';
import { INDEX_PATHS, IndexResponseCache } from './index-cache.mjs';

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.RENAISS_PROXY_PORT || '8787', 10);
const API_BASE = 'https://api.renaissos.com';
const API_KEY = process.env.RENAISS_API_KEY;
const API_SECRET = process.env.RENAISS_API_SECRET;
const ALLOWED_ORIGIN = process.env.RENAISS_ALLOWED_ORIGIN;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const allowedRoutes = [
  { method: 'GET', pattern: /^\/v1\/cards\/(?:by-renaiss-id\/[^/]+|by-id\/[^/]+(?:\/(?:fmv-series|trades))?|[^/]+\/[^/]+\/[^/]+)$/ },
  { method: 'GET', pattern: /^\/v1\/graded\/[^/]+$/ },
  { method: 'GET', pattern: /^\/v1\/indices\/(?:one-piece|pokemon)(?:\/series)?$/ },
  { method: 'GET', pattern: /^\/v1\/search$/ },
  { method: 'POST', pattern: /^\/v1\/search\/by-image$/ }
];

function sendJson(response, status, body, origin = '') {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...(origin ? corsHeaders(origin) : {})
  });
  response.end(payload);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-Renaiss-Cache, X-Renaiss-Cache-Age',
    Vary: 'Origin'
  };
}

function validateConfiguration() {
  const missing = [
    ['RENAISS_API_KEY', API_KEY],
    ['RENAISS_API_SECRET', API_SECRET],
    ['RENAISS_ALLOWED_ORIGIN', ALLOWED_ORIGIN]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing required environment values: ${missing.join(', ')}`);
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(ALLOWED_ORIGIN)) {
    throw new Error('RENAISS_ALLOWED_ORIGIN must be one exact chrome-extension:// origin.');
  }
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
    throw new Error('RENAISS_PROXY_PORT must be an integer from 1024 to 65535.');
  }
}

function isAllowedRoute(method, pathname) {
  return allowedRoutes.some((route) => route.method === method && route.pattern.test(pathname));
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchIndexResponse(path) {
  const upstream = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': API_KEY,
      'X-Api-Secret': API_SECRET
    },
    redirect: 'error'
  });
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    body: Buffer.from(await upstream.arrayBuffer()),
    rateLimit: upstream.headers.get('x-ratelimit-limit'),
    rateLimitRemaining: upstream.headers.get('x-ratelimit-remaining')
  };
}

const indexCache = new IndexResponseCache({ fetcher: fetchIndexResponse });

function sendIndexResponse(response, origin, result) {
  const headers = {
    ...corsHeaders(origin),
    'Content-Type': result.entry.contentType,
    'Content-Length': result.entry.body.length,
    'Cache-Control': 'no-store',
    'X-Renaiss-Cache': result.status,
    'X-Renaiss-Cache-Age': String(Math.floor(result.ageMs / 1000))
  };
  if (result.status === 'MISS') {
    if (result.entry.rateLimit) headers['X-RateLimit-Limit'] = result.entry.rateLimit;
    if (result.entry.rateLimitRemaining) headers['X-RateLimit-Remaining'] = result.entry.rateLimitRemaining;
  }
  response.writeHead(result.entry.status, headers);
  response.end(result.entry.body);
}

async function handleRequest(request, response) {
  const origin = request.headers.origin || '';
  if (origin !== ALLOWED_ORIGIN) return sendJson(response, 403, { error: 'Origin not allowed.' });
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin));
    return response.end();
  }

  const incomingUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  if (!isAllowedRoute(request.method || '', incomingUrl.pathname)) {
    return sendJson(response, 404, { error: 'Route not available through this proxy.' }, origin);
  }

  const contentLength = Number.parseInt(request.headers['content-length'] || '0', 10);
  if (contentLength > MAX_UPLOAD_BYTES) return sendJson(response, 413, { error: 'Request body is too large.' }, origin);

  const upstreamPath = `${incomingUrl.pathname}${incomingUrl.search}`;
  if (request.method === 'GET' && INDEX_PATHS.includes(upstreamPath)) {
    const result = await indexCache.get(upstreamPath);
    return sendIndexResponse(response, origin, result);
  }

  const upstreamHeaders = {
    Accept: 'application/json',
    'X-Api-Key': API_KEY,
    'X-Api-Secret': API_SECRET
  };
  if (request.headers['content-type']) upstreamHeaders['Content-Type'] = request.headers['content-type'];

  const hasBody = request.method === 'POST';
  const requestBody = hasBody ? await readRequestBody(request) : undefined;
  const upstream = await fetch(`${API_BASE}${upstreamPath}`, {
    method: request.method,
    headers: upstreamHeaders,
    body: requestBody,
    redirect: 'error'
  });

  const responseHeaders = {
    ...corsHeaders(origin),
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
  for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  response.writeHead(upstream.status, responseHeaders);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
  else response.end();
}

validateConfiguration();

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (!response.headersSent) sendJson(response, error.status || 502, { error: error.status ? error.message : 'Renaiss API request failed.' }, request.headers.origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '');
    else response.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Secure Renaiss API proxy listening on http://${HOST}:${PORT}`);
  Promise.allSettled(INDEX_PATHS.map((path) => indexCache.get(path))).then(() => {
    console.log('Renaiss index cache prewarm complete.');
  });
});
