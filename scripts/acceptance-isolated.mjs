// Real-Discord acceptance for Code Mode (R1-R4), run against an ISOLATED test guild.
// Usage (from discord-mcp/, after `npm run build`): npm run acceptance -- <TEST_GUILD_ID>
//
// Safety: refuses to run if the target is DISCORD_GUILD_ID or has more than 2 members. Tests run inside a
// private category (@everyone denied VIEW_CHANNEL), messages are silent with no mentions, policy scope is
// locked to the test guild/category, and everything created is deleted in `finally`.
// The bot must NOT have Administrator in the test guild (overwrites would not apply, so R4 cannot verify),
// and needs View Channel, Send Messages, Read Message History, Manage Channels, Manage Roles, View Audit Log.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const DIST = path.resolve('dist/codemode');
const load = (f) => import(pathToFileURL(path.join(DIST, f)).href);
const { createCodeMode } = await load('server.js');
const { loadSpec } = await load('spec.js');
const { createRestExecutor } = await load('rest.js');

const TEST_GUILD = process.argv[2];
const PROD_GUILD = process.env.DISCORD_GUILD_ID;
const TAG = 'codemode acceptance (isolated)';
const VIEW = 1n << 10n, SEND = 1n << 11n, HISTORY = 1n << 16n;
const rest = createRestExecutor(process.env.DISCORD_TOKEN);
const spec = loadSpec();
const results = [];
const created = []; // channel ids to clean up, category last

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function skip(name, reason) {
  results.push({ name, ok: false, skipped: true, detail: reason });
  console.log(`SKIP  ${name}  ${reason}`);
}

function mode(config) {
  const audit = [];
  const m = createCodeMode({
    spec, rest, defaultGuildId: TEST_GUILD, audit: (l) => audit.push(l),
    policyConfig: { allow: [], deny: [], readOnly: true, scopeGuilds: [TEST_GUILD], scopeCategories: [],
      allowDangerousPerms: false, ...config },
  });
  return { m, audit };
}

async function exec(m, code) {
  const res = await m.call('discord_execute', { code });
  let out; try { out = JSON.parse(res.content[0].text); } catch { out = { raw: res.content[0].text }; }
  return { isError: !!res.isError, out };
}

async function guardTarget() {
  if (!TEST_GUILD || TEST_GUILD === PROD_GUILD) throw new Error('refusing: missing test guild or it is DISCORD_GUILD_ID');
  const g = await rest({ method: 'GET', path: `/guilds/${TEST_GUILD}`, query: { with_counts: true } });
  if (g.status !== 200) throw new Error(`cannot read test guild: ${g.status}`);
  if (g.data.approximate_member_count > 2) throw new Error(`refusing: test guild has ${g.data.approximate_member_count} members`);
  const me = (await rest({ method: 'GET', path: '/users/@me' })).data;
  const mine = (await rest({ method: 'GET', path: '/users/@me/guilds' })).data.find((x) => x.id === TEST_GUILD);
  const isAdmin = (BigInt(mine?.permissions ?? 0) & 8n) === 8n;
  return { botId: me.id, guildName: g.data.name, isAdmin };
}

async function snapshot() {
  const ch = await rest({ method: 'GET', path: `/guilds/${TEST_GUILD}/channels` });
  const al = await rest({ method: 'GET', path: `/guilds/${TEST_GUILD}/audit-logs`, query: { limit: 1 } });
  if (al.status !== 200) throw new Error(`audit log unreadable (${al.status}): bot needs View Audit Log`);
  return { channels: ch.data.length, lastAudit: al.data.audit_log_entries?.[0]?.id ?? '0' };
}

async function auditSince(afterId) {
  const al = await rest({ method: 'GET', path: `/guilds/${TEST_GUILD}/audit-logs`, query: { limit: 50, after: afterId } });
  if (al.status !== 200) throw new Error(`audit log unreadable (${al.status})`);
  return al.data.audit_log_entries;
}

