// QuickJS (WASM) sandbox for Code Mode. One fresh runtime + context per call.
// Never write to stdout here: stdout is the MCP stdio channel.

import { getQuickJS, shouldInterruptAfterDeadline, Scope } from 'quickjs-emscripten';
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from 'quickjs-emscripten';
import type { HostFunction, SandboxResult, SandboxRunOptions } from './types.js';

let modulePromise: Promise<QuickJSWASMModule> | undefined;

function loadModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    modulePromise = getQuickJS().catch((err: unknown) => {
      modulePromise = undefined;
      throw err;
    });
  }
  return modulePromise;
}

// Defines a frozen, read-only global parsed from a JSON string (args are VM values, never code).
const DEFINE_GLOBAL_SRC = `(function (name, json) {
  const root = JSON.parse(json);
  const stack = [root];
  while (stack.length > 0) {
    const o = stack.pop();
    if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) stack.push(o[k]);
    }
  }
  Object.defineProperty(globalThis, name, {
    value: root, writable: false, enumerable: true, configurable: false,
  });
})`;

// Builds the host objects. The native bridge is captured in a closure, never put on globalThis.
const DEFINE_HOST_SRC = `(function (bridge, specJson) {
  const spec = JSON.parse(specJson);
  for (const objName of Object.keys(spec)) {
    const obj = {};
    for (const fnName of spec[objName]) {
      obj[fnName] = async (...args) => {
        const out = await bridge(objName, fnName, JSON.stringify(args));
        return out === undefined ? undefined : JSON.parse(out);
      };
    }
    Object.defineProperty(globalThis, objName, {
      value: Object.freeze(obj), writable: false, enumerable: true, configurable: false,
    });
  }
})`;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** State shared by the bridge callbacks and teardown. */
interface Bridge {
  closed: boolean;
  deferreds: QuickJSDeferredPromise[];
  /** Set by the waiter; called after every host settlement. */
  poll: () => void;
}

type Waiter = { result: Promise<SandboxResult>; cancel: () => void };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function dumpError(ctx: QuickJSContext, handle: QuickJSHandle): string {
  const d = ctx.dump(handle) as unknown;
  if (d !== null && typeof d === 'object' && 'message' in d) {
    return String((d as { message: unknown }).message);
  }
  return typeof d === 'string' ? d : (JSON.stringify(d) ?? 'Unknown error');
}

function unwrap(
  ctx: QuickJSContext,
  r: { value: QuickJSHandle } | { error: QuickJSHandle },
): QuickJSHandle {
  if ('error' in r) {
    const msg = dumpError(ctx, r.error);
    r.error.dispose();
    throw new Error(msg);
  }
  return r.value;
}

function installGlobals(ctx: QuickJSContext, globalsJson: Record<string, string>): void {
  for (const [name, json] of Object.entries(globalsJson)) {
    if (!IDENT_RE.test(name)) throw new Error(`Invalid global name: ${name}`);
    Scope.withScope((scope) => {
      const fn = scope.manage(unwrap(ctx, ctx.evalCode(DEFINE_GLOBAL_SRC, 'setup.js')));
      const nameH = scope.manage(ctx.newString(name));
      const jsonH = scope.manage(ctx.newString(json));
      scope.manage(unwrap(ctx, ctx.callFunction(fn, ctx.undefined, nameH, jsonH)));
    });
  }
}

/** Run a host function and resolve/reject the matching VM deferred when it settles. */
function dispatchHostCall(
  ctx: QuickJSContext,
  runtime: QuickJSRuntime,
  bridge: Bridge,
  fn: HostFunction | undefined,
  argsJson: string,
): QuickJSHandle {
  const deferred = ctx.newPromise();
  bridge.deferreds.push(deferred);
  const settle = (action: () => void): void => {
    if (bridge.closed) return;
    try {
      action();
      const jobs = runtime.executePendingJobs();
      jobs.error?.dispose();
    } catch {
      // VM may be out of memory while marshalling; the waiter reports the final state.
    }
    bridge.poll();
  };
  const rejectWith = (err: unknown): void => {
    const h = ctx.newError(errMessage(err));
    deferred.reject(h);
    h.dispose();
  };
  const resolveWith = (value: unknown): void => {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch (e) {
      return rejectWith(e); // e.g. BigInt or circular result
    }
    if (json === undefined) return deferred.resolve(ctx.undefined);
    const h = ctx.newString(json);
    deferred.resolve(h);
    h.dispose();
  };
  let hostPromise: Promise<unknown>;
  try {
    if (!fn) throw new Error('Unknown host function');
    hostPromise = Promise.resolve(fn(...(JSON.parse(argsJson) as unknown[])));
  } catch (e) {
    hostPromise = Promise.reject(e);
  }
  hostPromise.then(
    (value) => settle(() => resolveWith(value)),
    (err: unknown) => settle(() => rejectWith(err)),
  );
  return deferred.handle;
}

