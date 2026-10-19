// Legacy HTTP+SSE transport for hybrid mode: GET /sse opens the stream, POST /message?sessionId=… delivers requests.
// Localhost only, no CORS, Host header checked (DNS rebinding): a web page in the user's browser must not be able to drive the bot.
import { createServer, type Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export const SSE_HOST = '127.0.0.1';

/** Anything that can attach to a transport; the MCP `Server` in production, a fake in tests. */
export interface Connectable {
  connect(transport: Transport): Promise<void>;
}

/** One MCP Server holds one transport, so a new GET /sse replaces the previous session. */
export function createSseHttpServer(server: Connectable, port: number): HttpServer {
  const allowedHosts = [`${SSE_HOST}:${port}`, `localhost:${port}`];
  let active: SSEServerTransport | null = null;

  return createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${SSE_HOST}:${port}`);

    // The SDK validates Host only on POST; without this a rebinding page could take over the session via GET.
    if (!allowedHosts.includes(req.headers.host ?? '')) {
      res.writeHead(403).end('Invalid Host header');
      return;
    }

    if (url.pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/message', res, {
        allowedHosts,
        enableDnsRebindingProtection: true,
      });
      transport.onclose = () => {
        if (active === transport) active = null;
      };
      active = transport;
      server.connect(transport).catch((error) => {
        console.error('[Discord MCP] SSE connect failed:', error);
      });
      return;
    }

    if (url.pathname === '/message' && req.method === 'POST') {
      if (!active || url.searchParams.get('sessionId') !== active.sessionId) {
        res.writeHead(404).end('Unknown session');
        return;
      }
      active.handlePostMessage(req, res).catch((error) => {
        console.error('[Discord MCP] SSE message failed:', error);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }

    res.writeHead(404).end('Not found');
  });
}
