# Discord MCP + Skill 混合架構導入計畫

## 目錄
1. [導入概述](#1-導入概述)
2. [前置準備](#2-前置準備)
3. [階段性實施計畫](#3-階段性實施計畫)
4. [遷移策略](#4-遷移策略)
5. [測試計畫](#5-測試計畫)
6. [回滾策略](#6-回滾策略)
7. [風險評估與緩解](#7-風險評估與緩解)
8. [成功指標](#8-成功指標)

---

## 1. 導入概述

### 1.1 目標
將現有 93 個 MCP 工具重構為 MCP + Skill 混合架構，實現：
- Token 消耗減少 88% (17,200 → 2,100 tokens)
- 工具選擇準確度提升
- 維護性和擴展性改善

### 1.2 範圍

| 項目 | 變更內容 |
|------|----------|
| MCP Server | 93 工具 → 3 核心工具 |
| Skill | 新增 discord-skill 資料夾 |
| 文檔 | 更新 README 和使用指南 |
| 測試 | 新增整合測試 |

### 1.3 時程總覽

```
Week 1-2: Phase 1 - 基礎建設
Week 2-3: Phase 2 - MCP 重構
Week 3-4: Phase 3 - Skill 完善
Week 4-5: Phase 4 - 整合測試
Week 5-6: Phase 5 - 正式發布
```

---

## 2. 前置準備

### 2.1 環境需求

```bash
# Node.js 版本
node >= 18.0.0

# 必要套件
npm install zod @modelcontextprotocol/sdk

# 開發依賴
npm install -D typescript vitest
```

### 2.2 分支策略

```
main
├── develop
│   ├── feature/mcp-refactor      # MCP 重構
│   ├── feature/skill-structure   # Skill 結構
│   └── feature/migration-layer   # 遷移層
└── release/v2.0.0                # 正式發布
```

### 2.3 檢查清單

- [ ] 備份現有 `src/index.ts`
- [ ] 確認所有現有測試通過
- [ ] 建立效能基準測量
- [ ] 通知相關使用者即將進行的變更
- [ ] 設定 CI/CD 管線

---

## 3. 階段性實施計畫

### Phase 1: 基礎建設 (Week 1-2)

#### 3.1.1 建立統一執行層

**目標**: 創建新的 UnifiedExecutor 類別，作為所有操作的統一入口

**檔案**: `src/core/UnifiedExecutor.ts`

```typescript
// 實作大綱
export class UnifiedExecutor {
  private operationHandlers: Map<string, OperationHandler>;

  constructor(discordService: DiscordService) {
    this.registerHandlers();
  }

  async execute(operation: string, action: string, params: object): Promise<Result> {
    // 1. 驗證 operation 和 action
    // 2. 路由到對應 handler
    // 3. 執行並返回結果
  }

  async query(resource: string, filters: object): Promise<QueryResult> {
    // 查詢操作
  }

  async batch(operations: Operation[]): Promise<BatchResult> {
    // 批次操作
  }
}
```

**任務清單**:
- [ ] 創建 `UnifiedExecutor.ts`
- [ ] 定義 `OperationHandler` 介面
- [ ] 實作操作路由邏輯
- [ ] 撰寫單元測試

#### 3.1.2 定義操作映射表

**檔案**: `src/core/ActionMappings.ts`

```typescript
export const ACTION_MAPPINGS = {
  message: {
    send: 'send_message',
    edit: 'edit_message',
    delete: 'delete_message',
    // ... 映射到舊有方法
  },
  channel: {
    create: ['create_text_channel', 'create_voice_channel', ...],
    // ...
  },
  // ...
};
```

**任務清單**:
- [ ] 完整映射 93 個工具到新架構
- [ ] 定義參數轉換規則
- [ ] 撰寫映射驗證測試

---

### Phase 2: MCP 重構 (Week 2-3)

#### 3.2.1 創建新工具定義

**檔案**: `src/tools/CoreTools.ts`

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

**任務清單**:
- [ ] 創建 `CoreTools.ts`
- [ ] 定義完整的 JSON Schema
- [ ] 實作工具呼叫處理器

#### 3.2.2 修改 index.ts

**變更重點**:
1. 引入新的核心工具
2. 保留舊工具作為相容層 (可選)
3. 路由到 UnifiedExecutor

```typescript
// src/index.ts 修改大綱

import { CORE_TOOLS } from './tools/CoreTools.js';
import { LEGACY_TOOLS } from './tools/LegacyTools.js'; // 選擇性保留
import { UnifiedExecutor } from './core/UnifiedExecutor.js';

// 工具列表配置
const USE_LEGACY_MODE = process.env.DISCORD_MCP_LEGACY === 'true';

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: USE_LEGACY_MODE ? LEGACY_TOOLS : CORE_TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (CORE_TOOLS.some(t => t.name === name)) {
    return handleCoreToolCall(name, args);
  } else {
    return handleLegacyToolCall(name, args); // 向後相容
  }
});
```

**任務清單**:
- [ ] 重構 `index.ts`
- [ ] 實作 `handleCoreToolCall`
- [ ] 測試新舊模式切換

---

### Phase 3: Skill 完善 (Week 3-4)

#### 3.3.1 完成所有 Workflow 文檔

需要創建的檔案：

| 檔案 | 內容 |
|------|------|
| `workflows/roles.md` | 角色管理指南 |
| `workflows/members.md` | 成員管理指南 |
| `workflows/server-admin.md` | 伺服器管理指南 |
| `workflows/voice.md` | 語音功能指南 |
| `workflows/moderation.md` | 審核功能指南 |
| `workflows/webhooks.md` | Webhook 指南 |
| `workflows/events.md` | 活動管理指南 |

**任務清單**:
- [ ] 撰寫 `roles.md`
- [ ] 撰寫 `members.md`
- [ ] 撰寫 `server-admin.md`
- [ ] 撰寫 `voice.md`
- [ ] 撰寫 `moderation.md`
- [ ] 撰寫 `webhooks.md`
- [ ] 撰寫 `events.md`

#### 3.3.2 完成參考文檔

| 檔案 | 內容 |
|------|------|
| `reference/permissions.md` | Discord 權限對照表 |
| `reference/error-codes.md` | 錯誤代碼說明 |
| `reference/rate-limits.md` | API 限流說明 |

**任務清單**:
- [ ] 撰寫 `permissions.md`
- [ ] 撰寫 `error-codes.md`
- [ ] 撰寫 `rate-limits.md`

#### 3.3.3 創建輔助腳本

```
scripts/
├── validate_params.py    # 參數驗證
├── format_response.py    # 回應格式化
└── batch_operations.py   # 批次操作輔助
```

**任務清單**:
- [ ] 撰寫驗證腳本
- [ ] 撰寫格式化腳本
- [ ] 撰寫批次操作腳本

---

### Phase 4: 整合測試 (Week 4-5)

#### 3.4.1 測試項目

**功能測試矩陣**:

| 操作類別 | 測試項目 | 預期結果 |
|---------|---------|---------|
| message | send, edit, delete, react | ✓ 與舊版行為一致 |
| channel | create, edit, delete, move | ✓ 與舊版行為一致 |
| role | create, edit, delete, assign | ✓ 與舊版行為一致 |
| member | query, edit, kick, ban | ✓ 與舊版行為一致 |
| voice | join, leave, play, stop | ✓ 與舊版行為一致 |
| moderation | automod CRUD | ✓ 與舊版行為一致 |
| batch | 多操作組合 | ✓ 原子執行 |

**任務清單**:
- [ ] 撰寫所有操作類別的整合測試
- [ ] 執行效能測試
- [ ] 執行相容性測試

#### 3.4.2 Token 消耗測量

```typescript
// 測試腳本
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

**驗收標準**:
- [ ] Token 減少 >= 85%
- [ ] 所有功能測試通過
- [ ] 無效能退化

---

### Phase 5: 正式發布 (Week 5-6)

#### 3.5.1 發布檢查清單

- [ ] 所有測試通過
- [ ] 文檔更新完成
- [ ] CHANGELOG 更新
- [ ] 版本號更新 (v2.0.0)
- [ ] README 更新
- [ ] 遷移指南完成

#### 3.5.2 發布步驟

```bash
# 1. 合併到 main
git checkout main
git merge release/v2.0.0

# 2. 打標籤
git tag -a v2.0.0 -m "MCP + Skill hybrid architecture"

# 3. 發布
git push origin main --tags
npm publish
```

---

## 4. 遷移策略

### 4.1 向後相容模式

提供環境變數控制，讓使用者可以選擇使用舊版或新版：

```bash
# 使用舊版 (93 個工具)
DISCORD_MCP_LEGACY=true

# 使用新版 (3 個核心工具) - 預設
DISCORD_MCP_LEGACY=false
```

### 4.2 漸進式遷移路徑

```
Stage 1: 雙軌運行 (v2.0.0)
├── 預設新架構
├── 支援 LEGACY=true 切換
└── 警告提示舊版將於 v3.0.0 移除

Stage 2: 棄用警告 (v2.1.0)
├── 舊版功能標記為 deprecated
└── 加入遷移輔助工具

Stage 3: 完全移除 (v3.0.0)
├── 移除舊版程式碼
└── 僅保留新架構
```

### 4.3 工具調用轉換範例

#### 發送訊息
```json
// 舊版
{ "tool": "send_message", "channelId": "123", "message": "Hello" }

// 新版
{ "tool": "discord_execute", "operation": "message", "action": "send",
  "params": { "channelId": "123", "content": "Hello" } }
```

#### 創建頻道
```json
// 舊版
{ "tool": "create_text_channel", "name": "general", "categoryId": "456" }

// 新版
{ "tool": "discord_execute", "operation": "channel", "action": "create",
  "params": { "name": "general", "type": "text", "categoryId": "456" } }
```

#### 查詢成員
```json
// 舊版
{ "tool": "get_members", "limit": 100 }

// 新版
{ "tool": "discord_query", "resource": "members", "limit": 100 }
```

---

## 5. 測試計畫

### 5.1 單元測試

| 模組 | 測試重點 | 覆蓋率目標 |
|------|---------|-----------|
| UnifiedExecutor | 操作路由、錯誤處理 | >= 90% |
| ActionMappings | 映射正確性 | 100% |
| CoreTools | Schema 驗證 | 100% |

### 5.2 整合測試

```typescript
describe('Discord MCP Hybrid Architecture', () => {
  describe('discord_execute', () => {
    test('message.send works correctly', async () => { /* ... */ });
    test('channel.create works correctly', async () => { /* ... */ });
    // ... 所有 operation.action 組合
  });

  describe('discord_query', () => {
    test('messages query returns correct format', async () => { /* ... */ });
    // ... 所有 resource 查詢
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

### 5.3 效能測試

| 指標 | 基準 (舊版) | 目標 (新版) |
|------|-----------|-----------|
| 工具定義大小 | ~17,200 tokens | < 2,500 tokens |
| 工具載入時間 | 100ms | <= 100ms |
| 操作執行時間 | N ms | <= N ms |

### 5.4 用戶驗收測試 (UAT)

- [ ] 邀請 3-5 位現有使用者參與測試
- [ ] 收集反饋並調整
- [ ] 確認文檔清晰易懂

---

## 6. 回滾策略

### 6.1 觸發條件

以下情況應觸發回滾：
- 核心功能失效 (發送訊息、創建頻道等)
- Token 消耗未達預期減少
- 嚴重效能問題
- 使用者大量負面反饋

### 6.2 回滾步驟

```bash
# 1. 切換到穩定版本
git checkout v1.x.x

# 2. 重新部署
npm install
npm run build

# 3. 通知使用者
# 發送公告說明回滾原因和預計修復時間
```

### 6.3 快速緩解

若無法立即回滾，可透過環境變數強制使用舊版：

```bash
DISCORD_MCP_LEGACY=true npm start
```

---

## 7. 風險評估與緩解

### 7.1 風險矩陣

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|----------|
| 功能遺漏 | 中 | 高 | 完整的映射測試 |
| 效能退化 | 低 | 中 | 效能基準測試 |
| 使用者抵制 | 中 | 中 | 漸進式遷移、完整文檔 |
| Skill 載入問題 | 低 | 中 | 提供純 MCP fallback |
| Discord API 變更 | 低 | 高 | 抽象層隔離 |

### 7.2 緩解策略詳述

#### 功能遺漏
- 建立完整的功能對照表
- 每個舊工具都有對應的新調用方式
- 自動化測試確保一致性

#### 使用者抵制
- 提供充分的遷移期 (至少 2 個主版本)
- 完整的遷移文檔和範例
- 保留 LEGACY 模式作為安全網

---

## 8. 成功指標

### 8.1 量化指標

| 指標 | 目標 | 測量方式 |
|------|------|----------|
| Token 減少 | >= 85% | 工具定義大小比較 |
| 功能覆蓋 | 100% | 測試通過率 |
| 效能 | 無退化 | 操作執行時間 |
| 使用者滿意度 | >= 80% | 問卷調查 |

### 8.2 質化指標

- [ ] 文檔清晰度：使用者能在 5 分鐘內理解新架構
- [ ] 遷移順暢度：使用者能在 30 分鐘內完成遷移
- [ ] 問題解決速度：常見問題都有文檔解答

### 8.3 驗收標準

| 階段 | 驗收標準 |
|------|----------|
| Phase 1 | UnifiedExecutor 所有單元測試通過 |
| Phase 2 | 新舊工具功能一致性測試通過 |
| Phase 3 | Skill 文檔審查通過 |
| Phase 4 | 所有整合測試通過，Token 減少 >= 85% |
| Phase 5 | UAT 通過，無阻塞性問題 |

---

## 附錄

### A. 檔案變更清單

```
新增:
├── src/core/UnifiedExecutor.ts
├── src/core/ActionMappings.ts
├── src/tools/CoreTools.ts
├── src/tools/LegacyTools.ts
├── discord-skill/SKILL.md
├── discord-skill/workflows/*.md
├── discord-skill/reference/*.md
└── docs/MIGRATION_GUIDE.md

修改:
├── src/index.ts
├── package.json (版本號)
├── README.md
└── CHANGELOG.md
```

### B. 相關文件連結

- [混合架構提案](./HYBRID_ARCHITECTURE_PROPOSAL.md)
- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)

### C. 聯絡與支援

如有問題，請透過以下方式聯繫：
- GitHub Issues: https://github.com/bouob/discord-mcp/issues
- 討論區: https://github.com/bouob/discord-mcp/discussions
