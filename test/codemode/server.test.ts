import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCodeMode } from '../../src/codemode/server.js';
import type { CodeMode } from '../../src/codemode/server.js';
import { loadSpec } from '../../src/codemode/spec.js';
import { policyConfigFromEnv } from '../../src/codemode/policy.js';
import type {
  DiscordRequest,
  DiscordResponse,
  PolicyConfig,
  RestExecutor,
} from '../../src/codemode/types.js';

const spec = loadSpec();

// ---------------------------------------------------------------------------
// Fakes and helpers (never touches Discord)
// ---------------------------------------------------------------------------

const WRITABLE: PolicyConfig = {
  allow: [],
  deny: [],
  readOnly: false,
  scopeGuilds: [],
  scopeCategories: [],
  allowDangerousPerms: false,
};

/** Stateful fake: channels and messages live in maps; unknown routes answer 404. */
function makeFakeRest() {
  const calls: DiscordRequest[] = [];
  const channels = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Array<Record<string, unknown>>>();
  let nextId = 900;
  const guildData: Record<string, unknown> = {
    '/guilds/100': { id: '100', owner_id: '1', roles: [{ id: '100', permissions: '1024' }] },
    '/guilds/100/members/5': { roles: [] },
    '/channels/900': { id: '900', permission_overwrites: [] },
  };

  const rest: RestExecutor = async (req): Promise<DiscordResponse> => {
    calls.push(req);
    const { method, path } = req;
    if (method === 'POST' && /^\/guilds\/\d+\/channels$/.test(path)) {
      const id = String(nextId++);
      const channel = { id, ...(req.body as object) };
      channels.set(id, channel);
      messages.set(id, []);
      return { status: 201, data: channel };
    }
    const msgRoute = /^\/channels\/(\d+)\/messages$/.exec(path);
    if (msgRoute && method === 'POST') {
      const msg = { id: `m${messages.get(msgRoute[1])?.length ?? 0}`, author: { id: 'bot' }, ...(req.body as object) };
      messages.get(msgRoute[1])?.push(msg);
      return { status: 200, data: msg };
    }
    if (msgRoute && method === 'GET') return { status: 200, data: messages.get(msgRoute[1]) ?? [] };
    const chRoute = /^\/channels\/(\d+)$/.exec(path);
    if (chRoute && method === 'DELETE' && channels.delete(chRoute[1])) return { status: 200, data: {} };
    if (method === 'GET' && path in guildData) return { status: 200, data: guildData[path] };
    return { status: 404, data: { message: 'Unknown' } };
  };
  return { rest, calls, channels, messages };
}

function setup(opts: {
  config?: Partial<PolicyConfig>;
  rest?: RestExecutor | null;
  limits?: Parameters<typeof createCodeMode>[0]['limits'];
  defaultGuildId?: string | null;
} = {}) {
  const fake = makeFakeRest();
  const audit: string[] = [];
  const rest = opts.rest === undefined ? fake.rest : opts.rest;
  const mode: CodeMode = createCodeMode({
    spec,
    policyConfig: { ...WRITABLE, ...opts.config },
    rest,
    defaultGuildId: opts.defaultGuildId ?? null,
    limits: opts.limits,
    audit: (line) => void audit.push(line),
  });
  return { mode, audit, ...fake };
}

