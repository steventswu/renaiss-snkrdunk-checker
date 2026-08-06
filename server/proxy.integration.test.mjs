import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PROXY_ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const FOREIGN_ORIGIN = `chrome-extension://${'b'.repeat(32)}`;
const proxyScript = fileURLToPath(new URL('./proxy.mjs', import.meta.url));

let proxyProcess;
let baseUrl;

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForProxy() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (proxyProcess.exitCode !== null) throw new Error(`Proxy exited before listening (${proxyProcess.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/v1/not-available`, { headers: { Origin: PROXY_ORIGIN } });
      if (response.status === 404) return;
    } catch {
      // The child may still be binding its loopback socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Proxy did not start within 2 seconds.');
}

test.before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  proxyProcess = spawn(process.execPath, [proxyScript], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      RENAISS_API_KEY: 'integration-test-key',
      RENAISS_API_SECRET: 'integration-test-secret',
      RENAISS_ALLOWED_ORIGIN: PROXY_ORIGIN,
      RENAISS_PROXY_PORT: String(port)
    },
    stdio: 'ignore'
  });
  await waitForProxy();
});

test.after(async () => {
  if (!proxyProcess || proxyProcess.exitCode !== null) return;
  proxyProcess.kill('SIGTERM');
  await once(proxyProcess, 'exit');
});

test('rejects requests from any origin other than the configured extension', async () => {
  const response = await fetch(`${baseUrl}/v1/not-available`, { headers: { Origin: FOREIGN_ORIGIN } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Origin not allowed.' });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('answers CORS preflight for the exact extension origin', async () => {
  const response = await fetch(`${baseUrl}/v1/search`, {
    method: 'OPTIONS',
    headers: {
      Origin: PROXY_ORIGIN,
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), PROXY_ORIGIN);
  assert.match(response.headers.get('access-control-allow-methods'), /GET/);
});

test('blocks routes outside the proxy allowlist before contacting upstream', async () => {
  const response = await fetch(`${baseUrl}/v1/not-available`, { headers: { Origin: PROXY_ORIGIN } });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Route not available through this proxy.' });
  assert.equal(response.headers.get('access-control-allow-origin'), PROXY_ORIGIN);
});
