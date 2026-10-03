# dsh-atn 修复实施说明

这份文档交给实现代理执行。目标是修复最近 review 发现的运行时一致性、生命周期和上下文问题，并用真实 runtime 集成测试证明修复有效。

## 当前基线

- 工作区：`D:\dsh-ATN`
- 当前已有测试：`npm test` 为 83/83 通过。
- 当前已有构建检查：`npm run typecheck`、`npm run build` 通过。
- 本轮只修复代码和测试；不要创建 GitHub 仓库、推送、发布 npm/release 或修改 `upstream/`、`prototype/`。
- AUTH-01/02/03、PROFILE-03 等报告中已经明确列为未完成的项目继续保持未完成，不要通过放宽断言来“修绿”。

## 实施规则

1. 先阅读 `src/runtime.ts`、`src/domain.ts`、`src/lifecycle.ts`、`src/mailbox.ts`、`src/proposals.ts` 及现有 integration fixtures，再修改代码。
2. 网络记录仍是一个原子持久化单元。所有“检查条件 + 修改记录”必须在同一个网络串行临界区内完成。
3. 任何失败窗口都必须留下明确的 durable 状态；不得留下“调用失败但节点 active、handle 仍活着、任务不存在”的半成功状态。
4. 不改变入口 Agent 的宿主所有权；网络完成和硬停止只释放 ATN-owned handle。
5. 不删除已有测试，不降低现有断言强度。每个修复都要新增一个能在修复前失败、修复后通过的测试。

## 必须修复的项目

### 1. 建立每网络单一写入者，消除旧快照覆盖

现状：`NetworkStore.update` 会把最新记录传给回调，但 runtime 多处先基于旧 `record` 生成完整新记录，再使用 `update(() => snapshot)` 写回。并发 spawn、send、proposal、vote、deliver 会丢节点、任务、邮件或票；并发 step admission 也可能超过 `stepBudget`。

涉及位置：`src/runtime.ts` 的 spawn、send、propose、vote、deliver、admitStep，以及 `src/domain.ts` 的 `NetworkStore.update`。

要求：

- 在 `AtnRuntime` 内增加按 `networkId` 串行的 mutation queue/mutex；所有网络写操作通过它执行。
- mutation 的读取、容量检查、id 分配、业务变换和 `store.update` 必须在同一个临界区内完成。
- `store.update` 回调必须使用传入的 `current`，不能捕获调用前的旧快照。
- 需要返回新 id 或业务结果时，提供一个内部 `mutate(networkId, fn)` 辅助函数，返回 `{ record, value }`，不要让调用者先在临界区外分配 id。
- spawn 的 selected-child 选择、任务/邮件额度、proposal/vote 的 base-version 检查、step budget 检查、deliver 的完成门槛都必须在同一临界区内裁决。
- 队列在网络终态后可清理，但清理不能让正在执行的 mutation 失去等待关系。

验收测试：

- 并发两个不同节点 spawn，得到两个不同 node id，两个任务都保留，只有第一个发布者占用 `selectedChildId`。
- 并发多个 voter 投同一 proposal，所有票都保留；最后一票只提交一个新 goal revision。
- 并发发送任务/普通邮件，邮件和任务都保留，`sequence` 不冲突，顺序可解释。
- 两个节点竞争最后一个 step budget 时，`stepsUsed` 不超过上限，只有被准入的 step 返回成功。
- 并发 deliver 与 result 不得绕过任务完成门槛。

### 2. 正常退休必须释放 handle，并阻止终态节点继续运行

现状：scheduler 只把 draining 节点写成 `retired`，没有调用 handle 释放；`preStep` 也没有拒绝 retired/failed 节点。

要求：

- `retireSettledNodes` 的结果持久化成功后，runtime 找出本轮转为 `retired` 的节点，释放其 ATN-owned handle。
- 释放必须在安全步界完成，不能在当前 Agent 的 `execute()` 栈内等待自己销毁。
- `preStep` 对 `retired`/`failed` 节点返回 reject；`draining` 只允许继续处理已有任务结果和已分配旧票。
- 只有 `dispose()` 成功完成后才从 `handles` 删除；失败或超时的 handle 必须继续可追踪并进入 straggler 记录。
- 入口 Agent 永远不释放。

验收测试：

- 节点 finish 后结清任务，调用 `tick()`，节点变为 `retired`，`ownsHandle(nodeId)` 为 false。
- retired 节点无法再产生 model step，也无法调用 renew/send/vote 等运行时操作。
- draining 节点仍可结清旧任务和旧票，但不能接收新任务。

### 3. 修正 stop 的释放结果和 straggler 报告

现状：`releaseOwnedHandles` 在 `dispose()` 完成前删除 map 项，然后等待 10 秒超时；因此超时 handle 会从返回值中消失，dispose 错误还被误列为 released。

要求：

- 维护每个释放操作的状态：`pending`、`released`、`failed`、`timed-out`。
- `released` 只包含已经确认 `dispose()` 成功的 node id。
- `failed` 和 `timed-out` 都进入 `stragglers`，并带有可诊断原因。
- 超时返回后仍保留未完成 handle 的追踪能力；后续 settle 时更新状态，但不能把已返回的 stop 结果改写成矛盾状态。
- stop 对重复调用保持幂等；网络状态持久为 `stopped`，不能被 renew、spawn、vote、mail replay 或 recover 重新打开。

验收测试：

- 使用可控 fake handle，让一个 dispose 永不完成；stop 超时后必须返回该 node 在 `stragglers` 中，不能出现在 `released` 中。
- 使用立即 reject 的 fake handle；返回结果必须可见地报告失败。
- 正常 dispose 时 node 进入 `released`，入口 Agent 仍存在。

