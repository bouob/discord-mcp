import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXCLUDED_OPERATION_IDS, loadSpec } from '../../src/codemode/spec.js';
import type { HttpMethod } from '../../src/codemode/types.js';

const spec = loadSpec();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;
const sandbox = JSON.parse(spec.sandboxJson) as {
  paths: Record<string, Record<string, Doc>>;
  schemas: Record<string, Doc>;
};

const literalCount = (template: string): number => template.split('/').filter((s) => s && !s.startsWith('{')).length;

describe('loadSpec operations', () => {
  it('keeps a plausible number of bot-token operations', () => {
    assert.ok(spec.operations.length >= 230 && spec.operations.length <= 241, String(spec.operations.length));
  });

  it('drops OAuth2-only operations and command-permission endpoints', () => {
    const ids = new Set(spec.operations.map((o) => o.operationId));
    assert.equal(EXCLUDED_OPERATION_IDS.size, 3);
    for (const id of EXCLUDED_OPERATION_IDS) assert.ok(!ids.has(id), id);
    // OAuth2-only in the spec (no BotToken security entry): get_my_guild_member.
    assert.equal(spec.match('GET', '/users/@me/guilds/1/member'), null);
    for (const [template, methods] of Object.entries(sandbox.paths)) {
      for (const [method, doc] of Object.entries(methods)) {
        assert.ok(ids.has(doc.operationId), `${method} ${template}`);
      }
    }
  });
});

describe('sandboxJson', () => {
  it('is under 1 MB, parses, and has no unexpanded refs', () => {
    assert.ok(spec.sandboxJson.length < 1024 * 1024, String(spec.sandboxJson.length));
    assert.ok(!spec.sandboxJson.includes('#/components'));
    assert.ok(Object.keys(sandbox.schemas).length > 400);
  });

  it('lets search find the ban operation with delete_message_seconds', () => {
    const hits: Array<{ method: string; template: string; doc: Doc }> = [];
    for (const [template, methods] of Object.entries(sandbox.paths)) {
      for (const [method, doc] of Object.entries(methods)) {
        if (String(doc.operationId).includes('ban')) hits.push({ method, template, doc });
      }
    }
    const ban = hits.find((h) => h.method === 'put' && h.template === '/guilds/{guild_id}/bans/{user_id}');
    assert.ok(ban);
    assert.equal(ban.doc.operationId, 'ban_user_from_guild');
    assert.ok('delete_message_seconds' in ban.doc.requestBody.schema.properties);
    assert.deepEqual(
      ban.doc.parameters.map((p: Doc) => p.name),
      ['guild_id', 'user_id'],
    );
  });

  it('expands refs one level, drops noise, and keeps resolvable bare-name refs', () => {
    const list = sandbox.paths['/guilds/{guild_id}/bans'].get;
    const limit = list.parameters.find((p: Doc) => p.name === 'limit');
    assert.equal(limit.schema.type, 'integer');
    assert.ok(String(list.response.status).startsWith('2'));
    assert.ok(!JSON.stringify(list).includes('RateLimit'));
    assert.ok(!('security' in list) && !('responses' in list));
    const refs = spec.sandboxJson.match(/"\$ref":"([^"]+)"/g) ?? [];
    assert.ok(refs.length > 0);
    for (const r of refs) {
      const name = r.slice('"$ref":"'.length, -1);
      assert.ok(name in sandbox.schemas, name);
    }
  });
});

describe('match', () => {
  it('resolves the ban route with path params', () => {
    const m = spec.match('PUT', '/guilds/123/bans/456');
    assert.ok(m);
    assert.equal(m.op.operationId, 'ban_user_from_guild');
    assert.equal(m.op.pathTemplate, '/guilds/{guild_id}/bans/{user_id}');
    assert.deepEqual(m.pathParams, { guild_id: '123', user_id: '456' });
  });

  it('prefers literal segments over params', () => {
    const me = spec.match('GET', '/users/@me');
    const other = spec.match('GET', '/users/456');
    assert.ok(me && other);
    assert.equal(me.op.pathTemplate, '/users/@me');
    assert.equal(other.op.pathTemplate, '/users/{user_id}');
    assert.deepEqual(me.pathParams, {});
    const member = spec.match('PATCH', '/guilds/1/members/@me');
    assert.ok(member);
    assert.equal(member.op.pathTemplate, '/guilds/{guild_id}/members/@me');
  });

  it('accepts percent-encoded emoji in reaction paths', () => {
    const m = spec.match('PUT', '/channels/1/messages/2/reactions/%F0%9F%91%8D/@me');
    assert.ok(m);
    assert.equal(m.pathParams.emoji_name, '%F0%9F%91%8D');
    assert.equal(m.pathParams.channel_id, '1');
  });

  it('rejects traversal, malformed paths, unknown paths and wrong methods', () => {
    const bad: Array<[HttpMethod, string]> = [
      ['GET', '/../oauth2/applications/@me'],
      ['GET', '/guilds/1/../2'],
      ['GET', '/guilds/%2e%2e/x'],
      ['GET', '/guilds/%2E%2E'],
      ['GET', '/guilds/1%2Fbans'],
      ['GET', '/guilds/1//bans'],
      ['GET', '/guilds/1/bans/'],
      ['GET', '/guilds/1?x=1'],
      ['GET', '/guilds/1#x'],
      ['GET', '/guilds\\1'],
      ['GET', '/guilds/1 /bans'],
      ['GET', '/guilds/1/bans\n'],
      ['GET', '/guilds/%00'],
      ['GET', '/guilds/%zz'],
      ['GET', 'guilds/1'],
      ['GET', '/'],
      ['GET', '/not/a/real/path'],
      ['PATCH', '/guilds/123/bans/456'],
    ];
    for (const [method, p] of bad) assert.equal(spec.match(method, p), null, `${method} ${p}`);
  });

  it('matches every filtered operation from a path built from its own template', () => {
    for (const op of spec.operations) {
      const concrete = op.pathTemplate.replace(/\{[^}]+\}/g, '123');
      const m = spec.match(op.method, concrete);
      assert.ok(m, `${op.method} ${concrete}`);
      assert.ok(literalCount(m.op.pathTemplate) >= literalCount(op.pathTemplate), concrete);
    }
  });
});
