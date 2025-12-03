/**
 * Action Mappings - Maps new unified API to existing AutomationManager methods
 *
 * Structure:
 * - operation: The category of Discord operations
 * - action: The specific action within that category
 * - method: The corresponding AutomationManager method name
 * - paramMap: How to transform params from new API to old API
 */

export interface ActionMapping {
  method: string;
  paramMap?: Record<string, string>;
  transform?: (params: Record<string, unknown>) => Record<string, unknown>;
}

export interface OperationConfig {
  actions: Record<string, ActionMapping>;
  queryResource?: string;
}

/**
 * Complete mapping of all 93 tools to the unified API
 */
export const OPERATION_MAPPINGS: Record<string, OperationConfig> = {
  // ==========================================================================
  // MESSAGE OPERATIONS
  // ==========================================================================
  message: {
    actions: {
      send: {
        method: 'sendMessage',
        paramMap: { content: 'message' }
      },
      edit: {
        method: 'editMessage',
        paramMap: { content: 'newMessage' }
      },
      delete: {
        method: 'deleteMessage'
      },
      bulk_delete: {
        method: 'bulkDeleteMessages'
      },
      pin: {
        method: 'pinMessage'
      },
      unpin: {
        method: 'unpinMessage'
      },
      react: {
        method: 'addReaction'
      },
      unreact: {
        method: 'removeReaction'
      },
      crosspost: {
        method: 'crosspostMessage'
      }
    },
    queryResource: 'messages'
  },

  // ==========================================================================
  // DIRECT MESSAGE OPERATIONS
  // ==========================================================================
  dm: {
    actions: {
      send: {
        method: 'sendPrivateMessage',
        paramMap: { content: 'message' }
      },
      edit: {
        method: 'editPrivateMessage',
        paramMap: { content: 'newMessage' }
      },
      delete: {
        method: 'deletePrivateMessage'
      },
      get_user_id: {
        method: 'getUserIdByName'
      }
    },
    queryResource: 'dm_messages'
  },

  // ==========================================================================
  // CHANNEL OPERATIONS
  // ==========================================================================
  channel: {
    actions: {
      create: {
        method: 'createChannel',
        transform: (params) => {
          const type = params.type as string || 'text';
          const methodMap: Record<string, string> = {
            text: 'createTextChannel',
            voice: 'createVoiceChannel',
            forum: 'createForumChannel',
            announcement: 'createAnnouncementChannel',
            stage: 'createStageChannel',
            category: 'createCategory'
          };
          return { ...params, _method: methodMap[type] || 'createTextChannel' };
        }
      },
      edit: {
        method: 'editChannelAdvanced'
      },
      delete: {
        method: 'deleteChannel'
      },
      find: {
        method: 'findChannel',
        paramMap: { name: 'channelName' }
      },
      move: {
        method: 'moveChannelToCategory'
      },
      set_position: {
        method: 'setChannelPosition'
      },
      set_positions: {
        method: 'setChannelPositions',
        paramMap: { positions: 'channelPositions' }
      },
      set_private: {
        method: 'setChannelPrivate'
      },
      organize: {
        method: 'organizeChannels'
      }
    },
    queryResource: 'channels'
  },

  // ==========================================================================
  // CATEGORY OPERATIONS
  // ==========================================================================
  category: {
    actions: {
      create: {
        method: 'createCategory'
      },
      delete: {
        method: 'deleteCategory'
      },
      find: {
        method: 'findCategory',
        paramMap: { name: 'categoryName' }
      },
      set_position: {
        method: 'setCategoryPosition'
      },
      set_private: {
        method: 'setCategoryPrivate'
      },
      list_channels: {
        method: 'listChannelsInCategory'
      }
    }
  },

  // ==========================================================================
  // ROLE OPERATIONS
  // ==========================================================================
  role: {
    actions: {
      create: {
        method: 'createRole'
      },
      edit: {
        method: 'editRole'
      },
      delete: {
        method: 'deleteRole'
      },
      set_positions: {
        method: 'setRolePositions',
        paramMap: { positions: 'rolePositions' }
      },
      add_to_member: {
        method: 'addRoleToMember'
      },
      remove_from_member: {
        method: 'removeRoleFromMember'
      }
    },
    queryResource: 'roles'
  },

  // ==========================================================================
  // MEMBER OPERATIONS
  // ==========================================================================
  member: {
    actions: {
      edit: {
        method: 'editMember'
      },
      search: {
        method: 'searchMembers'
      }
    },
    queryResource: 'members'
  },

  // ==========================================================================
  // SERVER OPERATIONS
  // ==========================================================================
  server: {
    actions: {
      edit: {
        method: 'editServer'
      },
      edit_welcome: {
        method: 'editWelcomeScreen'
      }
    },
    queryResource: 'server'
  },

  // ==========================================================================
  // VOICE OPERATIONS
  // ==========================================================================
  voice: {
    actions: {
      join: {
        method: 'joinVoiceChannel'
      },
      leave: {
        method: 'leaveVoiceChannel'
      },
      play: {
        method: 'playAudio',
        paramMap: { url: 'audioUrl' }
      },
      stop: {
        method: 'stopAudio'
      },
      set_volume: {
        method: 'setVolume'
      }
    },
    queryResource: 'voice_connections'
  },

  // ==========================================================================
  // MODERATION OPERATIONS
  // ==========================================================================
  moderation: {
    actions: {
      create_automod: {
        method: 'createAutomodRule'
      },
      edit_automod: {
        method: 'editAutomodRule'
      },
      delete_automod: {
        method: 'deleteAutomodRule'
      },
      bulk_privacy: {
        method: 'bulkSetPrivacy'
      },
      comprehensive: {
        method: 'comprehensiveChannelManagement'
      }
    },
    queryResource: 'automod_rules'
  },

  // ==========================================================================
  // WEBHOOK OPERATIONS
  // ==========================================================================
  webhook: {
    actions: {
      create: {
        method: 'createWebhook'
      },
      delete: {
        method: 'deleteWebhook'
      },
      send: {
        method: 'sendWebhookMessage',
        paramMap: { content: 'message' }
      }
    },
    queryResource: 'webhooks'
  },

  // ==========================================================================
  // EVENT OPERATIONS
  // ==========================================================================
  event: {
    actions: {
      create: {
        method: 'createEvent'
      },
      edit: {
        method: 'editEvent'
      },
      delete: {
        method: 'deleteEvent'
      }
    },
    queryResource: 'events'
  },

  // ==========================================================================
  // EMOJI OPERATIONS
  // ==========================================================================
  emoji: {
    actions: {
      create: {
        method: 'createEmoji'
      },
      delete: {
        method: 'deleteEmoji'
      }
    },
    queryResource: 'emojis'
  },

  // ==========================================================================
  // STICKER OPERATIONS
  // ==========================================================================
  sticker: {
    actions: {
      create: {
        method: 'createSticker'
      },
      delete: {
        method: 'deleteSticker'
      }
    },
    queryResource: 'stickers'
  },

  // ==========================================================================
  // INVITE OPERATIONS
  // ==========================================================================
  invite: {
    actions: {
      create: {
        method: 'createInvite'
      },
      delete: {
        method: 'deleteInvite'
      }
    },
    queryResource: 'invites'
  },

  // ==========================================================================
  // FILE OPERATIONS
  // ==========================================================================
  file: {
    actions: {
      upload: {
        method: 'uploadFile'
      },
      get_attachments: {
        method: 'getMessageAttachments'
      },
      read_images: {
        method: 'readImages'
      }
    }
  },

  // ==========================================================================
  // INTERACTIVE COMPONENT OPERATIONS
  // ==========================================================================
  interactive: {
    actions: {
      send_embed: {
        method: 'sendEmbed'
      },
      send_button: {
        method: 'sendButton'
      },
      send_select_menu: {
        method: 'sendSelectMenu'
      },
      send_modal: {
        method: 'sendModal'
      }
    }
  },

  // ==========================================================================
  // ANALYTICS OPERATIONS
  // ==========================================================================
  analytics: {
    actions: {
      export_chat: {
        method: 'exportChatLog'
      },
      get_history: {
        method: 'getMessageHistory'
      }
    }
  }
};