function payload(res: { content: Array<{ text: string }> }): Record<string, any> {
  return JSON.parse(res.content[0].text) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Tool definitions and search
// ---------------------------------------------------------------------------

test('acceptance #1: tools/list serializes to <= 4000 chars', () => {
  const { mode } = setup();
  const size = JSON.stringify(mode.tools).length;
  console.error(`[test] tools/list size: ${size} chars`);
  assert.ok(size <= 4000, `tools/list is ${size} chars`);
  assert.deepEqual(mode.tools.map((t) => t.name), ['discord_search', 'discord_execute']);
});

test('acceptance #2: search for "ban" finds PUT /guilds/{guild_id}/bans/{user_id}', async () => {
  const { mode } = setup();
  const res = await mode.call('discord_search', {
    code: `async () => Object.entries(spec.paths).flatMap(([p, m]) =>
      Object.entries(m).filter(([, o]) => o.operationId.includes('ban'))
        .map(([k, o]) => ({ method: k, path: p, id: o.operationId, hasBody: !!o.requestBody })))`,
  });
  assert.equal(res.isError, undefined);
  const hits = JSON.parse(res.content[0].text) as Array<{ method: string; path: string; id: string; hasBody: boolean }>;
  const ban = hits.find((h) => h.path === '/guilds/{guild_id}/bans/{user_id}' && h.method === 'put');
  assert.ok(ban, 'ban operation not found');
  assert.equal(ban.id, 'ban_user_from_guild');
  assert.equal(ban.hasBody, true);
});

test('search: sandbox error becomes isError', async () => {
  const { mode } = setup();
  const res = await mode.call('discord_search', { code: 'async () => { throw new Error("nope"); }' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /nope/);
});

test('output truncation adds a marker', async () => {
  const { mode } = setup({ limits: { maxOutputChars: 50 } });
  const res = await mode.call('discord_search', {
    code: 'async () => Object.keys(spec.paths)',
  });
  const text = res.content[0].text;
  assert.match(text, /\n…\[truncated \d+ chars\]$/);
  assert.ok(text.startsWith(JSON.stringify(Object.keys(JSON.parse(spec.sandboxJson).paths), null, 2).slice(0, 50)));
});

test('execute truncation cuts the result but keeps the request log intact', async () => {
  const { mode } = setup({ limits: { maxOutputChars: 600 } });
  const res = await mode.call('discord_execute', {
    code: `async () => {
      await discord.request({ method: 'GET', path: '/guilds/100' });
      return 'x'.repeat(5000);
    }`,
  });
  const text = res.content[0].text;
  assert.ok(text.length <= 600, `length ${text.length}`);
  const out = payload(res);
  assert.equal(out.truncated, true);
  assert.match(out.result, /…\[truncated \d+ chars\]$/);
  assert.deepEqual(out.requests, [{ method: 'GET', operationId: 'get_guild', status: 200 }]);
});

test('unknown tool and bad arguments are isError', async () => {
  const { mode } = setup();
  assert.equal((await mode.call('nope', { code: '' })).isError, true);
  assert.equal((await mode.call('discord_search', {})).isError, true);
  assert.equal((await mode.call('discord_execute', undefined)).isError, true);
});

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

test('acceptance #3 (mock): create channel -> send -> read -> delete in one execute', async () => {
  const { mode, calls, channels, audit } = setup();
  const res = await mode.call('discord_execute', {
    code: `async () => {
      const g = '100';
      const ch = (await discord.request({ method: 'POST', path: '/guilds/' + g + '/channels', body: { name: 't', type: 0 }, reason: 'test' })).data;
      const sent = (await discord.request({ method: 'POST', path: '/channels/' + ch.id + '/messages', body: { content: 'hi' } })).data;
      const list = (await discord.request({ method: 'GET', path: '/channels/' + ch.id + '/messages', query: { limit: 10 } })).data;
      const del = await discord.request({ method: 'DELETE', path: '/channels/' + ch.id });
      return { channel: ch.id, sent: sent.content, read: list.length, deleted: del.status };
    }`,
  });
  assert.equal(res.isError, undefined, res.content[0].text);
  const out = payload(res);
  assert.deepEqual(out.result, { channel: '900', sent: 'hi', read: 1, deleted: 200 });
  assert.deepEqual(
    out.requests.map((r: any) => [r.method, r.operationId, r.status]),
    [
      ['POST', 'create_guild_channel', 201],
      ['POST', 'create_message', 200],
      ['GET', 'list_messages', 200],
      ['DELETE', 'delete_channel', 200],
    ],
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[0].reason, 'test');
  assert.deepEqual(calls[2].query, { limit: 10 });
  assert.equal(channels.size, 0, 'channel was deleted');
  assert.equal(audit.length, 4);
  assert.match(
    audit[0],
    /^\[codemode\] \d{4}-\d\d-\d\dT[\d:.]+Z create_guild_channel POST \/guilds\/100\/channels 201 \d+ms\n$/,
  );
  assert.ok(!res.content[0].text.includes('author'), 'raw message objects stay in the sandbox');
});

test('non-2xx resolves instead of throwing', async () => {
  const { mode } = setup();
  const res = await mode.call('discord_execute', {
    code: "async () => (await discord.request({ method: 'GET', path: '/channels/1' })).status",
  });
  const out = payload(res);
  assert.equal(out.result, 404);
  assert.equal(out.requests[0].status, 404);
});

test('acceptance #4 via server: CODEMODE_DENY ban_* throws catchably, Discord sees nothing', async () => {
  const { mode, calls, audit } = setup({ config: { deny: ['ban_*'] } });
  const res = await mode.call('discord_execute', {
    code: `async () => {
      try {
        await discord.request({ method: 'PUT', path: '/guilds/100/bans/7', body: {}, reason: 'x' });
        return 'sent';
      } catch (e) { return e.message; }
    }`,
  });
  const out = payload(res);
  assert.match(out.result, /^Denied: .*\[ban_user_from_guild\]/);
  assert.equal(calls.length, 0);
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0].method, 'PUT');
  assert.equal(out.requests[0].path, '/guilds/100/bans/7');
  assert.ok(out.requests[0].denied);
  assert.match(audit[0], /ban_user_from_guild PUT \/guilds\/100\/bans\/7 DENIED/);
});

