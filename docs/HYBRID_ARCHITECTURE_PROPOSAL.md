# Discord MCP + Skill Hybrid Architecture Proposal

## Problem Analysis

### Current Pain Points
| Problem | Current State | Impact |
|---------|---------------|--------|
| Token consumption | 93 tools ≈ 17,200 tokens | Uses 8.6% of context window |
| Tool selection accuracy | Decreases with >50 tools | Claude selects wrong tool |
| Loading method | Full preload | Cannot load on-demand |

## Hybrid Architecture Design

### Core Concept
```
┌─────────────────────────────────────────────────────────┐
│                    Claude Context                        │
├─────────────────────────────────────────────────────────┤
│  Skill (Progressive Disclosure)  │  MCP (Streamlined)   │
│  ├─ Metadata: ~100 tokens        │  ├─ 5-8 core tools   │
│  ├─ Instructions: on-demand      │  └─ ~2,000 tokens    │
│  └─ Scripts: no context cost     │                      │
├─────────────────────────────────────────────────────────┤
│  Total: ~2,100 tokens (was 17,200 tokens)               │
│  Reduction: 88% token consumption                       │
└─────────────────────────────────────────────────────────┘
```

### Streamlined MCP: Core Tools Only

**From 93 tools down to 5-8 universal tools:**

```typescript
const CORE_TOOLS = [
  {
    name: 'discord_execute',
    description: 'Execute Discord API operations via code',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['message', 'channel', 'role', 'member', 'server', 'voice', 'moderation'],
          description: 'Operation category'
        },
        action: { type: 'string', description: 'Specific action to perform' },
        params: { type: 'object', description: 'Action parameters' }
      },
      required: ['operation', 'action', 'params']
    }
  },
  {
    name: 'discord_query',
    description: 'Query Discord data (read-only operations)',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: ['messages', 'channels', 'members', 'roles', 'server', 'events'],
          description: 'Resource to query'
        },
        filters: { type: 'object', description: 'Query filters' },
        limit: { type: 'number', description: 'Result limit' }
      },
      required: ['resource']
    }
  },
  {
    name: 'discord_batch',
    description: 'Execute multiple Discord operations atomically',
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
            }
          }
        }
      },
      required: ['operations']
    }
  }
];
```

### Skill Structure Design

```
discord-skill/
├── SKILL.md                    # Main entry (~100 tokens metadata)
│
├── workflows/                  # Workflow guides (loaded on-demand)
│   ├── messaging.md           # Messaging operations guide
│   ├── channel-management.md  # Channel management guide
│   ├── moderation.md          # Moderation management guide
│   ├── voice.md               # Voice features guide
│   └── server-admin.md        # Server administration guide
│
├── reference/                  # Reference docs (read only when needed)
│   ├── api-actions.md         # Complete action list
│   ├── permissions.md         # Permission reference table
│   └── error-codes.md         # Error code explanations
│
└── scripts/                    # Execution scripts (no context cost)
    ├── validate_params.py     # Parameter validation
    ├── format_response.py     # Response formatting
    └── batch_operations.py    # Batch operations
```

### SKILL.md Design

```markdown
---
name: discord-operations
description: Discord server management and automation guide
version: 2.0.0
triggers:
  - discord
  - server
  - channel
  - message
  - member
---

# Discord Operations Guide

This Skill teaches how to use the streamlined Discord MCP for server management.

## Quick Start

Use `discord_execute` to perform actions, use `discord_query` to query data.

## Operation Categories

| Category | Description | Detailed Guide |
|----------|-------------|----------------|
| Message | Send, edit, delete messages | [workflows/messaging.md](workflows/messaging.md) |
| Channel | Create, manage, organize channels | [workflows/channel-management.md](workflows/channel-management.md) |
| Moderation | Auto-moderation, permissions | [workflows/moderation.md](workflows/moderation.md) |
| Voice | Voice channels, audio playback | [workflows/voice.md](workflows/voice.md) |
| Server | Server settings, statistics | [workflows/server-admin.md](workflows/server-admin.md) |

## Basic Usage

### Send Message
```json
{
  "tool": "discord_execute",
  "params": {
    "operation": "message",
    "action": "send",
    "params": {
      "channelId": "123456789",
      "content": "Hello!"
    }
  }
}
```

### Query Channel List
```json
{
  "tool": "discord_query",
  "params": {
    "resource": "channels",
    "filters": { "type": "text" }
  }
}
```

For complete action list, see [reference/api-actions.md](reference/api-actions.md)
```

