/**
 * UnifiedExecutor - Unified execution layer for Discord operations
 *
 * This class provides a single entry point for all Discord operations,
 * routing them to the appropriate AutomationManager methods.
 */

import { AutomationManager } from './AutomationManager.js';
import {
  resolveAction,
  resolveQuery,
  getValidOperations,
  getValidActions,
  getValidQueryResources,
  OPERATION_MAPPINGS
} from './ActionMappings.js';

export interface ExecuteParams {
  operation: string;
  action: string;
  params: Record<string, unknown>;
}

export interface QueryParams {
  resource: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface BatchOperation {
  operation: string;
  action: string;
  params: Record<string, unknown>;
}

export interface BatchParams {
  operations: BatchOperation[];
  stopOnError?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface BatchResult {
  success: boolean;
  results: ExecutionResult[];
  completedCount: number;
  failedCount: number;
}

/**
 * Parameters that should be converted to strings
 */
const STRING_PARAMS = ['count', 'limit', 'position', 'volume'];

/**
 * Parameter aliases (user-friendly → actual API parameter)
 */
const PARAM_ALIASES: Record<string, string> = {
  'limit': 'count',
  'content': 'message',
  'text': 'message',
};

/**
 * Normalize parameters to match API expectations
 * - Converts numbers to strings where required
 * - Maps aliases to actual parameter names
 */
function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    // Apply alias mapping
    const actualKey = PARAM_ALIASES[key] || key;

    // Convert to string if needed
    if (STRING_PARAMS.includes(actualKey) && typeof value === 'number') {
      normalized[actualKey] = String(value);
    } else {
      normalized[actualKey] = value;
    }
  }

  return normalized;
}

/**
 * UnifiedExecutor provides a streamlined interface for Discord operations
 */
export class UnifiedExecutor {
  private automationManager: AutomationManager;

  constructor(automationManager: AutomationManager) {
    this.automationManager = automationManager;
  }