test('acceptance #5 via server: default read-only denies POST', async () => {
  const fake = makeFakeRest();
  const mode = createCodeMode({
    spec,
    policyConfig: policyConfigFromEnv({}),
    rest: fake.rest,
    defaultGuildId: null,
    audit: () => {},
  });
  const res = await mode.call('discord_execute', {
    code: `async () => {
      try { await discord.request({ method: 'POST', path: '/channels/1/messages', body: { content: 'x' } }); return 'sent'; }
      catch (e) { return e.message; }
    }`,
  });
  assert.match(payload(res).result, /^Denied:/);
  assert.equal(fake.calls.length, 0);
});

test('path outside the spec is denied with a discord_search hint', async () => {
  const { mode, calls } = setup();
  const res = await mode.call('discord_execute', {
    code: `async () => {
      try { await discord.request({ method: 'GET', path: '/not/in/spec' }); return 'sent'; }
      catch (e) { return e.message; }
    }`,
  });
  assert.match(payload(res).result, /^Denied: .*discord_search/);
  assert.equal(calls.length, 0);
});

test('malformed request options throw inside the sandbox and do not count', async () => {
  const { mode, calls } = setup({ limits: { maxRequests: 1 } });
  const res = await mode.call('discord_execute', {
    code: `async () => {
      const errs = [];
      for (const bad of [
        { method: 'TRACE', path: '/x' }, { method: 'GET', path: 'x' },
        { method: 'GET', path: '/x', query: { a: { b: 1 } } }, { method: 'GET', path: '/x', reason: 5 }, 'GET',
      ]) {
        try { await discord.request(bad); } catch (e) { errs.push(e.message); }
      }
      await discord.request({ method: 'GET', path: '/channels/1/messages' });
      return errs.length;
    }`,
  });
  assert.equal(payload(res).result, 5);
  assert.equal(calls.length, 1);
});

test('acceptance #8: 51st request throws, REST called exactly 50 times', async () => {
  const { mode, calls } = setup();
  const res = await mode.call('discord_execute', {
    code: `async () => {
      let ok = 0;
      try {
        for (let i = 0; i < 60; i++) { await discord.request({ method: 'GET', path: '/channels/1/messages' }); ok++; }
      } catch (e) { return { ok, err: e.message }; }
      return { ok };
    }`,
  });
  const out = payload(res);
  assert.equal(out.result.ok, 50);
  assert.match(out.result.err, /Request limit exceeded \(50 per execute\)/);
  assert.equal(calls.length, 50);
  assert.equal(out.requests.length, 50);
});

test('permissions.effective lookups count toward the request cap', async () => {
  const { mode, calls } = setup({ limits: { maxRequests: 3 } });
  const res = await mode.call('discord_execute', {
    code: `async () => {
      const perms = await permissions.effective({ guildId: '100', userId: '5', channelId: '900' });
      try { await discord.request({ method: 'GET', path: '/channels/1/messages' }); return { perms }; }
      catch (e) { return { perms, err: e.message }; }
    }`,
  });
  const out = payload(res);
  assert.deepEqual(out.result.perms, ['VIEW_CHANNEL']);
  assert.match(out.result.err, /Request limit exceeded \(3 per execute\)/);
  assert.equal(calls.length, 3, 'only the three internal lookups reached REST');
});

test('permissions.names / bits and defaultGuildId are available', async () => {
  const { mode } = setup({ defaultGuildId: '42' });
  const res = await mode.call('discord_execute', {
    code: "async () => ({ names: await permissions.names('8'), bits: await permissions.bits(['ADMINISTRATOR']), g: defaultGuildId })",
  });
  assert.deepEqual(payload(res).result, { names: ['ADMINISTRATOR'], bits: '8', g: '42' });
  const none = setup({ defaultGuildId: null });
  const res2 = await none.mode.call('discord_execute', { code: 'async () => defaultGuildId' });
  assert.equal(payload(res2).result, null);
});

test('sandbox failure is isError and still lists requests made so far', async () => {
  const { mode } = setup();
  const res = await mode.call('discord_execute', {
    code: `async () => {
      await discord.request({ method: 'GET', path: '/channels/1/messages' });
      throw new Error('boom');
    }`,
  });
  assert.equal(res.isError, true);
  const out = payload(res);
  assert.match(out.error, /boom/);
  assert.equal(out.requests.length, 1);
});