/**
 * Query resource to method mapping
 */
export const QUERY_MAPPINGS: Record<string, { method: string; paramMap?: Record<string, string> }> = {
  messages: {
    method: 'readMessages',
    paramMap: { limit: 'count' }
  },
  pinned_messages: {
    method: 'getPinnedMessages'
  },
  message_history: {
    method: 'getMessageHistory'
  },
  attachments: {
    method: 'getMessageAttachments'
  },
  dm_messages: {
    method: 'readPrivateMessages',
    paramMap: { limit: 'count' }
  },
  channels: {
    method: 'listChannels'
  },
  channel_structure: {
    method: 'getChannelStructure'
  },
  category_channels: {
    method: 'listChannelsInCategory'
  },
  members: {
    method: 'getMembers'
  },
  member: {
    method: 'getMemberInfo'
  },
  roles: {
    method: 'getRoles'
  },
  server: {
    method: 'getServerInfo'
  },
  server_stats: {
    method: 'getServerStats'
  },
  server_widget: {
    method: 'getServerWidget'
  },
  welcome_screen: {
    method: 'getWelcomeScreen'
  },
  events: {
    method: 'getEvents'
  },
  invites: {
    method: 'getInvites'
  },
  webhooks: {
    method: 'listWebhooks'
  },
  emojis: {
    method: 'getEmojis'
  },
  stickers: {
    method: 'getStickers'
  },
  automod_rules: {
    method: 'getAutomodRules'
  },
  voice_connections: {
    method: 'getVoiceConnections'
  }
};