  /**
   * Execute a Discord operation
   */
  async execute(params: ExecuteParams): Promise<ExecutionResult> {
    const { operation, action, params: actionParams } = params;

    // Validate operation
    if (!getValidOperations().includes(operation)) {
      return {
        success: false,
        error: `Invalid operation: '${operation}'. Valid operations: ${getValidOperations().join(', ')}`
      };
    }

    // Validate action
    const validActions = getValidActions(operation);
    if (!validActions.includes(action)) {
      return {
        success: false,
        error: `Invalid action '${action}' for operation '${operation}'. Valid actions: ${validActions.join(', ')}`
      };
    }

    // Normalize parameters (convert numbers to strings, apply aliases)
    const normalizedParams = normalizeParams(actionParams || {});

    // Resolve action to method
    const resolved = resolveAction(operation, action, normalizedParams);
    if (!resolved) {
      return {
        success: false,
        error: `Failed to resolve action: ${operation}.${action}`
      };
    }

    try {
      // Handle special case for channel.create with different types
      let methodName = resolved.method;

      // Call the method on AutomationManager
      const result = await this.callMethod(methodName, resolved.params);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Query Discord data
   */
  async query(params: QueryParams): Promise<ExecutionResult> {
    const { resource, filters = {}, limit } = params;

    // Validate resource
    if (!getValidQueryResources().includes(resource)) {
      return {
        success: false,
        error: `Invalid resource: '${resource}'. Valid resources: ${getValidQueryResources().join(', ')}`
      };
    }

    // Add limit to filters if provided
    const queryFilters = { ...filters };
    if (limit !== undefined) {
      queryFilters.limit = limit;
    }

    // Normalize parameters (convert numbers to strings, apply aliases)
    const normalizedFilters = normalizeParams(queryFilters);

    // Resolve query to method
    const resolved = resolveQuery(resource, normalizedFilters);
    if (!resolved) {
      return {
        success: false,
        error: `Failed to resolve query for resource: ${resource}`
      };
    }

    try {
      const result = await this.callMethod(resolved.method, resolved.params);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Execute multiple operations as a batch
   */
  async batch(params: BatchParams): Promise<BatchResult> {
    const { operations, stopOnError = true } = params;
    const results: ExecutionResult[] = [];
    let completedCount = 0;
    let failedCount = 0;

    for (const op of operations) {
      const result = await this.execute({
        operation: op.operation,
        action: op.action,
        params: op.params
      });

      results.push(result);

      if (result.success) {
        completedCount++;
      } else {
        failedCount++;
        if (stopOnError) {
          break;
        }
      }
    }

    return {
      success: failedCount === 0,
      results,
      completedCount,
      failedCount
    };
  }

  /**
   * Get help information about available operations
   */
  getHelp(): Record<string, unknown> {
    const help: Record<string, unknown> = {
      operations: {},
      queryResources: getValidQueryResources()
    };

    for (const operation of getValidOperations()) {
      (help.operations as Record<string, string[]>)[operation] = getValidActions(operation);
    }

    return help;
  }

  /**
   * Call a method on AutomationManager with params
   */
  private async callMethod(
    methodName: string,
    params: Record<string, unknown>
  ): Promise<string> {
    // Check if method exists
    if (typeof (this.automationManager as unknown as Record<string, unknown>)[methodName] !== 'function') {
      throw new Error(`Method '${methodName}' not found in AutomationManager`);
    }

    // Convert params object to ordered arguments based on method signature
    // For now, we pass params as-is and let AutomationManager handle them
    // The AutomationManager methods use Zod schemas for validation

    const method = (this.automationManager as unknown as Record<string, (...args: unknown[]) => Promise<string>>)[methodName];

    // Get parameter names from method (this is a simplified approach)
    // In production, you might want to use a more robust approach
    const paramValues = this.extractParamValues(methodName, params);

    return await method.call(this.automationManager, ...paramValues);
  }

  /**
   * Extract parameter values in the correct order for method calls
   */
  private extractParamValues(methodName: string, params: Record<string, unknown>): unknown[] {
    // Define parameter order for each method
    // This maps method names to their expected parameter order
    const parameterOrders: Record<string, string[]> = {
      // Message operations
      sendMessage: ['channelId', 'message'],
      editMessage: ['channelId', 'messageId', 'newMessage'],
      deleteMessage: ['channelId', 'messageId'],
      readMessages: ['channelId', 'count'],
      pinMessage: ['channelId', 'messageId'],
      unpinMessage: ['channelId', 'messageId'],
      getPinnedMessages: ['channelId'],
      bulkDeleteMessages: ['channelId', 'messageIds', 'filterOld'],
      crosspostMessage: ['channelId', 'messageId'],
      addReaction: ['channelId', 'messageId', 'emoji'],
      removeReaction: ['channelId', 'messageId', 'emoji'],

      // DM operations
      getUserIdByName: ['username', 'guildId'],
      sendPrivateMessage: ['userId', 'message'],
      editPrivateMessage: ['userId', 'messageId', 'newMessage'],
      deletePrivateMessage: ['userId', 'messageId'],
      readPrivateMessages: ['userId', 'count'],

      // Channel operations
      createTextChannel: ['guildId', 'name', 'categoryId'],
      createVoiceChannel: ['guildId', 'name', 'categoryId', 'userLimit', 'bitrate'],
      createForumChannel: ['guildId', 'name', 'categoryId', 'options'],
      createAnnouncementChannel: ['guildId', 'name', 'categoryId', 'options'],
      createStageChannel: ['guildId', 'name', 'categoryId', 'options'],
      editChannelAdvanced: ['guildId', 'channelId', 'options'],
      deleteChannel: ['guildId', 'channelId'],
      findChannel: ['guildId', 'channelName'],
      listChannels: ['guildId'],
      setChannelPosition: ['guildId', 'channelId', 'position'],
      setChannelPositions: ['guildId', 'channelPositions'],
      moveChannelToCategory: ['guildId', 'channelId', 'categoryId'],
      organizeChannels: ['guildId', 'organization'],
      getChannelStructure: ['guildId'],

      // Category operations
      createCategory: ['guildId', 'name'],
      deleteCategory: ['guildId', 'categoryId'],
      findCategory: ['guildId', 'categoryName'],
      listChannelsInCategory: ['guildId', 'categoryId'],
      setCategoryPosition: ['guildId', 'categoryId', 'position'],

      // Privacy operations
      setChannelPrivate: ['guildId', 'channelId', 'options'],
      setCategoryPrivate: ['guildId', 'categoryId', 'options'],
      bulkSetPrivacy: ['guildId', 'targets'],
      comprehensiveChannelManagement: ['guildId', 'operations'],

      // Role operations
      createRole: ['guildId', 'name', 'color', 'permissions'],
      deleteRole: ['guildId', 'roleId'],
      editRole: ['guildId', 'roleId', 'name', 'color', 'permissions'],
      addRoleToMember: ['guildId', 'userId', 'roleId'],
      removeRoleFromMember: ['guildId', 'userId', 'roleId'],
      getRoles: ['guildId'],
      setRolePositions: ['guildId', 'rolePositions'],

      // Member operations
      getMembers: ['guildId', 'limit', 'after'],
      searchMembers: ['guildId', 'query', 'limit'],
      editMember: ['guildId', 'userId', 'nickname', 'roles'],
      getMemberInfo: ['guildId', 'userId'],

      // Voice operations
      joinVoiceChannel: ['guildId', 'channelId'],
      leaveVoiceChannel: ['guildId', 'channelId'],
      playAudio: ['guildId', 'audioUrl'],
      stopAudio: ['guildId'],
      setVolume: ['guildId', 'volume'],
      getVoiceConnections: [],

      // Event operations
      createEvent: ['guildId', 'name', 'description', 'startTime', 'endTime', 'location', 'channelId'],
      editEvent: ['guildId', 'eventId', 'name', 'description', 'startTime', 'endTime', 'location'],
      deleteEvent: ['guildId', 'eventId'],
      getEvents: ['guildId'],

      // Invite operations
      createInvite: ['channelId', 'maxAge', 'maxUses', 'temporary'],
      deleteInvite: ['inviteCode'],
      getInvites: ['guildId'],

      // Webhook operations
      createWebhook: ['channelId', 'name'],
      deleteWebhook: ['webhookId'],
      listWebhooks: ['channelId'],
      sendWebhookMessage: ['webhookUrl', 'message'],

      // Emoji operations
      createEmoji: ['guildId', 'name', 'imageUrl', 'roles'],
      deleteEmoji: ['guildId', 'emojiId'],
      getEmojis: ['guildId'],

      // Sticker operations
      createSticker: ['guildId', 'name', 'description', 'tags', 'imageUrl'],
      deleteSticker: ['guildId', 'stickerId'],
      getStickers: ['guildId'],

      // File operations
      uploadFile: ['channelId', 'filePath', 'fileName', 'content'],
      getMessageAttachments: ['channelId', 'messageId'],
      readImages: ['channelId', 'messageId', 'limit', 'includeMetadata', 'downloadImages'],

      // Automod operations
      createAutomodRule: ['guildId', 'name', 'eventType', 'triggerType', 'keywordFilter', 'presets', 'allowList', 'mentionLimit', 'enabled'],
      editAutomodRule: ['guildId', 'ruleId', 'name', 'enabled', 'keywordFilter', 'allowList', 'mentionLimit'],
      deleteAutomodRule: ['guildId', 'ruleId'],
      getAutomodRules: ['guildId'],

      // Server operations
      getServerInfo: ['guildId'],
      editServer: ['guildId', 'name', 'description', 'icon', 'banner', 'verificationLevel'],
      getServerStats: ['guildId'],
      getServerWidget: ['guildId'],
      getWelcomeScreen: ['guildId'],
      editWelcomeScreen: ['guildId', 'enabled', 'description', 'welcomeChannels'],

      // Interactive operations
      sendEmbed: ['channelId', 'title', 'description', 'color', 'fields', 'footer', 'image', 'thumbnail'],
      sendButton: ['channelId', 'content', 'buttons'],
      sendSelectMenu: ['channelId', 'content', 'customId', 'placeholder', 'minValues', 'maxValues', 'options'],
      sendModal: ['interactionId', 'title', 'customId', 'components'],

      // Analytics operations
      getMessageHistory: ['channelId', 'limit', 'before', 'after'],
      exportChatLog: ['channelId', 'format', 'limit', 'dateRange']
    };

    const order = parameterOrders[methodName];
    if (!order) {
      // Fallback: return all param values
      return Object.values(params);
    }

    // Handle special cases for options objects
    if (order.includes('options')) {
      const optionKeys = ['topic', 'slowmode', 'userLimit', 'bitrate', 'isPrivate', 'allowedRoles',
                          'allowedMembers', 'syncToCategory', 'applyToChannels', 'categoryId',
                          'defaultReactionEmoji', 'nsfw', 'rateLimitPerUser'];
      const options: Record<string, unknown> = {};
      for (const key of optionKeys) {
        if (params[key] !== undefined) {
          options[key] = params[key];
        }
      }

      return order.map(key => {
        if (key === 'options') {
          return Object.keys(options).length > 0 ? options : undefined;
        }
        return params[key];
      });
    }

    return order.map(key => params[key]);
  }
}

/**
 * Create a UnifiedExecutor instance
 */
export function createUnifiedExecutor(automationManager: AutomationManager): UnifiedExecutor {
  return new UnifiedExecutor(automationManager);
}
