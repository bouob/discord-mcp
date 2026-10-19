// discord_execute: per-call counting executor around policy + REST, run inside the sandbox.
// Never write to stdout here: stdout is the MCP stdio channel (audit goes to stderr via deps.audit).

import { createPermissionsHelper, permissionBits, permissionNames } from './permissions.js';
import { runInSandbox } from './sandbox.js';
import type {
  DiscordRequest,
  HostFunction,
  HttpMethod,
  Policy,
  PolicyDecision,
  RestExecutor,
} from './types.js';

export interface CodeModeLimits {
  memoryBytes: number;
  timeoutMs: number;
  maxRequests: number;
  maxOutputChars: number;
}

export const DEFAULT_LIMITS: CodeModeLimits = {
  memoryBytes: 64 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRequests: 50,
  maxOutputChars: 24_000,
};

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface RequestLogEntry {
  method: string;
  operationId?: string;
  status?: number;
  path?: string;
  denied?: string;
  error?: string;
}

export interface ExecDeps {
  rest: RestExecutor;
  policy: Policy;
  defaultGuildId: string | null;
  limits: CodeModeLimits;
  audit: (line: string) => void;
}

export function textResult(text: string, isError = false): ToolResult {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function validateQuery(query: unknown): void {
  if (query === undefined) return;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new Error('discord.request: query must be a flat object');
  }
  for (const [key, value] of Object.entries(query)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`discord.request: query.${key} must be a string, number or boolean`);
    }
  }
}

function validateRequest(raw: unknown): DiscordRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('discord.request: an options object is required');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.method !== 'string' || !METHODS.has(o.method)) {
    throw new Error('discord.request: method must be one of GET, POST, PUT, PATCH, DELETE');
  }
  if (typeof o.path !== 'string' || !o.path.startsWith('/')) {
    throw new Error('discord.request: path must be a string starting with /');
  }
  validateQuery(o.query);
  if (o.reason !== undefined && typeof o.reason !== 'string') {
    throw new Error('discord.request: reason must be a string');
  }
  return {
    method: o.method as HttpMethod,
    path: o.path,
    query: o.query as DiscordRequest['query'],
    body: o.body,
    reason: o.reason,
  };
}

// ---------------------------------------------------------------------------
// Counting executor
// ---------------------------------------------------------------------------

// Webhook and interaction paths carry a secret token as the 3rd segment; keep it out of the audit log.
function redactPath(path: string): string {
  if (!/^\/(webhooks|interactions)\//.test(path)) return path;
  return path.split('/').map((seg, i) => (i === 3 ? '***' : seg)).join('/');
}

function denyMessage(decision: Extract<PolicyDecision, { ok: false }>): string {
  const id = decision.operationId ? ` [${decision.operationId}]` : '';
  const hint = decision.operationId ? '' : ' (use discord_search to find a valid path)';
  return `Denied: ${decision.reason}${id}${hint}`;
}

export interface ExecSession {
  hostObjects: Record<string, Record<string, HostFunction>>;
  log: RequestLogEntry[];
}

function auditLine(deps: ExecDeps, id: string, req: DiscordRequest, status: string | number, ms: number): void {
  const time = new Date().toISOString();
  deps.audit(`[codemode] ${time} ${id} ${req.method} ${redactPath(req.path)} ${status} ${ms}ms
`);
}

function makeRequest(deps: ExecDeps, bump: () => void, log: RequestLogEntry[]) {
  return async (raw: unknown): Promise<unknown> => {
    const req = validateRequest(raw);
    bump();
    const decision = await deps.policy.check(req);
    if (!decision.ok) {
      log.push({ method: req.method, path: req.path, denied: decision.reason });
      auditLine(deps, decision.operationId ?? '-', req, 'DENIED', 0);
      throw new Error(denyMessage(decision));
    }
    const id = decision.op.operationId;
    const started = Date.now();
    try {
      const res = await deps.rest(req);
      log.push({ method: req.method, operationId: id, status: res.status });
      auditLine(deps, id, req, res.status, Date.now() - started);
      return { status: res.status, data: res.data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.push({ method: req.method, operationId: id, error });
      auditLine(deps, id, req, 'ERROR', Date.now() - started);
      throw err;
    }
  };
}

export function createExecSession(deps: ExecDeps): ExecSession {
  const log: RequestLogEntry[] = [];
  let count = 0;
  const bump = (): void => {
    count += 1;
    if (count > deps.limits.maxRequests) {
      throw new Error(`Request limit exceeded (${deps.limits.maxRequests} per execute)`);
    }
  };
  // Internal lookups made by permissions.effective share the cap but skip the policy (read-only GETs).
  const countedRest: RestExecutor = async (req) => {
    bump();
    return deps.rest(req);
  };
  const helper = createPermissionsHelper(countedRest);
  return {
    log,
    hostObjects: {
      discord: { request: makeRequest(deps, bump, log) },
      permissions: {
        names: (b) => permissionNames(b as string),
        bits: (n) => permissionBits(n as string[]),
        effective: (o) => helper.effective(o as Parameters<typeof helper.effective>[0]),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runExecute(code: string, deps: ExecDeps): Promise<ToolResult> {
  const session = createExecSession(deps);
  const out = await runInSandbox({
    code,
    globalsJson: { defaultGuildId: JSON.stringify(deps.defaultGuildId) },
    hostObjects: session.hostObjects,
    limits: { memoryBytes: deps.limits.memoryBytes, timeoutMs: deps.limits.timeoutMs },
  });
  const max = deps.limits.maxOutputChars;
  if (!out.ok) return textResult(packOutput('error', out.error, session.log, max), true);
  return textResult(packOutput('result', out.value ?? null, session.log, max));
}

// Truncate the payload, never the request log: the log is what tells the model what already ran.
function packOutput(key: string, value: unknown, log: RequestLogEntry[], max: number): string {
  const full = toJson({ [key]: value, requests: log });
  if (full.length <= max) return full;
  const valueText = toJson(value);
  const budget = Math.max(0, max - toJson({ requests: log }).length - key.length - 80);
  const cut = `${valueText.slice(0, budget)}\n…[truncated ${valueText.length - budget} chars]`;
  return truncate(toJson({ [key]: cut, truncated: true, requests: log }), max);
}