function hiddenOverwrites(botId) {
  return [
    { id: TEST_GUILD, type: 0, allow: '0', deny: String(VIEW) },
    { id: botId, type: 1, allow: String(VIEW | SEND | HISTORY), deny: '0' },
  ];
}

async function r1ReadOnly() {
  const { m } = mode({});
  const s = await m.call('discord_search', { code: `async () => spec.paths['/guilds/{guild_id}/channels'].post.operationId` });
  check('R1 search finds create_guild_channel', s.content[0].text.includes('create_guild_channel'));
  const r = await exec(m, `async () => (await discord.request({ method: 'GET', path: '/guilds/' + defaultGuildId + '/channels' })).data.length`);
  check('R1 read-only GET through real REST', !r.isError && typeof r.out.result === 'number', `channels=${r.out.result}`);
}

async function setupCategory(botId) {
  const { m } = mode({ readOnly: false });
  const body = JSON.stringify({ name: 'codemode-test', type: 4, permission_overwrites: hiddenOverwrites(botId) });
  const r = await exec(m, `async () => (await discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/channels', body: ${body}, reason: '${TAG}' })).data`);
  if (r.isError || !r.out.result?.id) throw new Error('category create failed: ' + JSON.stringify(r.out).slice(0, 300));
  created.push(r.out.result.id);
  return r.out.result.id;
}

async function r2MultiStep(cat, botId) {
  const { m } = mode({ readOnly: false, scopeCategories: [cat] });
  const ow = JSON.stringify(hiddenOverwrites(botId));
  const r = await exec(m, `async () => {
    const ch = await discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/channels',
      body: { name: 'cm-r2', type: 0, parent_id: '${cat}', permission_overwrites: ${ow} }, reason: '${TAG}' });
    const id = ch.data.id;
    const sent = await discord.request({ method: 'POST', path: '/channels/' + id + '/messages',
      body: { content: 'hello from codemode', flags: 4096, allowed_mentions: { parse: [] } } });
    const read = await discord.request({ method: 'GET', path: '/channels/' + id + '/messages', query: { limit: 5 } });
    const del = await discord.request({ method: 'DELETE', path: '/channels/' + id, reason: '${TAG}' });
    return { id, created: ch.status, sent: sent.status, readBack: read.data.map((x) => x.content), deleted: del.status };
  }`);
  const o = r.out.result ?? {};
  if (o.id && o.deleted !== 200) created.push(o.id);
  check('R2 #3 multi-step in one execute', o.created === 201 && o.sent === 200 && o.readBack?.[0] === 'hello from codemode' && o.deleted === 200,
    JSON.stringify({ ...o, requests: r.out.requests?.length }));
}

async function denied(name, config, code) {
  const { m } = mode(config);
  const r = await exec(m, `async () => { try { await (${code})(); return 'SENT'; } catch (e) { return e.message; } }`);
  const log = r.out.requests ?? [];
  const sent = log.filter((e) => !e.denied).length;
  check(name, r.out.result !== 'SENT' && /Denied/.test(r.out.result) && sent === 0, String(r.out.result).slice(0, 110));
}

async function r3Denials(cat) {
  const w = { readOnly: false, scopeCategories: [cat] };
  const fakeUser = '100000000000000001';
  await denied('R3 #5 read-only blocks POST', { scopeCategories: [cat] },
    `async () => discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/channels', body: { name: 'x', parent_id: '${cat}' } })`);
  await denied('R3 #4 DENY ban_* blocks ban', { ...w, deny: ['ban_*'] },
    `async () => discord.request({ method: 'PUT', path: '/guilds/' + defaultGuildId + '/bans/${fakeUser}', body: {} })`);
  await denied('R3 #12 other guild (DISCORD_GUILD_ID) blocked even for GET', w,
    `async () => discord.request({ method: 'GET', path: '/guilds/${PROD_GUILD}/channels' })`);
  await denied('R3 6.1 channel outside test category blocked', w,
    `async () => discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/channels', body: { name: 'x', type: 0 } })`);
  await denied('R3 #13 role with ADMINISTRATOR blocked', w,
    `async () => discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/roles', body: { name: 'x', permissions: '8' } })`);
  await denied('R3 #13 overwrite granting MANAGE_ROLES blocked', w,
    `async () => discord.request({ method: 'PUT', path: '/channels/${cat}/permissions/${fakeUser}', body: { type: 1, allow: '${1n << 28n}', deny: '0' } })`);
}