/**
 * Get all valid operations
 */
export function getValidOperations(): string[] {
  return Object.keys(OPERATION_MAPPINGS);
}

/**
 * Get all valid actions for an operation
 */
export function getValidActions(operation: string): string[] {
  const config = OPERATION_MAPPINGS[operation];
  return config ? Object.keys(config.actions) : [];
}

/**
 * Get all valid query resources
 */
export function getValidQueryResources(): string[] {
  return Object.keys(QUERY_MAPPINGS);
}

/**
 * Resolve action to method and transformed params
 */
export function resolveAction(
  operation: string,
  action: string,
  params: Record<string, unknown>
): { method: string; params: Record<string, unknown> } | null {
  const config = OPERATION_MAPPINGS[operation];
  if (!config) return null;

  const actionConfig = config.actions[action];
  if (!actionConfig) return null;

  // Apply transformation if exists
  let transformedParams = params;
  if (actionConfig.transform) {
    transformedParams = actionConfig.transform(params);
  }

  // Check for dynamic method selection (e.g., channel.create with type)
  let method = actionConfig.method;
  if (transformedParams._method) {
    method = transformedParams._method as string;
    delete transformedParams._method;
  }

  // Apply param mapping
  if (actionConfig.paramMap) {
    const mappedParams: Record<string, unknown> = {};
    for (const [newKey, value] of Object.entries(transformedParams)) {
      const oldKey = actionConfig.paramMap[newKey] || newKey;
      mappedParams[oldKey] = value;
    }
    transformedParams = mappedParams;
  }

  return { method, params: transformedParams };
}

/**
 * Resolve query to method and transformed params
 */
export function resolveQuery(
  resource: string,
  filters: Record<string, unknown>
): { method: string; params: Record<string, unknown> } | null {
  const config = QUERY_MAPPINGS[resource];
  if (!config) return null;

  let transformedParams = { ...filters };

  // Apply param mapping
  if (config.paramMap) {
    const mappedParams: Record<string, unknown> = {};
    for (const [newKey, value] of Object.entries(transformedParams)) {
      const oldKey = config.paramMap[newKey] || newKey;
      mappedParams[oldKey] = value;
    }
    transformedParams = mappedParams;
  }

  return { method: config.method, params: transformedParams };
}
