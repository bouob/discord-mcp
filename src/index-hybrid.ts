#!/usr/bin/env node
/**
 * Discord MCP Server - Hybrid Architecture
 *
 * This is the new streamlined entry point that uses only 3 core tools
 * instead of 93 individual tools, reducing token consumption by ~88%.
 *
 * Environment Variables:
 * - DISCORD_MCP_LEGACY=true : Use legacy 93-tool mode (backward compatible)
 * - DISCORD_MCP_LEGACY=false : Use new 3-tool mode (default)
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { URL } from 'node:url';

import { DiscordService } from './discord-service.js';
import { AutomationManager } from './core/AutomationManager.js';
import { DiscordController } from './core/DiscordController.js';
import { UnifiedExecutor, createUnifiedExecutor } from './core/UnifiedExecutor.js';
import { CORE_TOOLS, getAllCoreTools, getOperationHelp } from './tools/CoreTools.js';

// Check for legacy mode
const USE_LEGACY_MODE = process.env.DISCORD_MCP_LEGACY === 'true';

if (USE_LEGACY_MODE) {
  console.error('[Discord MCP] Running in LEGACY mode (93 tools)');
  console.error('[Discord MCP] Set DISCORD_MCP_LEGACY=false to use the new streamlined mode');
  // Import and run the legacy index
  import('./index.js');
} else {
  // Run hybrid mode
  runHybridServer();
}

async function runHybridServer() {
  console.error('[Discord MCP] Running in HYBRID mode (3 core tools)');

  const server = new Server(
    {
      name: 'discord-mcp-server-hybrid',
      version: '2.0.0',
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

  // List tools handler - returns only 3-4 tools
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
      const httpServer = createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://localhost:${port}`);

        if (url.pathname === '/sse' && req.method === 'GET') {
          const transport = new SSEServerTransport('/message', res);
          server.connect(transport);
        } else if (url.pathname === '/message' && req.method === 'POST') {
          // Handle message endpoint
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            res.writeHead(200);
            res.end();
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      httpServer.listen(port, () => {
        console.error(`[Discord MCP] SSE server running on port ${port}`);
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