## Implementation Plan

### Phase 1: MCP Refactoring (Week 1-2)

#### 1.1 Create Unified Execution Layer
```typescript
// src/core/UnifiedExecutor.ts
export class UnifiedExecutor {
  private actionMap: Map<string, ActionHandler>;

  async execute(operation: string, action: string, params: object) {
    const handler = this.actionMap.get(`${operation}.${action}`);
    if (!handler) throw new Error(`Unknown action: ${operation}.${action}`);
    return handler.execute(params);
  }
}
```

#### 1.2 Refactor Tool Definitions
- Map 93 tools to 5-8 core tools
- Maintain backward compatibility: old tool names as action parameters

#### 1.3 Update inputSchema
- Use JSON Schema's oneOf or anyOf
- Dynamically validate params based on operation

### Phase 2: Skill Creation (Week 2-3)

#### 2.1 Write SKILL.md
- Concise triggers and description
- Navigation to categorized operation guides

#### 2.2 Write workflows
- One markdown per operation category
- Include common use cases and examples

#### 2.3 Write reference
- Complete action mapping table
- Permission and error code references

### Phase 3: Integration Testing (Week 3-4)

#### 3.1 Token Measurement
- Measure actual token consumption of new architecture
- Compare with original architecture

#### 3.2 Functional Testing
- Ensure all original functionality works correctly
- Test Skill's progressive loading

#### 3.3 User Experience Testing
- Verify Claude selects tools correctly
- Test complex workflows

## Tool Mapping Table

### Original Tool → New Tool Mapping

| Original Tool | New Tool Call |
|---------------|---------------|
| `send_message` | `discord_execute({ operation: 'message', action: 'send', ... })` |
| `edit_message` | `discord_execute({ operation: 'message', action: 'edit', ... })` |
| `delete_message` | `discord_execute({ operation: 'message', action: 'delete', ... })` |
| `read_messages` | `discord_query({ resource: 'messages', ... })` |
| `create_text_channel` | `discord_execute({ operation: 'channel', action: 'create', params: { type: 'text', ... } })` |
| `create_voice_channel` | `discord_execute({ operation: 'channel', action: 'create', params: { type: 'voice', ... } })` |
| `get_roles` | `discord_query({ resource: 'roles' })` |
| `create_role` | `discord_execute({ operation: 'role', action: 'create', ... })` |
| `bulk_delete_messages` | `discord_batch({ operations: [...] })` |
| ... | ... |

## Expected Results

### Token Consumption Comparison

| Architecture | Tool Count | Token Usage | Notes |
|--------------|------------|-------------|-------|
| Original MCP | 93 | ~17,200 | Full preload |
| Streamlined MCP | 5-8 | ~2,000 | Core tools |
| Skill metadata | - | ~100 | Progressive |
| **Hybrid Architecture** | **5-8** | **~2,100** | **88% reduction** |

### Other Benefits
1. **Improved tool selection accuracy**: <10 tools, Claude selects accurately
2. **Better maintainability**: Skill instructions easy to update, no MCP restart needed
3. **Extensibility**: New features only need new Skill workflow, no MCP changes
4. **User experience**: Better guidance through Skill documentation

## Alternative Approaches Comparison

| Approach | Token Reduction | Complexity | Maintenance Cost |
|----------|-----------------|------------|------------------|
| Tool merging only | 15-20% | Low | Low |
| Tool Search Tool | 85% | Medium | Medium |
| **MCP + Skill Hybrid** | **88%** | **Medium** | **Low** |
| Pure Code Execution | 98% | High | High |

## Conclusion

The MCP + Skill hybrid architecture is the optimal balanced solution:
- Retains MCP's external connectivity
- Uses Skill's progressive disclosure to reduce tokens
- Provides structured usage guidance through Skill
- Lower maintenance cost, easy to iterate

## References

- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Skills vs MCP Comparison](https://skywork.ai/blog/ai-agent/claude-skills-vs-mcp-vs-llm-tools-comparison-2025/)
- [Skill Authoring Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)
