import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField } from 'discord.js';
import {
  DANGEROUS_PERMISSIONS,
  createPermissionsHelper,
  hasDangerous,
  permissionBits,
  permissionNames,
} from '../../src/codemode/permissions.js';
import type { DiscordRequest, DiscordResponse, RestExecutor } from '../../src/codemode/types.js';

const helper = createPermissionsHelper(async () => ({ status: 200, data: null }));

test('names/bits round trip over every discord.js flag', () => {
  for (const [key, bit] of Object.entries(PermissionsBitField.Flags)) {
    const names = permissionNames(bit.toString());
    assert.equal(names.length, 1, `${key} should map to exactly one name, got ${names.join(',')}`);
    assert.equal(permissionBits(names), bit.toString(), key);
  }
});

test('every flag gets a distinct official-looking name', () => {
  const all = permissionNames(new PermissionsBitField(PermissionsBitField.All).bitfield.toString());
  assert.equal(new Set(all).size, all.length);
  for (const name of all) assert.match(name, /^[A-Z]+(_[A-Z0-9]+)*$/);
});

test('"8" is ADMINISTRATOR', () => {
  assert.deepEqual(permissionNames('8'), ['ADMINISTRATOR']);
  assert.deepEqual(helper.names('8'), ['ADMINISTRATOR']);
});

test('acronym and compound names match Discord official names', () => {
  const F = PermissionsBitField.Flags;
  const expected: Array<[bigint, string]> = [
    [F.Administrator, 'ADMINISTRATOR'],
    [F.ManageGuild, 'MANAGE_GUILD'],
    [F.SendTTSMessages, 'SEND_TTS_MESSAGES'],
    [F.UseVAD, 'USE_VAD'],
    [F.ManageGuildExpressions, 'MANAGE_GUILD_EXPRESSIONS'],
    [F.UseExternalSounds, 'USE_EXTERNAL_SOUNDS'],
    [F.CreateGuildExpressions, 'CREATE_GUILD_EXPRESSIONS'],
    [F.ViewCreatorMonetizationAnalytics, 'VIEW_CREATOR_MONETIZATION_ANALYTICS'],
    [F.UseEmbeddedActivities, 'USE_EMBEDDED_ACTIVITIES'],
    [F.SendVoiceMessages, 'SEND_VOICE_MESSAGES'],
    [F.SendPolls, 'SEND_POLLS'],
    [F.UseExternalApps, 'USE_EXTERNAL_APPS'],
    [F.ManageRoles, 'MANAGE_ROLES'],
    [F.ManageWebhooks, 'MANAGE_WEBHOOKS'],
    [F.CreateInstantInvite, 'CREATE_INSTANT_INVITE'],
    [F.ViewChannel, 'VIEW_CHANNEL'],
  ];
  for (const [bit, name] of expected) assert.deepEqual(permissionNames(bit.toString()), [name]);
});

test('bits() throws on an unknown name and mentions it', () => {
  assert.throws(() => permissionBits(['ADMINISTRATOR', 'NOT_A_PERM']), /NOT_A_PERM/);
});

test('bits() combines names', () => {
  const bits = permissionBits(['SEND_MESSAGES', 'VIEW_CHANNEL']);
  assert.deepEqual(permissionNames(bits).sort(), ['SEND_MESSAGES', 'VIEW_CHANNEL']);
});

test('hasDangerous', () => {
  assert.deepEqual(hasDangerous('8'), ['ADMINISTRATOR']);
  assert.deepEqual(hasDangerous(permissionBits(['MANAGE_ROLES', 'SEND_MESSAGES'])), ['MANAGE_ROLES']);
  assert.deepEqual(hasDangerous(permissionBits(['SEND_MESSAGES'])), []);
  assert.deepEqual(
    hasDangerous(permissionBits([...DANGEROUS_PERMISSIONS])).sort(),
    [...DANGEROUS_PERMISSIONS].sort(),
  );
});

// ---------------------------------------------------------------------------
// effective() fixture (acceptance #14)
// ---------------------------------------------------------------------------

const GUILD = '100';
const OWNER = '1';
const USER = '5';
const ROLE_A = '200';
const ROLE_B = '201';
const ROLE_OTHER = '300';
const CHANNEL = '900';
const b = (names: string[]) => permissionBits(names);

