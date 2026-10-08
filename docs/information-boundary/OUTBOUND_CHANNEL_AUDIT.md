# 0.5.0 出站通道审计与拒绝码契约

审计对象为 `src/tools.ts` 的全部五个模型工具和 `AtnRuntime` 的全部公开方法；不只审计邮件。宿主策略接收 `{ channel, input }`，`input` 为完整业务输入，包括所有可选字段。身份取自实际调用 Agent，策略同步执行，抛错则不提交该操作。

| 登记通道 | 实际入口 | 被检查的载荷 | 可见/持久化去向与检查位置 |
|---|---|---|---|
| `start` | `atn_start` / `start` | objective、successCriteria、constraints | 全网共享目标与初始任务；`store.create` 之前。首次创建须使用 `*` 策略。 |
| `spawn` | `atn_spawn` / `spawn` | task、context、leaseMs、dependsOn、retryOf | 新节点任务与上下文；第一次 provisioning 写和 Agent 创建之前。 |
| `send.task` | `atn_send(kind=task)` | 全部 SendInput 字段 | 任务、邮件与依赖关系；分配 ID、创建任务和入队之前。 |
| `send.note` | `atn_send(kind=note)` | 全部 SendInput 字段 | 邮件正文及关联 ID；入队之前。 |
| `send.result` | `atn_send(kind=result)` / settlement | body、summary、evidence 以及全部可选字段 | 任务结算与回执邮件；同一事务内先检查再写。 |
| `status.review` | `atn_status(review)` / `feedback` | taskId、status、summary、evidence、comparisonKey | requester 评价及发现/换边观测；记录评价之前。 |
| `status.claim` | `atn_status(claimTaskId)` / `claim` | taskId | 关联原任务、生成重试任务并通知 requester；恢复 ID 和邮件分配之前。源任务正文是此前已经提交的载荷，不视为认领者的保管声明。 |
| `status.rewire` | `atn_status(rewire)` / `rewire` | peers、intent、baselineTaskIds、candidateTaskIds | 邻接表和换边记录；拓扑变换和 ID 分配之前。新边不授予 artifact 保管身份。 |
| `finish.node` | `atn_finish(scope=node)` / `finish` | reason | 节点退休说明；draining 写之前。 |
| `finish.network` | `atn_finish(scope=network)` / `deliver` | summary、evidence、goalVersion | 用户交付与自持任务结算；回执仅在通过策略的最终事务内更新。提前只刷新已存在会话输入的持久回执，不写网络记录。 |
| `propose` | 宿主保留 API `propose` | document、rationale | 投票请求及共享目标版本；提案与广播邮件写之前。模型工具面未恢复此工具。 |
| `vote` | 宿主保留 API `vote` | proposalId、approve、reason | 共享提案中的理由与决议；记录投票之前。 |
| `renew` | 宿主保留 API `renew` | extendMs、taskId、basis | 共享节点的续租说明；租约变更之前。 |

`status` 的 query/taskIds、`peers`、`tasks`、callerContext、resolveNode、network、networkIds、findBySessionId、networkForSession、deliveryHolder、ownsHandle、handleFor、pendingMail、now 是读取/身份路径，查询参数不写给其他节点。它们返回此前已提交的记录，不提供额外的接收者隐私控制。`status` 的三个可选写入口分别委托到登记的 claim、feedback、rewire。

installOutboundPolicy、installSendPolicy、refreshCustody、openStore、admitStep、deliverMail、verifyTask、provisionRecoveryTask、stop、failNode、tick、recover、shutdown 是可信宿主、调度、持久化或已有载荷回放路径。它们不是模型输入接口。重放已有邮件不会重新授予保管身份；相同 messageId 的新调用仍重新检查策略。

白板正文、发布/删除、`publishKnowledge` 与 `atn_board` 已删除，没有豁免通道。加载旧记录时丢弃白板字段；无来源标记的旧自报知识不参与保管元数据。保留宿主 `knowledgeFingerprint` 快照供恢复与观察，实时发现优先读取当前安装策略的 custody。

## 漂移检测

`tests/integration/information-boundary.test.ts` 手写枚举以上 13 条通道，逐条尝试洗数据，断言策略被调用、网络状态/写次数/Agent 数量/模型请求数不变。不能从运行时列表自动生成测试用例。

`tests/unit/information-boundary-inventory.test.ts` 独立列出公开方法的审计分类和五工具的顶层/嵌套参数、邮件 kind、finish scope。增加公开方法、工具、字段、邮件类型或登记通道而未更新审计及覆盖会失败。测试还实际插入未登记 API、工具和字段，验证检查能抓住这些变更。

## 公开拒绝码

`INFORMATION_BOUNDARY_REFUSAL_CODES` 从包根导出；`AtnRefusal.code` 保持可供宿主扩展的 string 类型。

| code | 含义 |
|---|---|
| `evidence-not-owned` | 宿主识别的 artifact 保管声明不在真实 custody 中；实验亦用于不属于本地精确副本的结果。 |
| `not-task-holder` | 结果不是由实际任务持有人回给 requester。 |
| `metadata-only` | 历史元数据通道拒绝自由事实载荷；名称保留，白板已删除。 |
| `fact-requests-and-owner-results-only` | 实验只接受事实请求与所有者结果，禁止 note 搬运。 |
| `extra-transport-fields` | 实验禁止 messageId、dependsOn、retryOf 夹带。 |
| `invalid-fact-request` | 请求不是闭合的 `{phase,key}` 结构。 |
| `fixed-edge-required` | 固定实验的新修复边不属于冻结的初始边集。 |
| `invalid-setup-receipt` | setup 回执不是固定 `{"ready":true}` 与空 evidence。 |
| `invalid-owner-result` | 所有者结果未满足请求 key、body、summary、evidence、outcome 约束。 |
| `async-policy` | 策略/域验证返回 Promise，未同步完成，拒绝提交。0.5.0 新增。 |

既有码未改名。域验证先于通用保管集合检查，以保留旧邮件拒绝优先级；重写前后的完整有序记录见 `binding-before.json`、`binding-after.json`。宿主须正确维护 custody 和 extractClaims；工厂不会自行识别任意自然语言事实。
