import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createSseHttpServer, SSE_HOST } from '../src/sse.js';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, SSE_HOST, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Stands in for the MCP Server: records every message the transport delivers. */
function fakeServer() {
  const received: JSONRPCMessage[] = [];
  return {
    received,
    async connect(transport: Transport) {
      transport.onmessage = (message) => received.push(message);
      await transport.start();
    },
  };
}

/** Opens GET /sse and resolves with the session id from the first `endpoint` event. */
function openSession(port: number): Promise<{ sessionId: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: SSE_HOST, port, path: '/sse' }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const match = buffer.match(/event: endpoint\ndata: (\S+)/);
        if (match) {
          const sessionId = new URL(match[1], 'http://x').searchParams.get('sessionId') ?? '';
          resolve({ sessionId, close: () => req.destroy() });
        }
      });
    });
    req.on('error', reject);
  });
}

function request(
  port: number,
  options: { method: string; path: string; host?: string; body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: SSE_HOST,
        port,
        method: options.method,
        path: options.path,
        headers: {
          host: options.host ?? `${SSE_HOST}:${port}`,
          'content-type': 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    // An accepted GET /sse never ends; fail fast instead of hanging the run.
    req.setTimeout(3000, () => req.destroy(new Error(`${options.method} ${options.path} timed out`)));
    req.on('error', reject);
    req.end(options.body);
  });
}

async function withServer(fn: (port: number, server: ReturnType<typeof fakeServer>) => Promise<void>) {
  const port = await freePort();
  const server = fakeServer();
  const httpServer = createSseHttpServer(server, port);
  await new Promise<void>((resolve) => httpServer.listen(port, SSE_HOST, resolve));
  try {
    await fn(port, server);
  } finally {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

test('POST /message with the session id reaches the MCP server', async () => {
  await withServer(async (port, server) => {
    const session = await openSession(port);
    const res = await request(port, { method: 'POST', path: `/message?sessionId=${session.sessionId}`, body: ping });
    session.close();
    assert.equal(res.status, 202);
    assert.deepEqual(server.received, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  });
});

test('POST with an unknown session id is rejected', async () => {
  await withServer(async (port, server) => {
    const session = await openSession(port);
    const res = await request(port, { method: 'POST', path: '/message?sessionId=not-a-session', body: ping });
    session.close();
    assert.equal(res.status, 404);
    assert.equal(server.received.length, 0);
  });
});

test('a new GET /sse replaces the previous session', async () => {
  await withServer(async (port, server) => {
    const first = await openSession(port);
    const second = await openSession(port);
    const stale = await request(port, { method: 'POST', path: `/message?sessionId=${first.sessionId}`, body: ping });
    const fresh = await request(port, { method: 'POST', path: `/message?sessionId=${second.sessionId}`, body: ping });
    first.close();
    second.close();
    assert.equal(stale.status, 404);
    assert.equal(fresh.status, 202);
    assert.equal(server.received.length, 1);
  });
});

test('requests with a foreign Host header are rejected (DNS rebinding)', async () => {
  await withServer(async (port, server) => {
    const session = await openSession(port);
    const getRes = await request(port, { method: 'GET', path: '/sse', host: `evil.example:${port}` });
    const postRes = await request(port, {
      method: 'POST',
      path: `/message?sessionId=${session.sessionId}`,
      host: `evil.example:${port}`,
      body: ping,
    });
    session.close();
    assert.equal(getRes.status, 403);
    assert.equal(postRes.status, 403);
    assert.equal(server.received.length, 0);
  });
});

test('no CORS headers are sent', async () => {
  await withServer(async (port) => {
    const res = await request(port, { method: 'OPTIONS', path: '/message' });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(res.status, 404);
  });
});
