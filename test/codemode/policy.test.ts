import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, policyConfigFromEnv } from '../../src/codemode/policy.js';
import { permissionBits } from '../../src/codemode/permissions.js';
import type {
  DiscordRequest,
  DiscordResponse,
  HttpMethod,
  LoadedSpec,
  PolicyConfig,
  RestExecutor,
  SpecOperation,
} from '../../src/codemode/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const OPS: SpecOperation[] = [
  { operationId: 'list_guild_roles', method: 'GET', pathTemplate: '/guilds/{guild_id}/roles' },
  { operationId: 'create_guild_role', method: 'POST', pathTemplate: '/guilds/{guild_id}/roles' },
  { operationId: 'update_guild_role', method: 'PATCH', pathTemplate: '/guilds/{guild_id}/roles/{role_id}' },
  { operationId: 'ban_user_from_guild', method: 'PUT', pathTemplate: '/guilds/{guild_id}/bans/{user_id}' },
  { operationId: 'list_messages', method: 'GET', pathTemplate: '/channels/{channel_id}/messages' },
  { operationId: 'create_message', method: 'POST', pathTemplate: '/channels/{channel_id}/messages' },
  { operationId: 'create_thread', method: 'POST', pathTemplate: '/channels/{channel_id}/threads' },
  { operationId: 'create_guild_channel', method: 'POST', pathTemplate: '/guilds/{guild_id}/channels' },
  { operationId: 'bulk_update_guild_channels', method: 'PATCH', pathTemplate: '/guilds/{guild_id}/channels' },
  { operationId: 'get_guild', method: 'GET', pathTemplate: '/guilds/{guild_id}' },
  {
    operationId: 'add_guild_member_role',
    method: 'PUT',
    pathTemplate: '/guilds/{guild_id}/members/{user_id}/roles/{role_id}',
  },
  { operationId: 'update_guild_member', method: 'PATCH', pathTemplate: '/guilds/{guild_id}/members/{user_id}' },
  {
    operationId: 'set_channel_permission_overwrite',
    method: 'PUT',
    pathTemplate: '/channels/{channel_id}/permissions/{overwrite_id}',
  },
  { operationId: 'execute_webhook', method: 'POST', pathTemplate: '/webhooks/{webhook_id}/{webhook_token}' },
  { operationId: 'get_my_user', method: 'GET', pathTemplate: '/users/@me' },
];

function matchTemplate(template: string, path: string): Record<string, string> | null {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    const m = /^\{(.+)\}$/.exec(t[i]);
    if (m) params[m[1]] = p[i];
    else if (t[i] !== p[i]) return null;
  }
  return params;
}

const fakeSpec: LoadedSpec = {
  operations: OPS,
  sandboxJson: '{}',
  match(method: HttpMethod, path: string) {
    for (const op of OPS) {
      if (op.method !== method) continue;
      const pathParams = matchTemplate(op.pathTemplate, path);
      if (pathParams) return { op, pathParams };
    }
    return null;
  },
};

const GUILD_A = '1000';
const GUILD_B = '2000';
const CAT_OK = '5000';
const CAT_OTHER = '5001';

const DATA: Record<string, unknown> = {
  // channels
  '/channels/10': { id: '10', type: 0, guild_id: GUILD_A, parent_id: CAT_OK },
  '/channels/11': { id: '11', type: 0, guild_id: GUILD_A, parent_id: CAT_OTHER },
  '/channels/12': { id: '12', type: 0, guild_id: GUILD_A, parent_id: null },
  '/channels/20': { id: '20', type: 0, guild_id: GUILD_B, parent_id: '6000' },
  '/channels/30': { id: '30', type: 4, guild_id: GUILD_A, parent_id: null },
  '/channels/5000': { id: '5000', type: 4, guild_id: GUILD_A, parent_id: null },
  '/channels/40': { id: '40', type: 11, guild_id: GUILD_A, parent_id: '10' },
  '/channels/41': { id: '41', type: 11, guild_id: GUILD_A, parent_id: '11' },
  // roles of guild A
  [`/guilds/${GUILD_A}/roles`]: [
    { id: '700', permissions: permissionBits(['SEND_MESSAGES']) },
    { id: '701', permissions: permissionBits(['MANAGE_ROLES', 'SEND_MESSAGES']) },
    { id: '702', permissions: '8' },
  ],
};

