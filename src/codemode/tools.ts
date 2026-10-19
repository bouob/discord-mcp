// MCP tool definitions for Code Mode. Kept compact: the whole tools/list must stay <= 4,000 chars.
// Never write to stdout here: stdout is the MCP stdio channel.

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const SEARCH_DESCRIPTION = [
  'Search the Discord REST API v10 spec by running JavaScript. `code` is an async arrow function; its return value is returned as JSON (truncated at 24000 chars). Call this before discord_execute to find paths, parameters and bodies.',
  '',
  'declare const spec: {',
  "  paths: Record<string, Partial<Record<'get'|'post'|'put'|'patch'|'delete', {",
  '    operationId: string; summary?: string; parameters?: unknown[];',
  '    requestBody?: { required: boolean; contentType: string; schema: unknown };',
  '    response?: { status: number; schema?: unknown };',
  '  }>>>;',
  '  schemas: Record<string, unknown>;',
  '};',
  "// Nested { $ref: 'Name' } resolves to spec.schemas.Name",
  '',
  "async () => Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).filter(([, o]) => o.operationId.includes('ban')).map(([k, o]) => k.toUpperCase() + ' ' + p))",
  "async () => spec.paths['/guilds/{guild_id}/bans/{user_id}'].put.requestBody",
].join('\n');

const EXECUTE_DESCRIPTION = [
  'Run JavaScript against the Discord REST API v10. `code` is an async arrow function; return a small summary (JSON, truncated at 24000 chars) and filter data in code. Find paths/bodies with discord_search first.',
  'Read-only by default; denied calls throw. Max 50 requests and 30 s per call. `reason` goes to the audit log.',
  '',
  'declare const discord: {',
  '  request<T = unknown>(opts: {',
  "    method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';",
  '    path: string; // concrete, e.g. /guilds/123/bans/456',
  '    query?: Record<string, string|number|boolean>; body?: unknown; reason?: string;',
  '  }): Promise<{ status: number; data: T }>; // non-2xx resolves, check status',
  '};',
  'declare const defaultGuildId: string | null;',
  'declare const permissions: {',
  '  names(bitfield: string): Promise<string[]>; bits(names: string[]): Promise<string>;',
  '  effective(o: { guildId: string; userId: string; channelId?: string }): Promise<string[]>;',
  '};',
  '',
  "async () => (await discord.request({ method: 'GET', path: '/guilds/' + defaultGuildId + '/channels' })).data.map(c => c.name)",
].join('\n');

function codeSchema(description: string): Tool['inputSchema'] {
  return {
    type: 'object',
    properties: { code: { type: 'string', description } },
    required: ['code'],
  };
}

export const CODEMODE_TOOLS: Tool[] = [
  {
    name: 'discord_search',
    description: SEARCH_DESCRIPTION,
    inputSchema: codeSchema('Async arrow function using the global `spec`'),
  },
  {
    name: 'discord_execute',
    description: EXECUTE_DESCRIPTION,
    inputSchema: codeSchema('Async arrow function using `discord`, `permissions`, `defaultGuildId`'),
  },
];