test('acceptance #7: runaway loop is interrupted by the timeout', async () => {
  const { mode } = setup({ limits: { timeoutMs: 300 } });
  const started = Date.now();
  const res = await mode.call('discord_execute', { code: 'async () => { while (true) {} }' });
  assert.equal(res.isError, true);
  assert.ok(Date.now() - started < 5000);
});

test('webhook tokens are redacted in the audit line', async () => {
  const { mode, audit } = setup();
  await mode.call('discord_execute', {
    code: "async () => discord.request({ method: 'POST', path: '/webhooks/123/SECRETTOKEN', body: { content: 'x' } })",
  });
  assert.equal(audit.length, 1);
  assert.ok(!audit[0].includes('SECRETTOKEN'));
});

test('rest: null -> execute reports missing DISCORD_TOKEN, search still works', async () => {
  const { mode } = setup({ rest: null });
  const exec = await mode.call('discord_execute', { code: 'async () => 1' });
  assert.equal(exec.isError, true);
  assert.match(exec.content[0].text, /DISCORD_TOKEN/);
  const search = await mode.call('discord_search', { code: 'async () => Object.keys(spec.paths).length > 100' });
  assert.equal(search.isError, undefined);
  assert.equal(JSON.parse(search.content[0].text), true);
});

test('stdout hygiene: nothing is written to stdout during search and execute', async () => {
  const { mode } = setup();
  const original = process.stdout.write;
  const writes: string[] = [];
  process.stdout.write = ((chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await mode.call('discord_search', { code: 'async () => 1' });
    await mode.call('discord_execute', {
      code: "async () => discord.request({ method: 'GET', path: '/channels/1/messages' })",
    });
    await mode.call('discord_execute', {
      code: "async () => discord.request({ method: 'PUT', path: '/guilds/1/bans/2' })",
    });
  } finally {
    process.stdout.write = original;
  }
  assert.deepEqual(writes, []);
});

// ---------------------------------------------------------------------------
// Entry routing over real stdio (acceptance #10, codemode part).
// Hybrid and legacy need a real Discord login, so they are not covered here.
// ---------------------------------------------------------------------------

function entryEnv(mode: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DISCORD_MCP_MODE: mode, DISCORD_TOKEN: '' };
  delete env.DISCORD_MCP_LEGACY;
  return env;
}

function spawnEntry(mode: string) {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index-hybrid.ts'], {
    cwd: process.cwd(),
    env: entryEnv(mode),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function rpc(messages: object[], waitForIds: number[]): Promise<{ lines: string[]; stderr: string }> {
  const child = spawnEntry('codemode');
  const lines: string[] = [];
  let stderr = '';
  let buf = '';
  const seen = new Set<number>();
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout; stderr: ${stderr}`)), 25_000);
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.stdout.on('data', (d) => {
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        lines.push(line);
        const id = (JSON.parse(line) as { id?: number }).id;
        if (typeof id === 'number') seen.add(id);
        if (waitForIds.every((w) => seen.has(w))) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.on('exit', () => reject(new Error(`exited early; stderr: ${stderr}`)));
  });
  for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
  try {
    await done;
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
  return { lines, stderr };
}

test('acceptance #10 (codemode): stdio server lists 2 tools without a token, stdout is pure JSON-RPC', async () => {
  const { lines, stderr } = await rpc(
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'discord_execute', arguments: { code: 'async () => 1' } },
      },
    ],
    [1, 2, 3],
  );
  const parsed = lines.map((l) => JSON.parse(l) as { jsonrpc: string; id?: number; result?: any });
  assert.ok(parsed.every((p) => p.jsonrpc === '2.0'), 'stdout carried a non-JSON-RPC line');
  const list = parsed.find((p) => p.id === 2);
  assert.deepEqual(list?.result.tools.map((t: { name: string }) => t.name), ['discord_search', 'discord_execute']);
  const call = parsed.find((p) => p.id === 3);
  assert.equal(call?.result.isError, true);
  assert.match(call?.result.content[0].text, /DISCORD_TOKEN/);
  assert.match(stderr, /Running in CODEMODE \(2 tools, read-only: true\)/);
});

test('acceptance #10: unknown DISCORD_MCP_MODE exits non-zero', async () => {
  const child = spawnEntry('bogus');
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += String(d)));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /Unknown DISCORD_MCP_MODE "bogus"/);
});
