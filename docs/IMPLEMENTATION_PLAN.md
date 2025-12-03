# Discord MCP + Skill Hybrid Architecture Implementation Plan

## Table of Contents
1. [Implementation Overview](#1-implementation-overview)
2. [Prerequisites](#2-prerequisites)
3. [Phased Implementation Plan](#3-phased-implementation-plan)
4. [Migration Strategy](#4-migration-strategy)
5. [Testing Plan](#5-testing-plan)
6. [Rollback Strategy](#6-rollback-strategy)
7. [Risk Assessment and Mitigation](#7-risk-assessment-and-mitigation)
8. [Success Metrics](#8-success-metrics)

---

## 1. Implementation Overview

### 1.1 Goals
Refactor the existing 93 MCP tools into MCP + Skill hybrid architecture to achieve:
- 88% token consumption reduction (17,200 → 2,100 tokens)
- Improved tool selection accuracy
- Better maintainability and extensibility

### 1.2 Scope

| Item | Changes |
|------|---------|
| MCP Server | 93 tools → 3 core tools |
| Skill | Add discord-skill folder |
| Documentation | Update README and usage guides |
| Testing | Add integration tests |

### 1.3 Timeline Overview

```
Week 1-2: Phase 1 - Foundation
Week 2-3: Phase 2 - MCP Refactoring
Week 3-4: Phase 3 - Skill Completion
Week 4-5: Phase 4 - Integration Testing
Week 5-6: Phase 5 - Official Release
```

---

## 2. Prerequisites

### 2.1 Environment Requirements

```bash
# Node.js version
node >= 18.0.0

# Required packages
npm install zod @modelcontextprotocol/sdk

# Development dependencies
npm install -D typescript vitest
```

### 2.2 Branch Strategy

```
main
├── develop
│   ├── feature/mcp-refactor      # MCP refactoring
│   ├── feature/skill-structure   # Skill structure
│   └── feature/migration-layer   # Migration layer
└── release/v2.0.0                # Official release
```

### 2.3 Checklist

- [ ] Backup existing `src/index.ts`
- [ ] Confirm all existing tests pass
- [ ] Establish performance baseline measurements
- [ ] Notify relevant users of upcoming changes
- [ ] Set up CI/CD pipeline

---

## 3. Phased Implementation Plan

### Phase 1: Foundation (Week 1-2)

#### 3.1.1 Create Unified Execution Layer

**Goal**: Create new UnifiedExecutor class as unified entry point for all operations

**File**: `src/core/UnifiedExecutor.ts`

```typescript
// Implementation outline
export class UnifiedExecutor {
  private operationHandlers: Map<string, OperationHandler>;

  constructor(discordService: DiscordService) {
    this.registerHandlers();
  }

  async execute(operation: string, action: string, params: object): Promise<Result> {
    // 1. Validate operation and action
    // 2. Route to corresponding handler
    // 3. Execute and return result
  }

  async query(resource: string, filters: object): Promise<QueryResult> {
    // Query operations
  }

  async batch(operations: Operation[]): Promise<BatchResult> {
    // Batch operations
  }
}
```

**Task List**:
- [ ] Create `UnifiedExecutor.ts`
- [ ] Define `OperationHandler` interface
- [ ] Implement operation routing logic
- [ ] Write unit tests

#### 3.1.2 Define Action Mappings

**File**: `src/core/ActionMappings.ts`

```typescript
export const ACTION_MAPPINGS = {
  message: {
    send: 'send_message',
    edit: 'edit_message',
    delete: 'delete_message',
    // ... map to legacy methods
  },
  channel: {
    create: ['create_text_channel', 'create_voice_channel', ...],
    // ...
  },
  // ...
};
```

**Task List**:
- [ ] Complete mapping of all 93 tools to new architecture
- [ ] Define parameter conversion rules
- [ ] Write mapping validation tests

---

### Phase 2: MCP Refactoring (Week 2-3)

#### 3.2.1 Create New Tool Definitions

**File**: `src/tools/CoreTools.ts`

```typescript
export const CORE_TOOLS = [
  {
    name: 'discord_execute',
    description: 'Execute Discord operations',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['message', 'channel', 'role', 'member', 'server', 'voice', 'moderation', 'dm', 'webhook', 'event', 'emoji', 'sticker', 'invite'],
        },
        action: { type: 'string' },
        params: { type: 'object' }
      },
      required: ['operation', 'action', 'params']
    }
  },
  {
    name: 'discord_query',
    description: 'Query Discord data',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: ['messages', 'channels', 'members', 'roles', 'server', 'events', 'invites', 'webhooks', 'emojis', 'stickers', 'automod_rules', 'voice_connections']
        },
        filters: { type: 'object' },
        limit: { type: 'number' }
      },
      required: ['resource']
    }
  },
  {
    name: 'discord_batch',
    description: 'Execute multiple operations atomically',
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

**Task List**:
- [ ] Create `CoreTools.ts`
- [ ] Define complete JSON Schema
- [ ] Implement tool call handlers

#### 3.2.2 Modify index.ts

**Key Changes**:
1. Import new core tools
2. Retain legacy tools as compatibility layer (optional)
3. Route to UnifiedExecutor

```typescript
// src/index.ts modification outline

import { CORE_TOOLS } from './tools/CoreTools.js';
import { LEGACY_TOOLS } from './tools/LegacyTools.js'; // Optional retention
import { UnifiedExecutor } from './core/UnifiedExecutor.js';

// Tool list configuration
const USE_LEGACY_MODE = process.env.DISCORD_MCP_LEGACY === 'true';

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: USE_LEGACY_MODE ? LEGACY_TOOLS : CORE_TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (CORE_TOOLS.some(t => t.name === name)) {
    return handleCoreToolCall(name, args);
  } else {
    return handleLegacyToolCall(name, args); // Backward compatibility
  }
});
```

**Task List**:
- [ ] Refactor `index.ts`
- [ ] Implement `handleCoreToolCall`
- [ ] Test mode switching between new and legacy

---

### Phase 3: Skill Completion (Week 3-4)

#### 3.3.1 Complete All Workflow Documentation

Files to create:

| File | Content |
|------|---------|
| `workflows/roles.md` | Role management guide |
| `workflows/members.md` | Member management guide |
| `workflows/server-admin.md` | Server administration guide |
| `workflows/voice.md` | Voice features guide |
| `workflows/moderation.md` | Moderation features guide |
| `workflows/webhooks.md` | Webhook guide |
| `workflows/events.md` | Event management guide |

**Task List**:
- [ ] Write `roles.md`
- [ ] Write `members.md`
- [ ] Write `server-admin.md`
- [ ] Write `voice.md`
- [ ] Write `moderation.md`
- [ ] Write `webhooks.md`
- [ ] Write `events.md`

#### 3.3.2 Complete Reference Documentation

| File | Content |
|------|---------|
| `reference/permissions.md` | Discord permissions reference |
| `reference/error-codes.md` | Error code explanations |
| `reference/rate-limits.md` | API rate limiting guide |

**Task List**:
- [ ] Write `permissions.md`
- [ ] Write `error-codes.md`
- [ ] Write `rate-limits.md`

#### 3.3.3 Create Helper Scripts

```
scripts/
├── validate_params.py    # Parameter validation
├── format_response.py    # Response formatting
└── batch_operations.py   # Batch operation helpers
```

**Task List**:
- [ ] Write validation scripts
- [ ] Write formatting scripts
- [ ] Write batch operation scripts

---

### Phase 4: Integration Testing (Week 4-5)

#### 3.4.1 Test Items

**Functional Test Matrix**:

| Operation Category | Test Items | Expected Result |
|-------------------|------------|-----------------|
| message | send, edit, delete, react | ✓ Consistent with legacy behavior |
| channel | create, edit, delete, move | ✓ Consistent with legacy behavior |
| role | create, edit, delete, assign | ✓ Consistent with legacy behavior |
| member | query, edit, kick, ban | ✓ Consistent with legacy behavior |
| voice | join, leave, play, stop | ✓ Consistent with legacy behavior |
| moderation | automod CRUD | ✓ Consistent with legacy behavior |
| batch | Multi-operation combinations | ✓ Atomic execution |

**Task List**:
- [ ] Write integration tests for all operation categories
- [ ] Execute performance tests
- [ ] Execute compatibility tests

#### 3.4.2 Token Consumption Measurement

```typescript
// Test script
async function measureTokenUsage() {
  const legacyTools = getLegacyTools();
  const coreTools = getCoreTools();

  const legacyTokens = estimateTokens(JSON.stringify(legacyTools));
  const coreTokens = estimateTokens(JSON.stringify(coreTools));

  console.log(`Legacy: ${legacyTokens} tokens`);
  console.log(`Core: ${coreTokens} tokens`);
  console.log(`Reduction: ${((legacyTokens - coreTokens) / legacyTokens * 100).toFixed(1)}%`);
}
```

**Acceptance Criteria**:
- [ ] Token reduction >= 85%
- [ ] All functional tests pass
- [ ] No performance degradation

---

### Phase 5: Official Release (Week 5-6)

#### 3.5.1 Release Checklist

- [ ] All tests pass
- [ ] Documentation updates complete
- [ ] CHANGELOG updated
- [ ] Version number updated (v2.0.0)
- [ ] README updated
- [ ] Migration guide complete

#### 3.5.2 Release Steps

```bash
# 1. Merge to main
git checkout main
git merge release/v2.0.0

# 2. Tag release
git tag -a v2.0.0 -m "MCP + Skill hybrid architecture"

# 3. Publish
git push origin main --tags
npm publish
```

---

## 4. Migration Strategy

### 4.1 Backward Compatibility Mode

Provide environment variable control for users to choose between legacy and new versions:

```bash
# Use legacy (93 tools)
DISCORD_MCP_LEGACY=true

# Use new (3 core tools) - Default
DISCORD_MCP_LEGACY=false
```

### 4.2 Gradual Migration Path

```
Stage 1: Dual-track operation (v2.0.0)
├── Default to new architecture
├── Support LEGACY=true switch
└── Warning that legacy will be removed in v3.0.0

Stage 2: Deprecation warning (v2.1.0)
├── Legacy features marked as deprecated
└── Add migration helper tools

Stage 3: Complete removal (v3.0.0)
├── Remove legacy code
└── Only retain new architecture
```

### 4.3 Tool Call Conversion Examples

#### Send Message
```json
// Legacy
{ "tool": "send_message", "channelId": "123", "message": "Hello" }

// New
{ "tool": "discord_execute", "operation": "message", "action": "send",
  "params": { "channelId": "123", "content": "Hello" } }
```

#### Create Channel
```json
// Legacy
{ "tool": "create_text_channel", "name": "general", "categoryId": "456" }

// New
{ "tool": "discord_execute", "operation": "channel", "action": "create",
  "params": { "name": "general", "type": "text", "categoryId": "456" } }
```

#### Query Members
```json
// Legacy
{ "tool": "get_members", "limit": 100 }

// New
{ "tool": "discord_query", "resource": "members", "limit": 100 }
```

---

## 5. Testing Plan

### 5.1 Unit Tests

| Module | Test Focus | Coverage Target |
|--------|------------|-----------------|
| UnifiedExecutor | Operation routing, error handling | >= 90% |
| ActionMappings | Mapping correctness | 100% |
| CoreTools | Schema validation | 100% |

### 5.2 Integration Tests

```typescript
describe('Discord MCP Hybrid Architecture', () => {
  describe('discord_execute', () => {
    test('message.send works correctly', async () => { /* ... */ });
    test('channel.create works correctly', async () => { /* ... */ });
    // ... all operation.action combinations
  });

  describe('discord_query', () => {
    test('messages query returns correct format', async () => { /* ... */ });
    // ... all resource queries
  });

  describe('discord_batch', () => {
    test('executes operations atomically', async () => { /* ... */ });
    test('rolls back on failure', async () => { /* ... */ });
  });

  describe('backward compatibility', () => {
    test('legacy tools still work in LEGACY mode', async () => { /* ... */ });
  });
});
```

### 5.3 Performance Tests

| Metric | Baseline (Legacy) | Target (New) |
|--------|-------------------|--------------|
| Tool definition size | ~17,200 tokens | < 2,500 tokens |
| Tool load time | 100ms | <= 100ms |
| Operation execution time | N ms | <= N ms |

### 5.4 User Acceptance Testing (UAT)

- [ ] Invite 3-5 existing users for testing
- [ ] Collect feedback and adjust
- [ ] Ensure documentation is clear and understandable

---

## 6. Rollback Strategy

### 6.1 Trigger Conditions

Rollback should be triggered in these situations:
- Core functionality fails (send message, create channel, etc.)
- Token consumption reduction not as expected
- Serious performance issues
- Large amount of negative user feedback

### 6.2 Rollback Steps

```bash
# 1. Switch to stable version
git checkout v1.x.x

# 2. Redeploy
npm install
npm run build

# 3. Notify users
# Send announcement explaining rollback reason and expected fix timeline
```

### 6.3 Quick Mitigation

If immediate rollback is not possible, force legacy mode via environment variable:

```bash
DISCORD_MCP_LEGACY=true npm start
```

---

## 7. Risk Assessment and Mitigation

### 7.1 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Feature gaps | Medium | High | Complete mapping tests |
| Performance degradation | Low | Medium | Performance baseline tests |
| User resistance | Medium | Medium | Gradual migration, complete docs |
| Skill loading issues | Low | Medium | Provide pure MCP fallback |
| Discord API changes | Low | High | Abstraction layer isolation |

### 7.2 Detailed Mitigation Strategies

#### Feature Gaps
- Build complete feature comparison table
- Every legacy tool has corresponding new call method
- Automated tests ensure consistency

#### User Resistance
- Provide sufficient migration period (at least 2 major versions)
- Complete migration documentation and examples
- Retain LEGACY mode as safety net

---

## 8. Success Metrics

### 8.1 Quantitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Token reduction | >= 85% | Tool definition size comparison |
| Feature coverage | 100% | Test pass rate |
| Performance | No degradation | Operation execution time |
| User satisfaction | >= 80% | Survey |

### 8.2 Qualitative Metrics

- [ ] Documentation clarity: Users can understand new architecture within 5 minutes
- [ ] Migration smoothness: Users can complete migration within 30 minutes
- [ ] Problem resolution speed: Common issues have documented answers

### 8.3 Acceptance Criteria

| Phase | Acceptance Criteria |
|-------|---------------------|
| Phase 1 | UnifiedExecutor all unit tests pass |
| Phase 2 | New/legacy tool functional consistency tests pass |
| Phase 3 | Skill documentation review passes |
| Phase 4 | All integration tests pass, token reduction >= 85% |
| Phase 5 | UAT passes, no blocking issues |

---

## Appendix

### A. File Change List

```
New:
├── src/core/UnifiedExecutor.ts
├── src/core/ActionMappings.ts
├── src/tools/CoreTools.ts
├── src/tools/LegacyTools.ts
├── discord-skill/SKILL.md
├── discord-skill/workflows/*.md
├── discord-skill/reference/*.md
└── docs/MIGRATION_GUIDE.md

Modified:
├── src/index.ts
├── package.json (version number)
├── README.md
└── CHANGELOG.md
```

### B. Related Documentation Links

- [Hybrid Architecture Proposal](./HYBRID_ARCHITECTURE_PROPOSAL.md)
- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)

### C. Contact and Support

For questions, please contact via:
- GitHub Issues: https://github.com/bouob/discord-mcp/issues
- Discussions: https://github.com/bouob/discord-mcp/discussions