async function r4Effective(cat, botId) {
  const { m } = mode({ readOnly: false, scopeCategories: [cat] });
  const ow = JSON.stringify(hiddenOverwrites(botId));
  const r = await exec(m, `async () => {
    const ch = await discord.request({ method: 'POST', path: '/guilds/' + defaultGuildId + '/channels',
      body: { name: 'cm-r4', type: 0, parent_id: '${cat}', permission_overwrites: ${ow} }, reason: '${TAG}' });
    const id = ch.data.id;
    const before = (await permissions.effective({ guildId: defaultGuildId, userId: '${botId}', channelId: id })).includes('SEND_MESSAGES');
    const ok = await discord.request({ method: 'POST', path: '/channels/' + id + '/messages', body: { content: 'r4 before', flags: 4096, allowed_mentions: { parse: [] } } });
    await discord.request({ method: 'PUT', path: '/channels/' + id + '/permissions/${botId}',
      body: { type: 1, allow: '${VIEW | HISTORY}', deny: '${SEND}' }, reason: '${TAG}' });
    const after = (await permissions.effective({ guildId: defaultGuildId, userId: '${botId}', channelId: id })).includes('SEND_MESSAGES');
    const blocked = await discord.request({ method: 'POST', path: '/channels/' + id + '/messages', body: { content: 'r4 after', flags: 4096 } });
    const del = await discord.request({ method: 'DELETE', path: '/channels/' + id, reason: '${TAG}' });
    return { id, before, sendBefore: ok.status, after, sendAfter: blocked.status, code: blocked.data?.code, deleted: del.status };
  }`);
  const o = r.out.result ?? {};
  if (o.id && o.deleted !== 200) created.push(o.id);
  check('R4 #14 effective() matches Discord', o.before === true && o.sendBefore === 200 && o.after === false && o.sendAfter === 403 && o.code === 50013,
    JSON.stringify(r.isError ? r.out : o));
}

async function cleanup() {
  for (const id of created.reverse()) {
    const r = await rest({ method: 'DELETE', path: `/channels/${id}`, reason: `${TAG} cleanup` });
    console.log(`cleanup ${id}: ${r.status}`);
  }
}

async function main() {
  const { botId, guildName, isAdmin } = await guardTarget();
  console.log(`target: ${guildName} (${TEST_GUILD}), bot ${botId}`);
  const base = await snapshot();
  try {
    await r1ReadOnly();
    const cat = await setupCategory(botId);
    await r2MultiStep(cat, botId);
    await r3Denials(cat);
    if (isAdmin) skip('R4 #14 effective() matches Discord', 'bot has Administrator here, so overwrites never apply; remove it to run R4');
    else await r4Effective(cat, botId);
  } finally {
    await cleanup();
  }
  const end = await snapshot();
  check('cleanup: channel count back to baseline', end.channels === base.channels, `${base.channels} -> ${end.channels}`);
  const entries = await auditSince(base.lastAudit);
  const forbidden = entries.filter((e) => [22, 30, 20].includes(e.action_type)); // ban add, role create, kick
  check('audit: no ban/kick/role-create reached Discord', forbidden.length === 0, `entries since start: ${entries.map((e) => e.action_type).join(',')}`);
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${results.length - failed - skipped}/${results.length} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : skipped ? 3 : 0);
}

main().catch(async (e) => { console.error('ABORT:', e.message); await cleanup(); process.exit(2); });