function makeRest(data: Record<string, unknown> = DATA) {
  const calls: DiscordRequest[] = [];
  const rest: RestExecutor = async (req): Promise<DiscordResponse> => {
    calls.push(req);
    if (req.method === 'GET' && req.path in data) return { status: 200, data: data[req.path] };
    return { status: 404, data: { message: 'Unknown' } };
  };
  return { rest, calls };
}

const baseConfig: PolicyConfig = {
  allow: [],
  deny: [],
  readOnly: false,
  scopeGuilds: [],
  scopeCategories: [],
  allowDangerousPerms: false,
};

function setup(config: Partial<PolicyConfig> = {}) {
  const fake = makeRest();
  const policy = createPolicy(fakeSpec, { ...baseConfig, ...config }, fake.rest);
  return { policy, ...fake };
}

function req(method: HttpMethod, path: string, body?: unknown): DiscordRequest {
  return { method, path, body };
}

// ---------------------------------------------------------------------------
// Basic gates
// ---------------------------------------------------------------------------

test('path not in spec is rejected', async () => {
  const { policy, calls } = setup();
  const d = await policy.check(req('GET', '/oauth2/applications/@me'));
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : '', /not in Discord API spec/);
  assert.equal(calls.length, 0);
});

test('acceptance #4: DENY ban_* rejects PUT ban with zero REST calls', async () => {
  const { policy, calls } = setup({ deny: ['ban_*'] });
  const d = await policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`));
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.operationId, 'ban_user_from_guild');
    assert.match(d.reason, /CODEMODE_DENY/);
  }
  assert.equal(calls.length, 0);
});

test('deny pattern is a full-string, case-sensitive match', async () => {
  const { policy } = setup({ deny: ['ban'] });
  assert.equal((await policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`))).ok, true);
  const upper = setup({ deny: ['BAN_*'] });
  assert.equal((await upper.policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`))).ok, true);
  const mid = setup({ deny: ['*_user_*'] });
  assert.equal((await mid.policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`))).ok, false);
});

test('acceptance #5: readOnly rejects POST, passes GET', async () => {
  const { policy } = setup({ readOnly: true });
  const post = await policy.check(req('POST', '/channels/10/messages', { content: 'x' }));
  assert.equal(post.ok, false);
  assert.match(!post.ok ? post.reason : '', /read-only/);
  const get = await policy.check(req('GET', '/channels/10/messages'));
  assert.equal(get.ok, true);
  if (get.ok) assert.equal(get.op.operationId, 'list_messages');
});

