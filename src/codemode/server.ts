// Code Mode MCP server: two tools (discord_search, discord_execute) over stdio, REST only.
// Never write to stdout here: stdout is the MCP stdio channel. Logs and audit go to stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_LIMITS, runExecute, textResult, toJson, truncate } from './execute.js';
import type { CodeModeLimits, ToolResult } from './execute.js';
import { createPolicy, policyConfigFromEnv } from './policy.js';
import { createRestExecutor } from './rest.js';
import { runInSandbox } from './sandbox.js';
import { loadSpec } from './spec.js';
import { CODEMODE_TOOLS } from './tools.js';
import type { LoadedSpec, PolicyConfig, RestExecutor } from './types.js';

export interface CodeModeDeps {
  spec: LoadedSpec;
  policyConfig: PolicyConfig;
  /** null when DISCORD_TOKEN is unset: search still works, execute reports the missing token. */
  rest: RestExecutor | null;
  defaultGuildId: string | null;
  limits?: Partial<CodeModeLimits>;
  /** Audit sink; defaults to stderr. */
  audit?: (line: string) => void;
}

export interface CodeMode {
  tools: Tool[];
  call(name: string, args: unknown): Promise<ToolResult>;
}

async function runSearch(code: string, spec: LoadedSpec, limits: CodeModeLimits): Promise<ToolResult> {
  const out = await runInSandbox({
    code,
    globalsJson: { spec: spec.sandboxJson },
    hostObjects: {},
    limits: { memoryBytes: limits.memoryBytes, timeoutMs: limits.timeoutMs },
  });
  if (!out.ok) return textResult(`Error: ${out.error}`, true);
  return textResult(truncate(toJson(out.value ?? null), limits.maxOutputChars));
}

export function createCodeMode(deps: CodeModeDeps): CodeMode {
  const limits: CodeModeLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const audit = deps.audit ?? ((line: string) => void process.stderr.write(line));
  const { rest } = deps;
  const policy = rest ? createPolicy(deps.spec, deps.policyConfig, rest) : null;

  const execute = async (code: string): Promise<ToolResult> => {
    if (!rest || !policy) return textResult('DISCORD_TOKEN is not set', true);
    return runExecute(code, { rest, policy, defaultGuildId: deps.defaultGuildId, limits, audit });
  };

  return {
    tools: CODEMODE_TOOLS,
    async call(name, args) {
      const code = (args as { code?: unknown } | null | undefined)?.code;
      if (name !== 'discord_search' && name !== 'discord_execute') {
        return textResult(`Unknown tool: ${name}. Available tools: discord_search, discord_execute`, true);
      }
      if (typeof code !== 'string') return textResult('`code` must be a string', true);
      try {
        return name === 'discord_search' ? await runSearch(code, deps.spec, limits) : await execute(code);
      } catch (err) {
        return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  };
}

export async function runCodeModeServer(): Promise<void> {
  const policyConfig = policyConfigFromEnv(process.env);
  const token = process.env.DISCORD_TOKEN;
  const codeMode = createCodeMode({
    spec: loadSpec(),
    policyConfig,
    rest: token ? createRestExecutor(token) : null,
    defaultGuildId: process.env.DISCORD_GUILD_ID || null,
  });

  const server = new Server(
    { name: 'discord-mcp-server-codemode', version: '2.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: codeMode.tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    codeMode.call(request.params.name, request.params.arguments),
  );

  process.stderr.write(
    `[Discord MCP] Running in CODEMODE (2 tools, read-only: ${policyConfig.readOnly})\n`,
  );
  if (!token) process.stderr.write('[Discord MCP] DISCORD_TOKEN is not set: discord_execute is disabled\n');
  await server.connect(new StdioServerTransport());
}
