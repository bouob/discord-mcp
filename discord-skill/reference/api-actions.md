# API Actions Reference

Maintained by hand from `src/core/ActionMappings.ts`. The action names here are checked against that file; `discord_help` gives per-operation usage notes.

## discord_execute Actions

### message
| Action | Params | Description |
|--------|--------|-------------|
| send | channelId, content, [embed, components] | Send message |
| edit | channelId, messageId, content | Edit message |
| delete | channelId, messageId | Delete message |
| bulk_delete | channelId, messageIds[] | Bulk delete (max 100) |
| pin | channelId, messageId | Pin message |
| unpin | channelId, messageId | Unpin message |
| react | channelId, messageId, emoji | Add reaction |
| unreact | channelId, messageId, emoji | Remove reaction |
| crosspost | channelId, messageId | Crosspost announcement |

### dm
| Action | Params | Description |
|--------|--------|-------------|
| send | userId, content | Send DM |
| edit | userId, messageId, content | Edit DM |
| delete | userId, messageId | Delete DM |
| get_user_id | username, [guildId] | Look up a user ID by name |

### channel
| Action | Params | Description |
|--------|--------|-------------|
| create | name, type, [topic, categoryId, userLimit, bitrate] | Create channel |
| edit | channelId, [name, topic, nsfw, rateLimitPerUser] | Edit channel |
| delete | channelId | Delete channel |
| move | channelId, categoryId | Move to category |
| set_position | channelId, position | Set position |
| set_positions | positions[{id, position}] | Bulk set positions |
| set_private | channelId, private, [allowedRoles] | Set privacy |
| find | name, [guildId] | Find a channel by name |
| organize | organization, [guildId] | Reorganize channels into categories |

### role
| Action | Params | Description |
|--------|--------|-------------|
| create | name, [color, permissions, hoist, mentionable] | Create role |
| edit | roleId, [name, color, permissions] | Edit role |
| delete | roleId | Delete role |
| set_positions | positions[{id, position}] | Set role positions |
| add_to_member | roleId, memberId | Add role to member |
| remove_from_member | roleId, memberId | Remove role from member |

### member
| Action | Params | Description |
|--------|--------|-------------|
| edit | userId, [nickname, roles], guildId? | Edit member |
| search | query?, limit?, guildId? | Search members |

### server
| Action | Params | Description |
|--------|--------|-------------|
| edit | [name, icon, banner, description] | Edit server |
| edit_welcome | enabled, [welcomeChannels, description] | Edit welcome screen |

### voice
| Action | Params | Description |
|--------|--------|-------------|
| join | channelId | Join voice channel |
| leave | - | Leave voice channel |
| play | url | Play audio |
| stop | - | Stop audio |
| set_volume | volume (0-100) | Set volume |

### moderation
| Action | Params | Description |
|--------|--------|-------------|
| create_automod | name, triggerType, keywordFilter?, guildId? | Create auto-mod rule |
| edit_automod | ruleId, [name, enabled, keywordFilter], guildId? | Edit auto-mod rule |
| delete_automod | ruleId, guildId? | Delete auto-mod rule |
| ban | userId, reason?, guildId? | Ban member from server |
| unban | userId, reason?, guildId? | Unban member |
| kick | userId, reason?, guildId? | Kick member from server |
| timeout | userId, minutes, reason?, guildId? | Timeout member (minutes) |
| remove_timeout | userId, reason?, guildId? | Remove member timeout |
| bulk_privacy | targets[], guildId? | Bulk set channel privacy |
| comprehensive | operations[], guildId? | Comprehensive channel management |

### thread
| Action | Params | Description |
|--------|--------|-------------|
| create | channelId, name, autoArchiveDuration?, messageId? | Create thread |
| archive | threadId, reason? | Archive thread |
| unarchive | threadId, reason? | Unarchive thread |
| lock | threadId, reason? | Lock thread (prevent new messages) |
| unlock | threadId, reason? | Unlock thread |
| join | threadId | Bot joins thread |
| leave | threadId | Bot leaves thread |

### webhook
| Action | Params | Description |
|--------|--------|-------------|
| create | channelId, name, [avatar] | Create webhook |
| delete | webhookId | Delete webhook |
| send | webhookId, content, [username, avatarURL] | Send via webhook |

