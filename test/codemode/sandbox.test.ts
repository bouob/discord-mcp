import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInSandbox } from '../../src/codemode/sandbox.js';
import type { HostFunction, SandboxResult } from '../../src/codemode/types.js';

const LIMITS = { memoryBytes: 16 * 1024 * 1024, timeoutMs: 1500 };

function run(
  code: string,
  extra: {
    globalsJson?: Record<string, string>;
    hostObjects?: Record<string, Record<string, HostFunction>>;
    limits?: { memoryBytes: number; timeoutMs: number };
  } = {},
): Promise<SandboxResult> {
  return runInSandbox({
    code,
    globalsJson: extra.globalsJson ?? {},
    hostObjects: extra.hostObjects ?? {},
    limits: extra.limits ?? LIMITS,
  });
}

function expectError(r: SandboxResult, pattern: RegExp): void {
  assert.equal(r.ok, false, `expected failure, got ${JSON.stringify(r)}`);
  if (!r.ok) assert.match(r.error, pattern);
}

test('returns a simple value', async () => {
  const r = await run('async () => ({ a: 1, b: [1, 2, 3], c: "x" })');
  assert.deepEqual(r, { ok: true, value: { a: 1, b: [1, 2, 3], c: 'x' } });
});

test('handles non-promise return and trailing semicolon', async () => {
  assert.deepEqual(await run('() => 42;'), { ok: true, value: 42 });
});

test('globalsJson is readable and read-only', async () => {
  const globalsJson = { spec: JSON.stringify({ paths: { '/a': { get: 1 } }, list: [1, 2] }) };
  const r = await run('async () => spec.paths["/a"].get + spec.list.length', { globalsJson });
  assert.deepEqual(r, { ok: true, value: 3 });

  const w = await run(
    `async () => {
      "use strict";
      let threw = 0;
      try { spec.paths = 1; } catch { threw++; }
      try { spec.list.push(3); } catch { threw++; }
      try { spec = 5; } catch { threw++; }
      return { threw, len: spec.list.length, hasPaths: typeof spec.paths };
    }`,
    { globalsJson },
  );
  assert.deepEqual(w, { ok: true, value: { threw: 3, len: 2, hasPaths: 'object' } });
});

test('host function round trip, undefined result, Promise.all', async () => {
  const request: HostFunction = async (req) => ({ echo: req, n: 1 });
  const noop: HostFunction = () => undefined;
  const hostObjects = { discord: { request, noop } };
  const r = await run(
    `async () => {
      const one = await discord.request({ method: "GET", path: "/x" });
      const nothing = await discord.noop();
      const all = await Promise.all([1, 2, 3].map((i) => discord.request({ i })));
      return { one, nothing: nothing === undefined, all: all.map((a) => a.echo.i) };
    }`,
    { hostObjects },
  );
  assert.deepEqual(r, {
    ok: true,
    value: { one: { echo: { method: 'GET', path: '/x' }, n: 1 }, nothing: true, all: [1, 2, 3] },
  });
});

test('host throw is catchable in VM with the same message; uncaught surfaces', async () => {
  const hostObjects = {
    h: {
      boom: (): never => {
        throw new Error('host exploded');
      },
      rej: () => Promise.reject(new Error('host rejected')),
    },
  };
  const caught = await run(
    `async () => {
      const out = [];
      try { await h.boom(); } catch (e) { out.push(e.message); }
      try { await h.rej(); } catch (e) { out.push(e.message); }
      return out;
    }`,
    { hostObjects },
  );
  assert.deepEqual(caught, { ok: true, value: ['host exploded', 'host rejected'] });
  expectError(await run('async () => { await h.boom(); }', { hostObjects }), /host exploded/);
});

test('host fn throwing on the 51st call surfaces as error', async () => {
  let count = 0;
  const hostObjects = {
    discord: {
      request: () => {
        if (++count > 50) throw new Error('Request limit exceeded (50)');
        return { ok: true };
      },
    },
  };
  const r = await run(
    'async () => { for (let i = 0; i < 60; i++) await discord.request({}); return "done"; }',
    { hostObjects, limits: { ...LIMITS, timeoutMs: 5000 } },
  );
  expectError(r, /Request limit exceeded/);
  assert.equal(count, 51);
});

test('acceptance 7: infinite sync loop is interrupted within timeout + 500ms', async () => {
  const timeoutMs = 1000;
  const t0 = Date.now();
  const r = await run('async () => { while (true) {} }', { limits: { ...LIMITS, timeoutMs } });
  const elapsed = Date.now() - t0;
  expectError(r, /interrupted|timed out/);
  assert.ok(elapsed < timeoutMs + 500, `took ${elapsed}ms`);
});

