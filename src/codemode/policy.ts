import { DANGEROUS_PERMISSIONS, namesFromBits, toBigInt } from './permissions.js';
import type {
  DiscordRequest,
  MatchedOperation,
  Policy,
  PolicyConfig,
  PolicyDecision,
  RestExecutor,
  LoadedSpec,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function policyConfigFromEnv(env: NodeJS.ProcessEnv): PolicyConfig {
  return {
    allow: parseList(env.CODEMODE_ALLOW),
    deny: parseList(env.CODEMODE_DENY),
    readOnly: env.CODEMODE_READ_ONLY?.trim() !== 'false',
    scopeGuilds: parseList(env.CODEMODE_SCOPE_GUILDS),
    scopeCategories: parseList(env.CODEMODE_SCOPE_CATEGORIES),
    allowDangerousPerms: env.CODEMODE_ALLOW_DANGEROUS_PERMS?.trim() === 'true',
  };
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function compileAll(patterns: string[]): RegExp[] {
  return patterns.map(globToRegExp);
}

function anyMatch(regexes: RegExp[], operationId: string): boolean {
  return regexes.some((re) => re.test(operationId));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChannelInfo {
  id: string;
  type: number;
  guild_id?: string;
  parent_id?: string | null;
}

const THREAD_TYPES = new Set([10, 11, 12]);
const CATEGORY_TYPE = 4;

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dangerousIn(bits: bigint): string[] {
  const present = new Set(namesFromBits(bits));
  return DANGEROUS_PERMISSIONS.filter((name) => present.has(name));
}

/** Dangerous names in a permission value; throws when the value is present but not a bitfield. */
function dangerousInValue(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  const bits = toBigInt(value);
  if (bits === null) throw new Error(`${label} is not a valid permission bitfield`);
  return dangerousIn(bits);
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

class PolicyImpl implements Policy {
  private readonly denyRe: RegExp[];
  private readonly allowRe: RegExp[];
  private readonly channelCache = new Map<string, ChannelInfo>();
  private readonly roleCache = new Map<string, Map<string, string>>();

  constructor(
    private readonly spec: LoadedSpec,
    private readonly config: PolicyConfig,
    private readonly rest: RestExecutor,
  ) {
    this.denyRe = compileAll(config.deny);
    this.allowRe = compileAll(config.allow);
  }

  async check(req: DiscordRequest): Promise<PolicyDecision> {
    const matched = this.spec.match(req.method, req.path);
    if (!matched) return { ok: false, reason: 'path not in Discord API spec' };
    const operationId = matched.op.operationId;
    const staticReason = this.staticGates(req, operationId);
    if (staticReason) return { ok: false, reason: staticReason, operationId };
    const scopeReason = await this.guarded('scope', () => this.scopeGate(matched, req));
    if (scopeReason) return { ok: false, reason: scopeReason, operationId };
    if (!this.config.allowDangerousPerms) {
      const permReason = await this.guarded('dangerous-permission', () =>
        this.dangerousGate(matched, req),
      );
      if (permReason) return { ok: false, reason: permReason, operationId };
    }
    return { ok: true, op: matched.op };
  }

  private staticGates(req: DiscordRequest, operationId: string): string | null {
    if (anyMatch(this.denyRe, operationId)) {
      return `denied by CODEMODE_DENY: ${operationId}`;
    }
    if (this.config.readOnly && req.method !== 'GET') {
      return `read-only mode: ${req.method} requests are not allowed`;
    }
    if (this.allowRe.length > 0 && !anyMatch(this.allowRe, operationId)) {
      return `not in CODEMODE_ALLOW: ${operationId}`;
    }
    return null;
  }

  /** Any failure while evaluating a gate denies the request (fail closed). */
  private async guarded(gate: string, fn: () => Promise<string | null>): Promise<string | null> {
    try {
      return await fn();
    } catch (err) {
      return `${gate} check failed (denied): ${errorMessage(err)}`;
    }
  }

  // ---- scope (6.1) --------------------------------------------------------

  private async scopeGate(m: MatchedOperation, req: DiscordRequest): Promise<string | null> {
    const { scopeGuilds, scopeCategories } = this.config;
    if (scopeGuilds.length === 0 && scopeCategories.length === 0) return null;
    const guildId = m.pathParams.guild_id;
    const channelId = m.pathParams.channel_id ?? m.pathParams.thread_id;
    if (guildId !== undefined && scopeGuilds.length > 0 && !scopeGuilds.includes(guildId)) {
      return `scope: guild ${guildId} is not in CODEMODE_SCOPE_GUILDS`;
    }
    // Writes that name neither a guild nor a channel (webhook execute, /users/@me, stage
    // instances, ...) cannot be tied to a scope, so they fail closed.
    if (guildId === undefined && channelId === undefined && scopeGuilds.length > 0 && req.method !== 'GET') {
      return 'scope: write targets no guild or channel, denied while CODEMODE_SCOPE_GUILDS is set';
    }
    if (guildId === undefined && channelId !== undefined && scopeGuilds.length > 0) {
      const channel = await this.lookupChannel(channelId);
      if (!channel.guild_id || !scopeGuilds.includes(channel.guild_id)) {
        return `scope: channel ${channelId} belongs to guild ${channel.guild_id ?? '(none)'}, not in CODEMODE_SCOPE_GUILDS`;
      }
    }
    if (scopeCategories.length > 0 && req.method !== 'GET') {
      return this.categoryGate(m, req, channelId);
    }
    return null;
  }

  private async categoryGate(
    m: MatchedOperation,
    req: DiscordRequest,
    channelId: string | undefined,
  ): Promise<string | null> {
    const allowed = this.config.scopeCategories;
    if (channelId !== undefined) {
      const category = await this.categoryOf(channelId);
      if (category === null || !allowed.includes(category)) {
        return `scope: channel ${channelId} is under category ${category ?? '(none)'}, not in CODEMODE_SCOPE_CATEGORIES`;
      }
      return null;
    }
    const operationId = m.op.operationId;
    if (operationId === 'create_guild_channel') {
      const parent = asRecord(req.body).parent_id;
      if (parent === undefined || parent === null || !allowed.includes(String(parent))) {
        return `scope: new channel parent_id ${String(parent ?? '(none)')} is not in CODEMODE_SCOPE_CATEGORIES`;
      }
    }
    if (operationId === 'bulk_update_guild_channels') {
      return 'scope: bulk channel updates are not allowed while CODEMODE_SCOPE_CATEGORIES is set';
    }
    return null;
  }

  /** Category a channel falls under: itself when a category, the parent's parent for threads. */
  private async categoryOf(channelId: string): Promise<string | null> {
    const channel = await this.lookupChannel(channelId);
    if (channel.type === CATEGORY_TYPE) return channel.id;
    if (THREAD_TYPES.has(channel.type) && channel.parent_id) {
      const parent = await this.lookupChannel(channel.parent_id);
      return parent.parent_id ?? null;
    }
    return channel.parent_id ?? null;
  }

  private async lookupChannel(channelId: string): Promise<ChannelInfo> {
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;
    const res = await this.rest({ method: 'GET', path: `/channels/${channelId}` });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`channel lookup for ${channelId} failed with status ${res.status}`);
    }
    const data = asRecord(res.data);
    const info: ChannelInfo = {
      id: String(data.id ?? channelId),
      type: Number(data.type),
      guild_id: data.guild_id === undefined ? undefined : String(data.guild_id),
      parent_id: data.parent_id === undefined || data.parent_id === null ? null : String(data.parent_id),
    };
    this.channelCache.set(channelId, info);
    return info;
  }

  // ---- dangerous permissions (6.2) ---------------------------------------

  private async dangerousGate(m: MatchedOperation, req: DiscordRequest): Promise<string | null> {
    const body = asRecord(req.body);
    const operationId = m.op.operationId;
    const found: string[] = [];
    if (operationId === 'create_guild_role' || operationId === 'update_guild_role') {
      found.push(...dangerousInValue(body.permissions, 'permissions'));
    }
    if (operationId === 'set_channel_permission_overwrite') {
      found.push(...dangerousInValue(body.allow, 'allow'));
    }
    found.push(...this.overwritesDanger(body.permission_overwrites));
    const roleIds = this.roleIdsToCheck(m, body);
    if (roleIds.length > 0) {
      found.push(...(await this.rolesDanger(m.pathParams.guild_id, roleIds)));
    }
    if (found.length === 0) return null;
    return `dangerous permissions not allowed (${[...new Set(found)].join(', ')}); set CODEMODE_ALLOW_DANGEROUS_PERMS=true to permit`;
  }

  private overwritesDanger(overwrites: unknown): string[] {
    if (!Array.isArray(overwrites)) return [];
    return overwrites.flatMap((o) => dangerousInValue(asRecord(o).allow, 'permission_overwrites.allow'));
  }

  /** Role ids a request would assign to a member. */
  private roleIdsToCheck(m: MatchedOperation, body: Record<string, unknown>): string[] {
    const operationId = m.op.operationId;
    if (operationId === 'add_guild_member_role') {
      return m.pathParams.role_id === undefined ? [] : [m.pathParams.role_id];
    }
    if (operationId === 'update_guild_member' || operationId === 'add_guild_member') {
      const roles = body.roles;
      if (!Array.isArray(roles)) return [];
      return roles.filter((r) => r !== null && r !== undefined).map(String);
    }
    return [];
  }

  private async rolesDanger(guildId: string | undefined, roleIds: string[]): Promise<string[]> {
    if (guildId === undefined) throw new Error('role assignment without guild_id in path');
    const found: string[] = [];
    for (const roleId of roleIds) {
      const permissions = await this.rolePermissions(guildId, roleId);
      found.push(...dangerousInValue(permissions, `role ${roleId} permissions`));
    }
    return found;
  }

  /** Role permission bitfield; refetches the guild's roles once when the role is not cached yet. */
  private async rolePermissions(guildId: string, roleId: string): Promise<string> {
    const cached = this.roleCache.get(guildId)?.get(roleId);
    if (cached !== undefined) return cached;
    const roles = await this.fetchRoles(guildId);
    this.roleCache.set(guildId, roles);
    const permissions = roles.get(roleId);
    if (permissions === undefined) throw new Error(`role ${roleId} not found in guild ${guildId}`);
    return permissions;
  }

  private async fetchRoles(guildId: string): Promise<Map<string, string>> {
    const res = await this.rest({ method: 'GET', path: `/guilds/${guildId}/roles` });
    if (res.status < 200 || res.status >= 300 || !Array.isArray(res.data)) {
      throw new Error(`role lookup for guild ${guildId} failed with status ${res.status}`);
    }
    const roles = new Map<string, string>();
    for (const role of res.data) {
      const r = asRecord(role);
      roles.set(String(r.id), String(r.permissions));
    }
    return roles;
  }
}

export function createPolicy(spec: LoadedSpec, config: PolicyConfig, rest: RestExecutor): Policy {
  return new PolicyImpl(spec, config, rest);
}
