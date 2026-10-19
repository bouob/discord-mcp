import { PermissionsBitField } from 'discord.js';
import type { PermissionsHelper, RestExecutor } from './types.js';

export const DANGEROUS_PERMISSIONS = [
  'ADMINISTRATOR',
  'MANAGE_GUILD',
  'MANAGE_ROLES',
  'MANAGE_WEBHOOKS',
] as const;

// ---------------------------------------------------------------------------
// Name table
// ---------------------------------------------------------------------------

/** Deprecated discord.js aliases that share a bit with an official flag. */
const ALIAS_FLAGS = new Set(['ManageEmojisAndStickers']);
const NAME_OVERRIDES: Record<string, string> = {
  UseVAD: 'USE_VAD',
  SendTTSMessages: 'SEND_TTS_MESSAGES',
};

function toScreamingSnake(pascal: string): string {
  const override = NAME_OVERRIDES[pascal];
  if (override) return override;
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

interface PermEntry {
  name: string;
  bit: bigint;
}

const ENTRIES: PermEntry[] = Object.entries(PermissionsBitField.Flags)
  .filter(([key]) => !ALIAS_FLAGS.has(key))
  .map(([key, bit]) => ({ name: toScreamingSnake(key), bit: bit as bigint }))
  .sort((a, b) => (a.bit < b.bit ? -1 : a.bit > b.bit ? 1 : 0));

const NAME_TO_BIT = new Map<string, bigint>(ENTRIES.map((e) => [e.name, e.bit]));
NAME_TO_BIT.set('MANAGE_EMOJIS_AND_STICKERS', PermissionsBitField.Flags.ManageGuildExpressions);

const ALL_BITS = ENTRIES.reduce((acc, e) => acc | e.bit, 0n);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Parse a permission value (Discord string, or a JSON number) into a bigint; null when unusable. */
export function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

export function namesFromBits(bits: bigint): string[] {
  return ENTRIES.filter((e) => (bits & e.bit) === e.bit).map((e) => e.name);
}

export function permissionNames(bitfield: string): string[] {
  const bits = toBigInt(bitfield);
  if (bits === null) throw new Error(`Invalid permission bitfield: ${String(bitfield)}`);
  return namesFromBits(bits);
}

export function permissionBits(names: string[]): string {
  let bits = 0n;
  for (const name of names) {
    const bit = NAME_TO_BIT.get(name);
    if (bit === undefined) throw new Error(`Unknown permission name: ${name}`);
    bits |= bit;
  }
  return bits.toString();
}

/** Dangerous permission names present in a bitfield. ADMINISTRATOR counts on its own. */
export function hasDangerous(bitfield: string): string[] {
  const present = new Set(permissionNames(bitfield));
  return DANGEROUS_PERMISSIONS.filter((name) => present.has(name));
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

interface RoleData {
  id: string;
  permissions: string;
}
interface Overwrite {
  id: string;
  type: number | string;
  allow: string;
  deny: string;
}

function asRecord(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

async function fetchJson(rest: RestExecutor, path: string): Promise<Record<string, unknown>> {
  const res = await rest({ method: 'GET', path });
  if (res.status < 200 || res.status >= 300) {
    const message = asRecord(res.data).message;
    const text = typeof message === 'string' ? message : 'no message';
    throw new Error(`Discord API ${res.status} on GET ${path}: ${text}`);
  }
  return asRecord(res.data);
}

function big(value: unknown): bigint {
  return toBigInt(value) ?? 0n;
}

function baseBits(roles: RoleData[], guildId: string, memberRoles: Set<string>): bigint {
  let bits = 0n;
  for (const role of roles) {
    if (role.id === guildId || memberRoles.has(role.id)) bits |= big(role.permissions);
  }
  return bits;
}

function applyOverwrites(
  base: bigint,
  overwrites: Overwrite[],
  ctx: { guildId: string; userId: string; memberRoles: Set<string> },
): bigint {
  let bits = base;
  const everyone = overwrites.find((o) => Number(o.type) === 0 && o.id === ctx.guildId);
  if (everyone) bits = (bits & ~big(everyone.deny)) | big(everyone.allow);
  let deny = 0n;
  let allow = 0n;
  for (const o of overwrites) {
    if (Number(o.type) === 0 && o.id !== ctx.guildId && ctx.memberRoles.has(o.id)) {
      deny |= big(o.deny);
      allow |= big(o.allow);
    }
  }
  bits = (bits & ~deny) | allow;
  const member = overwrites.find((o) => Number(o.type) === 1 && o.id === ctx.userId);
  if (member) bits = (bits & ~big(member.deny)) | big(member.allow);
  return bits;
}

function hasAdmin(bits: bigint): boolean {
  return (bits & PermissionsBitField.Flags.Administrator) !== 0n;
}

const SNOWFLAKE_RE = /^\d{1,20}$/;

// These ids are spliced into paths that bypass the policy gate, so they must be plain snowflakes.
function assertSnowflakes(opts: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && (typeof value !== 'string' || !SNOWFLAKE_RE.test(value))) {
      throw new Error(`permissions.effective: ${key} must be a snowflake id string`);
    }
  }
}

async function computeEffective(
  rest: RestExecutor,
  opts: { guildId: string; userId: string; channelId?: string },
): Promise<string[]> {
  const { guildId, userId, channelId } = opts ?? {};
  assertSnowflakes({ guildId: guildId ?? null, userId: userId ?? null, channelId });
  const guild = await fetchJson(rest, `/guilds/${guildId}`);
  if (String(guild.owner_id) === userId) return namesFromBits(ALL_BITS);
  const member = await fetchJson(rest, `/guilds/${guildId}/members/${userId}`);
  const memberRoles = new Set(((member.roles as unknown[]) ?? []).map(String));
  let bits = baseBits((guild.roles as RoleData[]) ?? [], guildId, memberRoles);
  if (hasAdmin(bits)) return namesFromBits(ALL_BITS);
  if (channelId !== undefined) {
    const channel = await fetchJson(rest, `/channels/${channelId}`);
    const overwrites = (channel.permission_overwrites as Overwrite[]) ?? [];
    bits = applyOverwrites(bits, overwrites, { guildId, userId, memberRoles });
  }
  return namesFromBits(bits);
}

export function createPermissionsHelper(rest: RestExecutor): PermissionsHelper {
  return {
    names: permissionNames,
    bits: permissionBits,
    effective: (opts) => computeEffective(rest, opts),
  };
}