### 4. 让 spawn 的创建意图、发布和初始任务具有失败补偿

现状：节点发布后才调用 `createTask`。当 `maxTasks` 达到上限、第二次 update 失败或模型输入失败时，会留下 active 节点或 live handle 的半成功状态。

要求：

- 先持久化 `provisioning/pending` 意图。
- 创建 Agent 成功后，在一次网络 mutation 中同时完成：确认节点仍是 pending、发布节点、按当前记录分配 selected child、创建初始 task、推进 sequence。
- 任何发布前后的失败都必须：持久记录 `failed` 节点，释放已创建的 handle，保留失败原因，不能留下 active 无任务节点。
- 如果任务额度已满，必须在创建 Agent 前拒绝，或创建后立即补偿失败并释放 Agent；首选前者。
- 恢复逻辑继续区分 pending、published、failed，不重复发布同一 session。

验收测试：

- `maxTasks=1` 时 start 成功后 spawn 被拒绝；网络中没有新增 active 节点，没有新增 live ATN handle。
- 注入 publish/update 失败，spawn 返回失败；节点最终为 failed，handle 为 released/straggler，不是 active。
- 正常 spawn 仍保留初始任务、goal snapshot 和 task message。

### 5. 收紧续期与 draining 的工作边界

现状：`atn_renew` 只把 `basis` 写进 note，不检查任务；没有任务的节点也能续期。`atn_send(kind=task)` 允许 draining 节点发起新任务。

要求：

- 将续期依据改成明确的 `taskId`（可保留 `basis` 作为说明文字，但不能替代 taskId）。
- 续期时原子检查：网络为 open、节点为 active 或 draining、任务存在且由该节点持有且仍为 open、请求时长在配置和网络 deadline 内。
- retired/failed/停止网络必须拒绝 renew。
- draining 节点只允许发送自己已有任务的 result、处理已分配旧票和必要的普通通知；发送新的 `task` 必须拒绝。
- 新任务只能分配给当前 active 目标，且发送者也必须仍处于允许分配工作的状态。

验收测试：

- 没有 open task 的节点 renew 被拒绝。
- taskId 不属于调用者、任务已完成、节点 retired 或网络 stopped 时 renew 被拒绝。
- draining 节点完成旧 task result 成功，但发送新 task 失败且不产生 task record。

### 6. 恢复后补发当前 goal context

现状：goal commit 时没有 live Agent 的节点被跳过；`recover()` resume 后没有给 active/draining 节点补写当前 goal snapshot，可能继续使用旧版本。

要求：

- 每次 goal commit 都持久保留可重放的当前 revision。
- `recover()` 成功 resume 一个 active/draining 节点后，读取最新 `currentGoal(record)` 并写入该 Session 的 ATN goal message。
- 同一 revision/session 的 context 补发必须幂等，不重复追加相同 snapshot。
- 节点没有 live Agent 时，commit 不得把“已同步”当成事实；恢复后必须补同步。

验收测试：

- 先让目标节点无 live Agent，再提交 v2；恢复后该节点下一次 model request 可读到 v2，Session 中有且只有一条 v2 snapshot。
- 重复 recover 不重复创建 handle，也不重复追加 goal snapshot。

### 7. 完整继承模型 route 的 effort

现状：`modelRoute.effort` 被记录，但 `agents.create` 和 `agents.resume` 的 `agentOptions` 只传 provider/model。

要求：

- spawn 时传入 `reasoningEffort: route.effort === 'inherit' ? undefined : route.effort`。
- recover/resume 时使用持久化的 effort，不能回退到 profile 默认值。
- 增加 integration assertion，比较父实际 request 与子实际 request 的 provider/model/reasoningEffort。

### 8. 公开稳定 message id，并让重试真正幂等

现状：邮箱层支持可选稳定 id，但 `SendInput` 和 `atn_send` 工具没有该参数；runtime 返回的 `duplicate` 始终为 false。

要求：

- 给 `atn_send` 增加 `messageId` 参数；模型重试同一业务消息时使用同一 id。
- enqueue、task 创建和 result settlement 必须在同一 mutation 中处理重复 id：已存在且内容/发送者/目标不一致时拒绝；完全相同则返回已有 mail 状态，不创建第二个 task，不重复结算。
- `SendResult.duplicate` 正确反映幂等重试。
- 仍保留 mail row、发送者、目标、任务/提案关联和首次 settlement 时间。

验收测试：

- 同一 `messageId` 的 task 重试只产生一封 mail 和一个 task。
- 同一 result 重试不产生第二次结算，返回 `duplicate=true` 或等价明确结果。
- 内容、from、to 任一不一致的 id 重用被拒绝。

## 配置边界修复

- 配置中的计数和时长必须为正整数；不能让 `0` 通过配置加载后到第一次写入才失败。
- `domainName` 在加载时校验 `[a-z][a-z0-9_]*`，错误配置立即失败。
- 为配置校验增加零值和非法域名测试。

## 必须保留的既有语义

- 入口节点始终由宿主拥有，网络完成/停止/退休不会 dispose 入口 Agent。
- topology 的 creator_id、selected_child 和 draining 补位规则不改变。
- proposal 仍然使用冻结 approver list；多数票、沉默和超时不能提交。
- peer 文本不能成为人类授权；工具身份始终取自真实 live Agent。
- 不把 `stepBudget` 宣称成 token、HTTP request 或费用上限。

## 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
```

完成标准是：所有原有测试继续通过；新增并发、退休释放、stop straggler、spawn 失败补偿、续期边界、恢复 goal context、effort 继承和稳定 message id 测试全部通过；README 与实施报告同步记录实际通过项和仍未完成的 AUTH/PROFILE 项。不得把未测试内容写成已通过。