test('never-settling promises time out and later runs still work', async () => {
  const limits = { ...LIMITS, timeoutMs: 600 };
  const hostObjects = { h: { hang: () => new Promise(() => {}) } };
  expectError(await run('async () => { await h.hang(); }', { hostObjects, limits }), /timed out after 600ms/);
  expectError(await run('async () => { await new Promise(() => {}); }', { limits }), /timed out after 600ms/);
  assert.deepEqual(await run('async () => 7'), { ok: true, value: 7 });
});

test('late host settlement after timeout does not crash', async () => {
  const limits = { ...LIMITS, timeoutMs: 300 };
  const hostObjects = { h: { slow: () => new Promise((res) => setTimeout(() => res('late'), 600)) } };
  expectError(await run('async () => { await h.slow(); }', { hostObjects, limits }), /timed out/);
  await new Promise((res) => setTimeout(res, 800));
  assert.deepEqual(await run('async () => 1'), { ok: true, value: 1 });
});

test('memory limit yields out of memory', async () => {
  const r = await run(
    'async () => { const a = []; for (let i = 0; i < 1e7; i++) a.push({ i, s: "x".repeat(100) }); return a.length; }',
    { limits: { memoryBytes: 16 * 1024 * 1024, timeoutMs: 5000 } },
  );
  expectError(r, /out of memory/i);
});

test('acceptance 9: no host internals or secrets visible in the VM', async () => {
  const secret = 'SUPER-SECRET-TOKEN-abc123';
  const hostObjects = {
    discord: { request: () => ({ used: secret.length }) },
    permissions: { names: () => [] },
  };
  const globalsJson = { spec: JSON.stringify({ paths: {} }) };
  const r = await run(
    `async () => {
      const names = Object.getOwnPropertyNames(globalThis);
      const dumped = [];
      for (const n of names) {
        try { dumped.push(n + "=" + JSON.stringify(globalThis[n])); } catch { dumped.push(n); }
      }
      const fnSrc = [discord.request, permissions.names].map((f) => String(f)).join("|");
      return {
        names,
        dump: dumped.join("\\n") + fnSrc,
        types: [typeof fetch, typeof require, typeof process, typeof console, typeof setTimeout],
      };
    }`,
    { hostObjects, globalsJson },
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const v = r.value as { names: string[]; dump: string; types: string[] };
  assert.ok(!v.dump.includes(secret));
  assert.ok(!v.dump.includes('SUPER-SECRET'));
  assert.deepEqual(v.types, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  assert.equal(v.names.filter((n) => /^__/.test(n) || /bridge|hostcall/i.test(n)).length, 0);
  assert.ok(v.names.includes('discord') && v.names.includes('spec'));
});

test('syntax error and runtime error return ok:false', async () => {
  expectError(await run('async () => { let = ; }'), /./);
  expectError(await run('this is not code'), /./);
  expectError(await run('async () => { throw new Error("user boom"); }'), /user boom/);
  expectError(await run('async () => { null.x; }'), /./);
});

test('unknown / non-serializable results are reported, not thrown', async () => {
  const hostObjects = { h: { big: () => 10n } };
  expectError(await run('async () => h.big()', { hostObjects }), /BigInt/i);
});

test('20 sequential runs (with host calls and failures) dispose cleanly', async () => {
  const hostObjects = { h: { add: (a: unknown, b: unknown) => (a as number) + (b as number) } };
  for (let i = 0; i < 20; i++) {
    if (i % 5 === 4) {
      expectError(await run('async () => { throw new Error("x"); }', { hostObjects }), /x/);
    } else {
      assert.deepEqual(await run(`async () => h.add(${i}, 1)`, { hostObjects }), {
        ok: true,
        value: i + 1,
      });
    }
  }
});

test('cold start timing (empty fn, and ~0.5 MB globalsJson)', async () => {
  const big = JSON.stringify({
    paths: Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [
        `/p${i}`,
        { get: { operationId: `op${i}`, description: 'x'.repeat(200), n: i } },
      ]),
    ),
  });
  assert.ok(big.length > 450_000, `dummy json ${big.length}`);
  const time = async (globalsJson: Record<string, string>): Promise<number> => {
    const t0 = performance.now();
    const r = await run('async () => 1', { globalsJson });
    assert.equal(r.ok, true);
    return performance.now() - t0;
  };
  await time({});
  const empty = Math.min(await time({}), await time({}), await time({}));
  const large = Math.min(await time({ spec: big }), await time({ spec: big }), await time({ spec: big }));
  process.stderr.write(`[timing] empty=${empty.toFixed(1)}ms big(${big.length}B)=${large.toFixed(1)}ms\n`);
  assert.ok(large < 2000);
});