### event
| Action | Params | Description |
|--------|--------|-------------|
| create | name, scheduledStartTime, privacyLevel, entityType | Create event |
| edit | eventId, [name, description, scheduledStartTime] | Edit event |
| delete | eventId | Delete event |

### emoji
| Action | Params | Description |
|--------|--------|-------------|
| create | name, image (base64 or URL) | Create emoji |
| delete | emojiId | Delete emoji |

### sticker
| Action | Params | Description |
|--------|--------|-------------|
| create | name, description, tags, file | Create sticker |
| delete | stickerId | Delete sticker |

### invite
| Action | Params | Description |
|--------|--------|-------------|
| create | channelId, [maxAge, maxUses, temporary] | Create invite |
| delete | inviteCode | Delete invite |

### category
| Action | Params | Description |
|--------|--------|-------------|
| create | name, [guildId] | Create category |
| delete | categoryId, [guildId] | Delete category |
| find | name, [guildId] | Find a category by name |
| set_position | categoryId, position, [guildId] | Set position |
| set_private | categoryId, options, [guildId] | Set privacy |
| list_channels | categoryId, [guildId] | List channels in a category |

### file
| Action | Params | Description |
|--------|--------|-------------|
| upload | channelId, filePath, [fileName] | Upload a file: an http(s) URL, or a path inside `DISCORD_MCP_UPLOAD_DIR` (refused when that is unset) |
| get_attachments | channelId, messageId | List attachments of a message |
| read_images | channelId, messageId, [includeMetadata, downloadImages] | Read image attachments |

### interactive
| Action | Params | Description |
|--------|--------|-------------|
| send_embed | channelId, [title, description, color, fields, footer, image, thumbnail] | Send an embed |
| send_button | channelId, buttons | Send buttons (clicks are not handled) |
| send_select_menu | channelId, customId, options, [placeholder, minValues, maxValues] | Send a select menu (selections are not handled) |
| send_modal | — | Not implemented |

### analytics
| Action | Params | Description |
|--------|--------|-------------|
| export_chat | channelId, [format, dateRange] | Up to 100 messages as a 2,000-character preview |
| get_history | channelId, [before, after] | Message history |

`limit` and `content` are renamed internally (see README known issues), so `file.upload` (`content`), `file.read_images` (`limit`), `interactive.send_button` / `send_select_menu` (`content`), `analytics.export_chat` / `get_history` (`limit`) ignore those parameters.

---

## discord_query Resources

| Resource | Filters | Returns |
|----------|---------|---------|
| messages | channelId, limit, before, after | Message[] |
| pinned_messages | channelId | Message[] |
| message_history | channelId, limit?, before?, after? | Message[] |
| attachments | channelId, messageId | Attachment[] |
| dm_messages | userId, limit? | Message[] |
| channels | type, categoryId | Channel[] |
| channel_structure | guildId? | CategoryStructure[] |
| category_channels | categoryId | Channel[] |
| members | limit, query, role | Member[] |
| member | userId | Member |
| roles | guildId? | Role[] |
| server | guildId? | ServerInfo |
| server_stats | guildId? | ServerStats |
| server_widget | guildId? | WidgetInfo |
| welcome_screen | guildId? | WelcomeScreen |
| events | guildId? | Event[] |
| invites | guildId? | Invite[] |
| webhooks | channelId | Webhook[] |
| emojis | guildId? | Emoji[] |
| stickers | guildId? | Sticker[] |
| automod_rules | guildId? | AutoModRule[] |
| voice_connections | - | VoiceConnection[] |
| bans | guildId? | BannedUser[] |
| audit_logs | guildId?, limit? | AuditLogEntry[] |
| active_threads | guildId? | Thread[] |

---

## discord_batch

Execute multiple operations in order (not transactional: completed steps are not rolled back, and a step cannot reference an earlier step's result):

```json
{
  "operations": [
    { "operation": "...", "action": "...", "params": {...} },
    { "operation": "...", "action": "...", "params": {...} }
  ]
}
```

Operations execute in order. If one fails, subsequent operations are skipped.
