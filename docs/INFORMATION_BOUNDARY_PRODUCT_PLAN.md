# dsh-ATN 信息边界产品化开发方案（修订版）

**定位变更**：ATN 不再以"更强的协作"为卖点——十一轮实测未发现协调机制的性能收益。本方案把**宿主强制的信息边界**从实验装置提升为插件一等能力。这是信任属性，不是速度属性。

**版本**：走 `0.5.0`（破坏性变更：工具面 6 → 5）。0.4.1 保持不动。

**本版修订**：维护者已决定**砍掉白板**。本版按"砍通道、保能力"改写，见第 3 节。

---

## 1. 现状（已核实，非推测）

| 项 | 实际状态 |
|---|---|
| `AtnRefusal` | `src/runtime.ts:353`，带 code 的拒绝错误 |
| `NetworkSendPolicy` | `src/runtime.ts:413`，`(record, sender, input) => void`，抛错即拒绝 |
| `installSendPolicy(networkId, policy)` | `src/runtime.ts:499`，返回 disposer |
| 调用方 | **全项目仅一处**：`experiments/topology-binding-access.ts:22` |
| 策略覆盖面 | **仅邮件**：`send()`（`:1238`）与 `settle()`（`:1327`） |
| 白板 `publish` | **无策略挂钩**——`src/whiteboard.ts` 中无 `policy` / `AtnRefusal` 引用 |
| `atn_status` 的 `review.summary` | **无策略覆盖**——`feedback()` 不在两处调用点内 |
| README | **完全未提及**该扩展点 |
| 插件级测试 | **无** |

## 2. 核心缺口：边界不完整

第 5 轮提示词写着 "no forwarding … or **board bodies**"，但宿主只强制了邮件。**白板正文没有任何宿主强制。**

必须写进本轮报告：

- 第 5 轮记录的"真实 `evidence-not-owned` 拦截 = 0"**证据弱于当时报告**。它只说明模型没走邮件洗数据；走白板不会被拦，**因此从未被检验过**。
- 结构性结论**不受影响**（零模型调用的构造性参考不违规）。受影响的是**行为合规性**证据。

## 3. 砍白板：先量爆炸半径

### 3.1 直接删除的东西

| 位置 | 内容 |
|---|---|
| `src/whiteboard.ts` | 整个模块（191 行） |
| `src/tools.ts` | `atn_board` 工具（3 处引用）——**工具面 6 → 5** |
| `src/schema.ts` | `whiteboardEntrySchema`、`whiteboardUsageSchema`、`whiteboardSchema`、`NetworkRecord.whiteboard` 字段 |
| `src/runtime.ts` | `board()`（`:1600`）、`publishKnowledge()`（`:1587`）、白板 import（`:57`） |
| `src/index.ts` | `WhiteboardInput`、`PublishKnowledgeInput` 导出 |
| `README.md` | 3 处工具说明 |
| 测试 | `whiteboard.test.ts`、`knowledge-feedback.test.ts`、`fixed-context.test.ts`、`preset.test.ts`、`agent.test.ts`、两个 shifting-evidence 集成测试、`smoke/preset-observer.mjs` |

### 3.2 连带的能力损失（关键，别漏）

`src/knowledge.ts:93,129` 从 `record.whiteboard.entries` 读数据。而 `atn_status(query=...)` 的候选排序是：

```ts
score: scoreKnowledgeQuery(record, candidate.id, needle)   // 全部来自白板条目
...
.filter(candidate => candidate.score > 0)                   // 硬过滤
```

**没有白板条目 → `score` 恒为 0 → 查询结果恒为空。** 直接砍白板会让 `atn_status(query=...)` **静默失效**——砍掉的是一个能力，不只是一个通道。

这必须显式处理，不能顺手带走。

### 3.3 处理方式：发现元数据改为宿主派生

**问题不在"发现"，在"正文"。** 白板的风险来源是 `body` 是自由文本（上限 `MAX_WHITEBOARD_ENTRY_BYTES`），可以夹带任意事实。而发现只需要结构化的 `documents` / `topics`。

因此：

- **删除** agent 面向的白板工具与自由文本通道（第 3.1 节全部内容）。
- **保留** `summarizeKnowledge` / `scoreKnowledgeQuery` 的排序逻辑，但**换掉数据源**：从"agent 自己发布的条目"改为**宿主根据该节点实际保管集合计算出的元数据**。
- `atn_status(query=...)` 行为不变，`knowledgeFingerprint` 字段保留。

这个改法同时服务边界目标：

> **节点无法再虚报自己持有什么——发现元数据由宿主从保管表算出，不由 agent 声明。**

即 `custody` 注册表（第 4.2 节）**一处定义、两处使用**：既做边界强制，又做发现元数据。

**验收**：一个测试断言节点无法通过任何 agent 面向的输入影响自己的发现元数据；另一个测试断言 `atn_status(query=...)` 在无白板后仍能返回候选。

## 4. 工作项 P0

### 4.1 统一出站通道

