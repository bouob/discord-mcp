/**
 * CoreTools - Streamlined MCP tool definitions
 *
 * Reduces 93 tools to 3 core tools:
 * - discord_execute: Execute Discord operations
 * - discord_query: Query Discord data
 * - discord_batch: Execute multiple operations atomically
 *
 * Token reduction: ~17,200 → ~2,000 tokens (88% reduction)
 */

import { getValidOperations, getValidActions, getValidQueryResources } from '../core/ActionMappings.js';

/**
 * Tool definition interface matching MCP SDK
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Core tool definitions - only 3 tools needed!
 */
export const CORE_TOOLS: ToolDefinition[] = [
  // ============================================================================
  // discord_execute - Execute Discord operations
  // ============================================================================
  {
    name: 'discord_execute',
    description: 'Execute Discord operations. Use operation + action + params. Example: operation="message", action="send", params={channelId, content}',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'message', 'dm', 'channel', 'category', 'role', 'member',
            'server', 'voice', 'moderation', 'webhook', 'event',
            'emoji', 'sticker', 'invite', 'file', 'interactive', 'analytics'
          ],
          description: 'Operation category'
        },
        action: {
          type: 'string',
          description: 'Specific action (e.g., send, create, edit, delete)'
        },
        params: {
          type: 'object',
          description: 'Action parameters',
          additionalProperties: true
        }
      },
      required: ['operation', 'action', 'params']
    }
  },

  // ============================================================================
  // discord_query - Query Discord data
  // ============================================================================
  {
    name: 'discord_query',
    description: 'Query Discord data. Resources: messages, channels, members, roles, server, events, invites, webhooks, emojis, stickers, automod_rules, voice_connections',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: [
            'messages', 'pinned_messages', 'message_history', 'attachments', 'dm_messages',
            'channels', 'channel_structure', 'category_channels',
            'members', 'member', 'roles',
            'server', 'server_stats', 'server_widget', 'welcome_screen',
            'events', 'invites', 'webhooks', 'emojis', 'stickers',
            'automod_rules', 'voice_connections'
          ],
          description: 'Resource to query'
        },
        filters: {
          type: 'object',
          description: 'Query filters (channelId, guildId, userId, etc.)',
          additionalProperties: true
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results'
        }
      },
      required: ['resource']
    }
  },

  // ============================================================================
  // discord_batch - Execute multiple operations
  // ============================================================================
  {
    name: 'discord_batch',
    description: 'Execute multiple Discord operations atomically. Each operation has: operation, action, params. Stops on first error by default.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string' },
              action: { type: 'string' },
              params: { type: 'object' }
            },
            required: ['operation', 'action', 'params']
          },
          description: 'Array of operations to execute'
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop execution on first error (default: true)'
        }
      },
      required: ['operations']
    }
  }
];

/**
 * Get help tool - provides documentation on available operations
 */
export const HELP_TOOL: ToolDefinition = {
  name: 'discord_help',
  description: 'Get help on available Discord operations and their parameters',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'Get detailed help for a specific operation'
      }
    },
    required: []
  }
};

/**
 * Operation help documentation
 */
