// Shared contracts for Code Mode.
// Every codemode module depends on these types only, never on each other's internals.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DiscordRequest {
  method: HttpMethod;
  /** Concrete path with values substituted, e.g. /guilds/123/bans/456 (no query string). */
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  /** Sent as X-Audit-Log-Reason. */
  reason?: string;
}

export interface DiscordResponse {
  status: number;
  /** Parsed JSON body; null for 204. Non-2xx responses resolve (not throw) with Discord's error body. */
  data: unknown;
}

/** Raw REST call with no policy checks. Injectable so tests never touch Discord. */
export type RestExecutor = (req: DiscordRequest) => Promise<DiscordResponse>;

// ---------------------------------------------------------------------------
// spec.ts
// ---------------------------------------------------------------------------

export interface SpecOperation {
  operationId: string;
  method: HttpMethod;
  /** OpenAPI template, e.g. /guilds/{guild_id}/bans/{user_id} */
  pathTemplate: string;
}

export interface MatchedOperation {
  op: SpecOperation;
  pathParams: Record<string, string>;
}

export interface LoadedSpec {
  /** Bot-token-capable operations only (OAuth2-only and the explicit exclusion list removed). */
  operations: SpecOperation[];
  /** Pre-serialized JSON of `{ paths, schemas }` injected as the sandbox global `spec`. */
  sandboxJson: string;
  /** Resolve a concrete request path to an operation; null when the path or method is not in the spec. */
  match(method: HttpMethod, path: string): MatchedOperation | null;
}

// ---------------------------------------------------------------------------
// policy.ts
// ---------------------------------------------------------------------------

export interface PolicyConfig {
  /** operationId patterns (`*` wildcard). Empty = allow everything not denied. */
  allow: string[];
  /** Always wins over allow. */
  deny: string[];
  /** Only GET passes when true. Default true. */
  readOnly: boolean;
  /** Empty = unrestricted. */
  scopeGuilds: string[];
  /** Empty = unrestricted. Applies to channel writes. */
  scopeCategories: string[];
  allowDangerousPerms: boolean;
}

export type PolicyDecision =
  | { ok: true; op: SpecOperation }
  | { ok: false; reason: string; operationId?: string };

export interface Policy {
  check(req: DiscordRequest): Promise<PolicyDecision>;
}

// ---------------------------------------------------------------------------
// permissions.ts
// ---------------------------------------------------------------------------

/** Names use Discord's official SCREAMING_SNAKE form, e.g. ADMINISTRATOR, MANAGE_ROLES. */
export interface PermissionsHelper {
  names(bitfield: string): string[];
  bits(names: string[]): string;
  effective(opts: { guildId: string; userId: string; channelId?: string }): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// sandbox.ts
// ---------------------------------------------------------------------------

export interface SandboxLimits {
  memoryBytes: number;
  timeoutMs: number;
}

/** Arguments and return values cross the boundary as JSON. A thrown error rejects inside the sandbox. */
export type HostFunction = (...args: unknown[]) => unknown | Promise<unknown>;

export interface SandboxRunOptions {
  /** Source of an async arrow function, e.g. `async () => { ... }`. Its resolved value is the result. */
  code: string;
  /** Pre-serialized JSON values exposed as read-only globals, e.g. { spec: loaded.sandboxJson }. */
  globalsJson: Record<string, string>;
  /** Host functions grouped into global objects, e.g. { discord: { request }, permissions: { names } }. */
  hostObjects: Record<string, Record<string, HostFunction>>;
  limits: SandboxLimits;
}

export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string };