先审计出完整清单（不得凭记忆），至少覆盖：邮件 `send()` / `settle()`（已有）、`atn_status` 的 `review.summary` / `review.evidence`、`atn_spawn` 的初始任务描述、`atn_finish` 的交付、`claim` / `rewire` 入参。**逐个核实并落盘结论。**

验收：

- 一个测试**显式枚举**所有出站通道，逐条断言策略被调用。
- 枚举必须是可读清单，不得用会随代码漂移的遍历写法。
- **新增出站通道而未登记时，测试必须失败。**

### 4.2 通用策略抽象

```
defineCustodyPolicy({
  custody,        // (nodeId) => 该节点实际持有的 artifact id 集合
  extractClaims,  // (input) => 该消息声称持有的 artifact id 集合
})
```

- 拒绝码词汇表**落盘为公开契约**，已有码（`evidence-not-owned`、`not-task-holder`、`metadata-only` 等）不得改名。
- 同时适用于请求与结果。
- 拒绝必须**原子**：被拒消息不得产生任何持久化副作用。

### 4.3 绕过测试

每个通道一个"试图洗数据"的测试，断言被拒：

- note 正文转发他人事实
- `review.summary` 转发他人事实 ← **当前会通过，必须先有失败记录**
- `evidence` 数组夹带
- `task` 描述夹带
- setup 回执夹带
- 可选字段（`messageId` / `dependsOn` / `retryOf`）夹带
- 拓扑修复后经由新边转发
- **虚报发现元数据**（第 3.3 节）

白板本身不再需要绕过测试——它已被删除。**必须有一个测试断言 `atn_board` 已不存在于工具面。**

**要求：先提交失败记录，再修。** 第 9 轮的教训——修复前的失败记录必须保留。

### 4.4 删除白板与发现元数据改造

按第 3.1 节删除，按第 3.3 节改造。工具面 6 → 5。

## 5. 工作项 P1

### 5.1 文档

README 增加"信息边界"一节：保证什么、不保证什么（第 6 节四条必须并列）、如何安装策略、最小可运行示例。**工具面改为 5 个工具**，并写明白板已移除及其依据。

### 5.2 用新 API 重写实验策略

把 `experiments/topology-binding-access.ts` 改写为调用 4.2 的工厂。这是抽象是否够用的证明：重写后若行为有变（拒绝码、覆盖范围），说明抽象不忠实。**重写前后的拒绝记录必须可对比。**

### 5.3 历史结果的重新表述

第 5 轮"拦截 = 0"按第 2 节重新表述。历史报告不改写，但 README 与新版报告必须写明该证据的范围限制。

## 6. 诚实的边界声明（必须与"保证什么"并列，不得放脚注）

宿主强制的是"**不能声称持有自己没有的东西**"。它**不**提供：

- **不防推导**：智能体可以从合法持有的信息推出结论并传递。边界管 artifact 身份，不管信息量。
- **不防侧信道**：时间、消息长度、交互次数、拒绝码本身都可能泄露信息。
- **不防合谋**：两个各自合法的持有者可以自愿交换各自持有的东西；若保管集合允许，这是合法的。
- **只在网络内有效**：约束 ATN 网络内的出站消息，不约束智能体对宿主其他能力的直接调用。

## 7. 不要做的事

1. 不新增模型工具（本轮是净减少）。
2. **不动 ATN 的协作机制**（拓扑、评价）——研究线已证明不产出性能收益。
3. 不做性能优化，不提出任何性能主张。
4. **不让 `atn_status(query=...)` 静默失效**——要么按 3.3 保住，要么在变更说明中显式声明该能力移除。
5. 不删除已有测试，不降低断言强度（白板相关测试随功能删除，需在报告中逐条列出并说明）。
6. 不改动已有拒绝码名称。

## 8. 完成标准

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
```

并且：

1. 出站通道清单落盘；显式枚举测试断言每条通道经过策略；新增通道未登记时测试失败。
2. 4.3 的绕过测试全部存在；**`review.summary` 与"虚报发现元数据"两条必须先有失败记录**。
3. 策略抽象落盘；拒绝码作为公开契约固定。
4. 白板已删除；工具面为 5；有一个测试断言 `atn_board` 不存在。
5. **`atn_status(query=...)` 在删除白板后仍返回候选**，且节点无法影响自己的发现元数据。
6. 实验策略已用新 API 重写，重写前后拒绝记录可对比。
7. README 更新：5 个工具、白板移除依据、"信息边界"一节含第 6 节四条限制。
8. 报告如实记录：**第 5 轮"拦截 = 0"因白板未受保护而弱于当时报告**；结构性结论不受影响；被删除的测试逐条列出。

## 9. 与既有结论的关系

- 结构可达性证明、构造性参考、零模型调用结论：**不受影响**。
- 行为合规性证据：**按第 2 节重新表述**。
- 研究线性能结论（无协调收益）：**不受影响**，本方案不主张任何性能收益。
- 全部 `causalClaim=false`。