export const OPERATION_HELP: Record<string, { description: string; actions: Record<string, string> }> = {
  message: {
    description: 'Message operations in channels',
    actions: {
      send: 'Send a message. Params: channelId, content',
      edit: 'Edit a message. Params: channelId, messageId, content',
      delete: 'Delete a message. Params: channelId, messageId',
      bulk_delete: 'Delete multiple messages. Params: channelId, messageIds[]',
      pin: 'Pin a message. Params: channelId, messageId',
      unpin: 'Unpin a message. Params: channelId, messageId',
      react: 'Add reaction. Params: channelId, messageId, emoji',
      unreact: 'Remove reaction. Params: channelId, messageId, emoji',
      crosspost: 'Crosspost announcement. Params: channelId, messageId'
    }
  },
  dm: {
    description: 'Direct message operations',
    actions: {
      send: 'Send DM. Params: userId, content',
      edit: 'Edit DM. Params: userId, messageId, content',
      delete: 'Delete DM. Params: userId, messageId',
      get_user_id: 'Get user ID by name. Params: username, guildId?'
    }
  },
  channel: {
    description: 'Channel management',
    actions: {
      create: 'Create channel. Params: name, type (text/voice/forum/announcement/stage/category), guildId?, categoryId?',
      edit: 'Edit channel. Params: channelId, guildId?, name?, topic?, etc.',
      delete: 'Delete channel. Params: channelId, guildId?',
      find: 'Find channel by name. Params: name, guildId?',
      move: 'Move to category. Params: channelId, categoryId, guildId?',
      set_position: 'Set position. Params: channelId, position, guildId?',
      set_positions: 'Bulk set positions. Params: positions[], guildId?',
      set_private: 'Set privacy. Params: channelId, isPrivate, allowedRoles?, guildId?',
      organize: 'Organize channels. Params: organization, guildId?'
    }
  },
  category: {
    description: 'Category management',
    actions: {
      create: 'Create category. Params: name, guildId?',
      delete: 'Delete category. Params: categoryId, guildId?',
      find: 'Find category by name. Params: name, guildId?',
      set_position: 'Set position. Params: categoryId, position, guildId?',
      set_private: 'Set privacy. Params: categoryId, isPrivate, allowedRoles?, guildId?',
      list_channels: 'List channels in category. Params: categoryId, guildId?'
    }
  },
  role: {
    description: 'Role management',
    actions: {
      create: 'Create role. Params: name, color?, permissions?, guildId?',
      edit: 'Edit role. Params: roleId, name?, color?, permissions?, guildId?',
      delete: 'Delete role. Params: roleId, guildId?',
      set_positions: 'Set role positions. Params: positions[], guildId?',
      add_to_member: 'Add role to member. Params: userId, roleId, guildId?',
      remove_from_member: 'Remove role from member. Params: userId, roleId, guildId?'
    }
  },
  member: {
    description: 'Member management',
    actions: {
      edit: 'Edit member. Params: userId, nickname?, roles?, guildId?',
      search: 'Search members. Params: query?, limit?, guildId?'
    }
  },
  server: {
    description: 'Server settings',
    actions: {
      edit: 'Edit server. Params: name?, description?, icon?, banner?, guildId?',
      edit_welcome: 'Edit welcome screen. Params: enabled?, description?, welcomeChannels?, guildId?'
    }
  },
  voice: {
    description: 'Voice channel operations',
    actions: {
      join: 'Join voice channel. Params: channelId, guildId',
      leave: 'Leave voice channel. Params: channelId, guildId',
      play: 'Play audio. Params: url, guildId',
      stop: 'Stop audio. Params: guildId',
      set_volume: 'Set volume (0-200). Params: volume, guildId'
    }
  },
  moderation: {
    description: 'Moderation tools',
    actions: {
      create_automod: 'Create automod rule. Params: name, triggerType, keywordFilter?, guildId?',
      edit_automod: 'Edit automod rule. Params: ruleId, enabled?, keywordFilter?, guildId?',
      delete_automod: 'Delete automod rule. Params: ruleId, guildId?',
      bulk_privacy: 'Bulk set privacy. Params: targets[], guildId?',
      comprehensive: 'Comprehensive channel management. Params: operations[], guildId?'
    }
  },
  webhook: {
    description: 'Webhook management',
    actions: {
      create: 'Create webhook. Params: channelId, name',
      delete: 'Delete webhook. Params: webhookId',
      send: 'Send via webhook. Params: webhookUrl, content'
    }
  },
  event: {
    description: 'Server events',
    actions: {
      create: 'Create event. Params: name, startTime, description?, endTime?, location?, channelId?, guildId?',
      edit: 'Edit event. Params: eventId, name?, startTime?, description?, guildId?',
      delete: 'Delete event. Params: eventId, guildId?'
    }
  },
  emoji: {
    description: 'Custom emoji',
    actions: {
      create: 'Create emoji. Params: name, imageUrl, roles?, guildId?',
      delete: 'Delete emoji. Params: emojiId, guildId?'
    }
  },
  sticker: {
    description: 'Custom stickers',
    actions: {
      create: 'Create sticker. Params: name, description, tags, imageUrl, guildId?',
      delete: 'Delete sticker. Params: stickerId, guildId?'
    }
  },
  invite: {
    description: 'Invite links',
    actions: {
      create: 'Create invite. Params: channelId, maxAge?, maxUses?, temporary?',
      delete: 'Delete invite. Params: inviteCode'
    }
  },
  file: {
    description: 'File operations',
    actions: {
      upload: 'Upload file. Params: channelId, filePath?, fileName?, content?',
      get_attachments: 'Get attachments. Params: channelId, messageId',
      read_images: 'Read images. Params: channelId, messageId?, limit?, includeMetadata?, downloadImages?'
    }
  },
  interactive: {
    description: 'Interactive components',
    actions: {
      send_embed: 'Send embed. Params: channelId, title, description?, color?, fields?, footer?, image?, thumbnail?',
      send_button: 'Send buttons. Params: channelId, content, buttons[]',
      send_select_menu: 'Send select menu. Params: channelId, content, customId, placeholder?, options[]',
      send_modal: 'Send modal (requires interaction). Params: interactionId, title, customId, components[]'
    }
  },
  analytics: {
    description: 'Analytics and logging',
    actions: {
      export_chat: 'Export chat log. Params: channelId, format?, limit?, dateRange?',
      get_history: 'Get message history. Params: channelId, limit?, before?, after?'
    }
  }
};

/**
 * Get all tools (core + help)
 */
export function getAllCoreTools(): ToolDefinition[] {
  return [...CORE_TOOLS, HELP_TOOL];
}

/**
 * Get help text for an operation
 */
export function getOperationHelp(operation?: string): string {
  if (!operation) {
    const ops = Object.keys(OPERATION_HELP).map(op => `• ${op}: ${OPERATION_HELP[op].description}`);
    return `Available operations:\n${ops.join('\n')}\n\nUse discord_help with operation parameter for details.`;
  }

  const help = OPERATION_HELP[operation];
  if (!help) {
    return `Unknown operation: ${operation}. Valid operations: ${Object.keys(OPERATION_HELP).join(', ')}`;
  }

  const actions = Object.entries(help.actions)
    .map(([action, desc]) => `  • ${action}: ${desc}`)
    .join('\n');

  return `${operation}: ${help.description}\n\nActions:\n${actions}`;
}

/**
 * Estimate token count for tools
 */
export function estimateTokenCount(): { core: number; legacy: number; reduction: string } {
  const coreJson = JSON.stringify(CORE_TOOLS);
  const coreTokens = Math.ceil(coreJson.length / 4); // Rough estimate: 4 chars per token

  // Legacy tools estimate (93 tools * ~185 tokens each)
  const legacyTokens = 17200;

  const reduction = ((legacyTokens - coreTokens) / legacyTokens * 100).toFixed(1);

  return {
    core: coreTokens,
    legacy: legacyTokens,
    reduction: `${reduction}%`
  };
}
