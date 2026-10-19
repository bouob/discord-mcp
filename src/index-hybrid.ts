#!/usr/bin/env node
/**
 * Discord MCP Server - Hybrid Architecture
 *
 * Entry point for all modes, selected by DISCORD_MCP_MODE:
 * - hybrid (default): 4 core tools instead of 93 individual tools
 * - codemode: discord_search + discord_execute over the Discord OpenAPI spec
 * - legacy: the original 93-tool server (DISCORD_MCP_LEGACY=true is an alias)
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DiscordService } from './discord-service.js';
import { createSseHttpServer, SSE_HOST } from './sse.js';
import { AutomationManager } from './core/AutomationManager.js';
import { DiscordController } from './core/DiscordController.js';
import { UnifiedExecutor, createUnifiedExecutor } from './core/UnifiedExecutor.js';
import { CORE_TOOLS, getAllCoreTools, getOperationHelp } from './tools/CoreTools.js';

// Mode routing: DISCORD_MCP_MODE wins; DISCORD_MCP_LEGACY=true is the backward-compatible alias.
const MODE = process.env.DISCORD_MCP_MODE ?? (process.env.DISCORD_MCP_LEGACY === 'true' ? 'legacy' : 'hybrid');

if (MODE === 'codemode') {
  import('./codemode/server.js')
    .then((m) => m.runCodeModeServer())
    .catch((error) => {
      console.error('[Discord MCP] Fatal error:', error);
      process.exit(1);
    });
} else if (MODE === 'legacy') {
  console.error('[Discord MCP] Running in LEGACY mode (93 tools)');
  console.error('[Discord MCP] Set DISCORD_MCP_LEGACY=false to use the new streamlined mode');
  // Import and run the legacy index
  import('./index.js');
} else if (MODE === 'hybrid') {
  // Run hybrid mode
  runHybridServer();
} else {
  console.error(`[Discord MCP] Unknown DISCORD_MCP_MODE "${MODE}". Use hybrid, codemode or legacy.`);
  process.exit(1);
}

async function runHybridServer() {
  console.error('[Discord MCP] Running in HYBRID mode (4 core tools)');

  const server = new Server(
    {
      name: 'discord-mcp-server-hybrid',
      version: '2.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let discordService: DiscordService;
  let automationManager: AutomationManager;
  let discordController: DiscordController;
  let unifiedExecutor: UnifiedExecutor;

  // Initialize Discord service
  async function initializeDiscord() {
    discordController = new DiscordController();
    await discordController.initialize();
    discordService = discordController.getDiscordService();
    automationManager = discordController.getAutomationManager();
    unifiedExecutor = createUnifiedExecutor(automationManager);
  }

  // List tools handler - returns the 4 core tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getAllCoreTools()
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // ====================================================================
        // discord_execute - Execute Discord operations
        // ====================================================================
        case 'discord_execute': {
          const { operation, action, params } = args as {
            operation: string;
            action: string;
            params: Record<string, unknown>;
          };

          const result = await unifiedExecutor.execute({
            operation,
            action,
            params: params || {}
          });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error: ${result.error}` }],
              isError: true
            };
          }

          return {
            content: [{ type: 'text', text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2) }]
          };
        }

        // ====================================================================
        // discord_query - Query Discord data
        // ====================================================================
        case 'discord_query': {
          const { resource, filters, limit } = args as {
            resource: string;
            filters?: Record<string, unknown>;
            limit?: number;
          };

          const result = await unifiedExecutor.query({
            resource,
            filters: filters || {},
            limit
          });

          if (!result.success) {
            return {
              content: [{ type: 'text', text: `Error: ${result.error}` }],
              isError: true
            };
          }

          return {
            content: [{ type: 'text', text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2) }]
          };
        }

        // ====================================================================
        // discord_batch - Execute multiple operations
        // ====================================================================
        case 'discord_batch': {
          const { operations, stopOnError } = args as {
            operations: Array<{
              operation: string;
              action: string;
              params: Record<string, unknown>;
            }>;
            stopOnError?: boolean;
          };

          const result = await unifiedExecutor.batch({
            operations,
            stopOnError: stopOnError ?? true
          });

          const summary = {
            success: result.success,
            completed: result.completedCount,
            failed: result.failedCount,
            results: result.results.map((r, i) => ({
              operation: `${operations[i].operation}.${operations[i].action}`,
              success: r.success,
              ...(r.error ? { error: r.error } : {}),
              ...(r.data ? { data: typeof r.data === 'string' ? r.data.substring(0, 100) + '...' : r.data } : {})
            }))
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            isError: !result.success
          };
        }

        // ====================================================================
        // discord_help - Get help on operations
        // ====================================================================
        case 'discord_help': {
          const { operation } = args as { operation?: string };
          const helpText = getOperationHelp(operation);

          return {
            content: [{ type: 'text', text: helpText }]
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}. Available tools: discord_execute, discord_query, discord_batch, discord_help` }],
            isError: true
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true
      };
    }
  });

  // Start server
  async function runServer() {
    await initializeDiscord();

    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'sse') {
      const port = parseInt(process.env.MCP_PORT || '3000', 10);
      createSseHttpServer(server, port).listen(port, SSE_HOST, () => {
        console.error(`[Discord MCP] SSE server running on http://${SSE_HOST}:${port}/sse`);
      });
    } else {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('[Discord MCP] Connected via stdio');
    }
  }

  runServer().catch(error => {
    console.error('[Discord MCP] Fatal error:', error);
    process.exit(1);
  });
}