test('allow list: only listed operations pass; empty allow means everything', async () => {
  const { policy } = setup({ allow: ['list_*', 'create_message'] });
  assert.equal((await policy.check(req('GET', '/channels/10/messages'))).ok, true);
  assert.equal((await policy.check(req('POST', '/channels/10/messages'))).ok, true);
  const d = await policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`));
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : '', /CODEMODE_ALLOW/);
  const open = setup();
  assert.equal((await open.policy.check(req('PUT', `/guilds/${GUILD_A}/bans/77`))).ok, true);
});

test('deny beats allow', async () => {
  const { policy } = setup({ allow: ['*'], deny: ['create_message'] });
  assert.equal((await policy.check(req('POST', '/channels/10/messages'))).ok, false);
  assert.equal((await policy.check(req('GET', '/channels/10/messages'))).ok, true);
});

// ---------------------------------------------------------------------------
// Scope (acceptance #12)
// ---------------------------------------------------------------------------

test('acceptance #12: scopeGuilds rejects another guild in the path without lookups', async () => {
  const { policy, calls } = setup({ scopeGuilds: [GUILD_A] });
  assert.equal((await policy.check(req('GET', `/guilds/${GUILD_A}`))).ok, true);
  const d = await policy.check(req('GET', `/guilds/${GUILD_B}`));
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : '', /scope/);
  assert.equal(calls.length, 0);
});

test('scopeGuilds: channel-only path resolved by lookup, and the lookup is cached', async () => {
  const { policy, calls } = setup({ scopeGuilds: [GUILD_A] });
  const bad = await policy.check(req('GET', '/channels/20/messages'));
  assert.equal(bad.ok, false);
  assert.equal(calls.length, 1);
  await policy.check(req('GET', '/channels/20/messages'));
  assert.equal(calls.length, 1, 'second check must hit the cache');
  const good = await policy.check(req('GET', '/channels/10/messages'));
  assert.equal(good.ok, true);
  assert.equal(calls.length, 2);
});

test('scopeGuilds: writes naming no guild or channel fail closed; reads pass', async () => {
  const { policy, calls } = setup({ scopeGuilds: [GUILD_A] });
  const write = await policy.check(req('POST', '/webhooks/1/tok', { content: 'x' }));
  assert.equal(write.ok, false);
  assert.match(write.ok ? '' : write.reason, /no guild or channel/);
  assert.equal((await policy.check(req('GET', '/users/@me'))).ok, true);
  assert.equal(calls.length, 0);
  const unscoped = setup();
  assert.equal((await unscoped.policy.check(req('POST', '/webhooks/1/tok', {}))).ok, true);
});

test('scopeGuilds: lookup failure fails closed', async () => {
  const { policy } = setup({ scopeGuilds: [GUILD_A] });
  const d = await policy.check(req('GET', '/channels/999/messages'));
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : '', /denied/);
});

test('scopeCategories: write under allowed category passes, other category rejected', async () => {
  const { policy } = setup({ scopeCategories: [CAT_OK] });
  assert.equal((await policy.check(req('POST', '/channels/10/messages'))).ok, true);
  const other = await policy.check(req('POST', '/channels/11/messages'));
  assert.equal(other.ok, false);
  assert.match(!other.ok ? other.reason : '', /CODEMODE_SCOPE_CATEGORIES/);
  assert.equal((await policy.check(req('POST', '/channels/12/messages'))).ok, false, 'no category');
  assert.equal((await policy.check(req('POST', '/channels/20/messages'))).ok, false);
});

test('scopeCategories: category itself counts; threads use their parent channel category', async () => {
  const { policy } = setup({ scopeCategories: [CAT_OK] });
  assert.equal((await policy.check(req('POST', '/channels/5000/threads'))).ok, true);
  assert.equal((await policy.check(req('POST', '/channels/40/messages'))).ok, true);
  assert.equal((await policy.check(req('POST', '/channels/41/messages'))).ok, false);
});

test('scopeCategories: GET reads are not category-restricted (and need no lookup)', async () => {
  const { policy, calls } = setup({ scopeCategories: [CAT_OK] });
  assert.equal((await policy.check(req('GET', '/channels/11/messages'))).ok, true);
  assert.equal(calls.length, 0);
});

test('scopeCategories: creating a guild channel requires an allowed parent_id', async () => {
  const { policy } = setup({ scopeCategories: [CAT_OK] });
  const path = `/guilds/${GUILD_A}/channels`;
  assert.equal((await policy.check(req('POST', path, { name: 'x', parent_id: CAT_OK }))).ok, true);
  assert.equal((await policy.check(req('POST', path, { name: 'x', parent_id: CAT_OTHER }))).ok, false);
  assert.equal((await policy.check(req('POST', path, { name: 'x' }))).ok, false);
  assert.equal((await policy.check(req('PATCH', path, [{ id: '10', position: 1 }]))).ok, false);
});

// ---------------------------------------------------------------------------
// Dangerous permissions (acceptance #13)
// ---------------------------------------------------------------------------

test('acceptance #13: create/update role with a dangerous permission is rejected', async () => {
  const { policy } = setup();
  const rolesPath = `/guilds/${GUILD_A}/roles`;
  const admin = await policy.check(req('POST', rolesPath, { name: 'x', permissions: '8' }));
  assert.equal(admin.ok, false);
  assert.match(!admin.ok ? admin.reason : '', /ADMINISTRATOR/);
  const asNumber = await policy.check(req('POST', rolesPath, { name: 'x', permissions: 8 }));
  assert.equal(asNumber.ok, false);
  const upd = await policy.check(
    req('PATCH', `${rolesPath}/700`, { permissions: permissionBits(['MANAGE_WEBHOOKS']) }),
  );
  assert.equal(upd.ok, false);
  const fine = await policy.check(
    req('POST', rolesPath, { name: 'x', permissions: permissionBits(['SEND_MESSAGES']) }),
  );
  assert.equal(fine.ok, true);
  const noPerms = await policy.check(req('POST', rolesPath, { name: 'x' }));
  assert.equal(noPerms.ok, true);
});

test('unparseable permissions value fails closed', async () => {
  const { policy } = setup();
  const d = await policy.check(req('POST', `/guilds/${GUILD_A}/roles`, { permissions: 'nope' }));
  assert.equal(d.ok, false);
});

test('acceptance #13: add_guild_member_role with a MANAGE_ROLES role is rejected', async () => {
  const { policy, calls } = setup();
  const bad = await policy.check(req('PUT', `/guilds/${GUILD_A}/members/55/roles/701`));
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.reason : '', /MANAGE_ROLES/);
  const admin = await policy.check(req('PUT', `/guilds/${GUILD_A}/members/55/roles/702`));
  assert.equal(admin.ok, false);
  const fine = await policy.check(req('PUT', `/guilds/${GUILD_A}/members/55/roles/700`));
  assert.equal(fine.ok, true);
  assert.equal(calls.filter((c) => c.path === `/guilds/${GUILD_A}/roles`).length, 1, 'roles cached');
});

test('acceptance #13: allowDangerousPerms lifts the check', async () => {
  const { policy } = setup({ allowDangerousPerms: true });
  assert.equal((await policy.check(req('PUT', `/guilds/${GUILD_A}/members/55/roles/701`))).ok, true);
  assert.equal(
    (await policy.check(req('POST', `/guilds/${GUILD_A}/roles`, { permissions: '8' }))).ok,
    true,
  );
});

test('update_guild_member checks every role in body.roles', async () => {
  const { policy } = setup();
  const path = `/guilds/${GUILD_A}/members/55`;
  assert.equal((await policy.check(req('PATCH', path, { roles: ['700'] }))).ok, true);
  assert.equal((await policy.check(req('PATCH', path, { roles: ['700', '702'] }))).ok, false);
  assert.equal((await policy.check(req('PATCH', path, { nick: 'x' }))).ok, true);
});

test('role lookup failure or unknown role fails closed', async () => {
  const { policy } = setup();
  const unknown = await policy.check(req('PUT', `/guilds/${GUILD_A}/members/55/roles/999`));
  assert.equal(unknown.ok, false);
  const noGuild = await policy.check(req('PUT', `/guilds/${GUILD_B}/members/55/roles/700`));
  assert.equal(noGuild.ok, false);
});

test('set_channel_permission_overwrite checks body.allow', async () => {
  const { policy } = setup();
  const path = '/channels/10/permissions/55';
  const bad = await policy.check(req('PUT', path, { type: 1, allow: permissionBits(['MANAGE_ROLES']), deny: '0' }));
  assert.equal(bad.ok, false);
  const denyOnly = await policy.check(
    req('PUT', path, { type: 1, allow: '0', deny: permissionBits(['MANAGE_ROLES']) }),
  );
  assert.equal(denyOnly.ok, true);
});

test('gate order: scope is evaluated before dangerous permissions', async () => {
  const { policy } = setup({ scopeGuilds: [GUILD_A] });
  const d = await policy.check(req('POST', `/guilds/${GUILD_B}/roles`, { permissions: '8' }));
  assert.equal(d.ok, false);
  assert.match(!d.ok ? d.reason : '', /^scope/);
});

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------

test('policyConfigFromEnv defaults: readOnly true, everything else empty/false', () => {
  assert.deepEqual(policyConfigFromEnv({}), {
    allow: [],
    deny: [],
    readOnly: true,
    scopeGuilds: [],
    scopeCategories: [],
    allowDangerousPerms: false,
  });
});

test('policyConfigFromEnv parses lists and flags', () => {
  const cfg = policyConfigFromEnv({
    CODEMODE_ALLOW: ' list_* , get_*,, create_message ',
    CODEMODE_DENY: 'ban_*',
    CODEMODE_READ_ONLY: 'false',
    CODEMODE_SCOPE_GUILDS: '1,2',
    CODEMODE_SCOPE_CATEGORIES: '9',
    CODEMODE_ALLOW_DANGEROUS_PERMS: 'true',
  });
  assert.deepEqual(cfg, {
    allow: ['list_*', 'get_*', 'create_message'],
    deny: ['ban_*'],
    readOnly: false,
    scopeGuilds: ['1', '2'],
    scopeCategories: ['9'],
    allowDangerousPerms: true,
  });
  assert.equal(policyConfigFromEnv({ CODEMODE_READ_ONLY: 'FALSE' }).readOnly, true);
  assert.equal(policyConfigFromEnv({ CODEMODE_READ_ONLY: '' }).readOnly, true);
  assert.equal(policyConfigFromEnv({ CODEMODE_ALLOW_DANGEROUS_PERMS: '1' }).allowDangerousPerms, false);
});