function installHostObjects(
  ctx: QuickJSContext,
  runtime: QuickJSRuntime,
  bridge: Bridge,
  hostObjects: SandboxRunOptions['hostObjects'],
): void {
  const spec: Record<string, string[]> = {};
  for (const [objName, fns] of Object.entries(hostObjects)) {
    if (!IDENT_RE.test(objName)) throw new Error(`Invalid host object name: ${objName}`);
    spec[objName] = Object.keys(fns);
  }
  Scope.withScope((scope) => {
    const bridgeFn = scope.manage(
      ctx.newFunction('bridge', (objH, fnH, argsH) => {
        const objName = ctx.getString(objH);
        const fnName = ctx.getString(fnH);
        const owner = Object.hasOwn(hostObjects, objName) ? hostObjects[objName] : undefined;
        const fn = owner && Object.hasOwn(owner, fnName) ? owner[fnName] : undefined;
        return dispatchHostCall(ctx, runtime, bridge, fn, ctx.getString(argsH));
      }),
    );
    const fn = scope.manage(unwrap(ctx, ctx.evalCode(DEFINE_HOST_SRC, 'setup.js')));
    const specH = scope.manage(ctx.newString(JSON.stringify(spec)));
    scope.manage(unwrap(ctx, ctx.callFunction(fn, ctx.undefined, bridgeFn, specH)));
  });
}

/** Read the user promise via getPromiseState (not resolvePromise); also enforce the wall clock. */
function waitForResult(
  ctx: QuickJSContext,
  bridge: Bridge,
  promiseHandle: QuickJSHandle,
  deadline: number,
  timeoutMs: number,
): Waiter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = `Execution timed out after ${timeoutMs}ms`;
  const result = new Promise<SandboxResult>((resolve) => {
    const check = (): void => {
      try {
        const state = ctx.getPromiseState(promiseHandle);
        if (state.type === 'pending') return;
        if (state.type === 'fulfilled') {
          const value = ctx.dump(state.value) as unknown;
          if (!state.notAPromise) state.value.dispose();
          return resolve({ ok: true, value });
        }
        const msg = dumpError(ctx, state.error);
        state.error.dispose();
        resolve({ ok: false, error: /interrupted/.test(msg) ? `${timedOut} (${msg})` : msg });
      } catch (e) {
        resolve({ ok: false, error: errMessage(e) });
      }
    };
    bridge.poll = check;
    const remaining = Math.max(0, deadline - Date.now());
    timer = setTimeout(() => resolve({ ok: false, error: timedOut }), remaining);
    check();
  });
  return { result, cancel: () => clearTimeout(timer) };
}

function teardown(
  bridge: Bridge,
  runtime: QuickJSRuntime,
  ctx: QuickJSContext,
  handles: QuickJSHandle[],
): void {
  bridge.closed = true;
  bridge.poll = () => {};
  for (const h of handles) if (h.alive) h.dispose();
  for (const d of bridge.deferreds) if (d.alive) d.dispose();
  ctx.dispose();
  runtime.dispose();
}

function evaluateUserCode(
  ctx: QuickJSContext,
  runtime: QuickJSRuntime,
  code: string,
  handles: QuickJSHandle[],
): QuickJSHandle | string {
  const evaluated = ctx.evalCode(`(${code.trim().replace(/;+\s*$/, '')}\n)()`, 'sandbox.js');
  if (evaluated.error) {
    handles.push(evaluated.error);
    return dumpError(ctx, evaluated.error);
  }
  handles.push(evaluated.value);
  const jobs = runtime.executePendingJobs();
  jobs.error?.dispose();
  return evaluated.value;
}

async function execute(mod: QuickJSWASMModule, opts: SandboxRunOptions): Promise<SandboxResult> {
  const { limits } = opts;
  const deadline = Date.now() + limits.timeoutMs;
  const runtime = mod.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const ctx = runtime.newContext();
  const bridge: Bridge = { closed: false, deferreds: [], poll: () => {} };
  const handles: QuickJSHandle[] = [];
  let waiter: Waiter | undefined;
  try {
    installGlobals(ctx, opts.globalsJson);
    installHostObjects(ctx, runtime, bridge, opts.hostObjects);
    const evaluated = evaluateUserCode(ctx, runtime, opts.code, handles);
    if (typeof evaluated === 'string') return { ok: false, error: evaluated };
    waiter = waitForResult(ctx, bridge, evaluated, deadline, limits.timeoutMs);
    return await waiter.result;
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  } finally {
    waiter?.cancel();
    teardown(bridge, runtime, ctx, handles);
  }
}

export async function runInSandbox(opts: SandboxRunOptions): Promise<SandboxResult> {
  try {
    return await execute(await loadModule(), opts);
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}