function makeRest(overrides: { memberRoles?: string[]; adminEveryone?: boolean } = {}) {
  const calls: DiscordRequest[] = [];
  const everyone = overrides.adminEveryone
    ? b(['ADMINISTRATOR'])
    : b(['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS', 'CONNECT']);
  const data: Record<string, unknown> = {
    [`/guilds/${GUILD}`]: {
      id: GUILD,
      owner_id: OWNER,
      roles: [
        { id: GUILD, permissions: everyone },
        { id: ROLE_A, permissions: b(['EMBED_LINKS', 'ATTACH_FILES']) },
        { id: ROLE_B, permissions: b(['MANAGE_MESSAGES']) },
        { id: ROLE_OTHER, permissions: b(['KICK_MEMBERS']) },
      ],
    },
    [`/guilds/${GUILD}/members/${USER}`]: { roles: overrides.memberRoles ?? [ROLE_A, ROLE_B] },
    [`/guilds/${GUILD}/members/${OWNER}`]: { roles: [] },
    [`/channels/${CHANNEL}`]: {
      id: CHANNEL,
      permission_overwrites: [
        // @everyone: deny SEND + ADD_REACTIONS, allow USE_EXTERNAL_EMOJIS
        { id: GUILD, type: 0, allow: b(['USE_EXTERNAL_EMOJIS']), deny: b(['SEND_MESSAGES', 'ADD_REACTIONS']) },
        // role A: deny ATTACH + SEND ; role B: allow SEND, deny EMBED  (merged: allow wins for SEND)
        { id: ROLE_A, type: 0, allow: '0', deny: b(['ATTACH_FILES', 'SEND_MESSAGES']) },
        { id: ROLE_B, type: 0, allow: b(['SEND_MESSAGES']), deny: b(['EMBED_LINKS']) },
        // role the member does not have: must be ignored
        { id: ROLE_OTHER, type: 0, allow: '0', deny: b(['VIEW_CHANNEL']) },
        // member overwrite: deny CONNECT, allow ADD_REACTIONS
        { id: USER, type: 1, allow: b(['ADD_REACTIONS']), deny: b(['CONNECT']) },
        // another member: must be ignored
        { id: '6', type: 1, allow: '0', deny: b(['VIEW_CHANNEL']) },
      ],
    },
  };
  const rest: RestExecutor = async (req): Promise<DiscordResponse> => {
    calls.push(req);
    if (req.path in data) return { status: 200, data: data[req.path] };
    return { status: 404, data: { message: 'Unknown' } };
  };
  return { rest, calls };
}

test('effective: base permissions without channel (everyone + all member roles)', async () => {
  const { rest } = makeRest();
  const names = await createPermissionsHelper(rest).effective({ guildId: GUILD, userId: USER });
  assert.deepEqual(
    [...names].sort(),
    [
      'VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS', 'CONNECT',
      'EMBED_LINKS', 'ATTACH_FILES', 'MANAGE_MESSAGES',
    ].sort(),
  );
});

test('effective: all four overwrite layers match the hand-computed result', async () => {
  const { rest } = makeRest();
  const names = await createPermissionsHelper(rest).effective({
    guildId: GUILD,
    userId: USER,
    channelId: CHANNEL,
  });
  // base -> @everyone ow -> merged role ow -> member ow (see fixture comments)
  const expected = [
    'VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'MANAGE_MESSAGES',
    'USE_EXTERNAL_EMOJIS', 'SEND_MESSAGES', 'ADD_REACTIONS',
  ];
  assert.deepEqual([...names].sort(), expected.sort());
});

test('effective: owner gets every permission', async () => {
  const { rest } = makeRest();
  const names = await createPermissionsHelper(rest).effective({
    guildId: GUILD,
    userId: OWNER,
    channelId: CHANNEL,
  });
  assert.deepEqual(
    [...names].sort(),
    permissionNames(new PermissionsBitField(PermissionsBitField.All).bitfield.toString()).sort(),
  );
});

test('effective: ADMINISTRATOR bypasses channel overwrites', async () => {
  const { rest } = makeRest({ adminEveryone: true });
  const names = await createPermissionsHelper(rest).effective({
    guildId: GUILD,
    userId: USER,
    channelId: CHANNEL,
  });
  assert.ok(names.includes('ADMINISTRATOR'));
  assert.ok(names.includes('VIEW_CHANNEL'));
  assert.ok(names.includes('CONNECT'), 'member deny must not apply to an administrator');
});

test('effective: non-2xx from Discord throws with status and message', async () => {
  const { rest } = makeRest();
  await assert.rejects(
    createPermissionsHelper(rest).effective({ guildId: GUILD, userId: '404' }),
    /404.*Unknown/,
  );
});

test('effective: non-snowflake ids are rejected before any REST call', async () => {
  const calls: DiscordRequest[] = [];
  const rest: RestExecutor = async (req): Promise<DiscordResponse> => {
    calls.push(req);
    return { status: 200, data: {} };
  };
  const h = createPermissionsHelper(rest);
  const bad = [
    { guildId: '1/../../oauth2/applications/@me', userId: '2' },
    { guildId: '1', userId: '2', channelId: '3/messages' },
    { guildId: '1' } as unknown as { guildId: string; userId: string },
    { guildId: 1, userId: '2' } as unknown as { guildId: string; userId: string },
  ];
  for (const opts of bad) {
    await assert.rejects(h.effective(opts), /must be a snowflake/);
  }
  assert.equal(calls.length, 0);
});
