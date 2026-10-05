# 拓扑收益可测化改造设计

本文是 [review 改造验证报告](REVIEW_VALIDATION_2026-10-04.md) 之后的下一轮实现规格。目标不是增加新机制，而是**让已有的自适应拓扑第一次变得可测量**：先证明任务在给定预算内可赢，再让模型实验的每一轮都能给出可解释的数字。

上一轮暴露的核心问题不是"拓扑没用"，而是三条臂都在到达终点前耗尽预算，因此比较的是两次"没跑完"。本设计按依赖顺序分成 Phase 0–5，**Phase 0 是其余所有工作的阻塞项**。

## 不变量

以下内容已通过 267+ 项测试，是本项目的可信资产，**本轮不要改动其语义**：

- `src/runtime.ts` 的按 `networkId` 串行 mutation 队列、原子发布、持久投递回执、恢复补发
- 身份取自真实 live Agent（`requireCaller`）、租约、硬停止、分阶段退休的既有语义
- 网络记录作为唯一原子持久化单元

本轮所有改动都发生在：交付路径、认领授权、遥测注入条件、实验任务与预算标定、实验测量门。若某处改动需要触碰上述不变量，先在文档里记录理由，不要直接改。

---

## Phase 0：确定性参考策略（阻塞项，零模型调用）

### 问题

现在没有任何东西能回答"这个任务在 16 步/节点、给定预算内是否可赢"，也没有"最优消息数"这个参照系。模型实验因此只能产出"预算用光"，无法产出"用了最优解 4 倍的消息数"。

### 设计

新增 `experiments/reference-policy.ts` 与 `experiments/reference-run.ts`。

**驱动方式**：复用 `experiments/topology-host.ts` 的 `provisionTopologyScenario` 建网（真实 Agent、真实 ATN 运行时、真实 `TopologyScenario` ACL），但**从不调用 `agent.followup()`**，也就是不产生任何模型调用。策略直接调用运行时 API 推进协作：

```ts
await ctx.atn.send(agent, { to, kind: 'task' | 'note' | 'result', body, ... })
await ctx.atn.status(agent, { claimTaskId })
await ctx.atn.rewire(agent, { peers, intent: 'exploration' })
await ctx.atn.deliver(agent, { summary, evidence, goalVersion })
```

这些方法不经过 `preStep` 的 `admitStep`，因此脚本可以逐节点同步推进，不依赖模型循环。每个节点仍用真实 Agent handle，身份与 ACL 检查保持有效。

**要实现四个策略**，每个约 30 行，签名统一为
`(view: NodeView, scenario: TopologyScenario) => Promise<Action | null>`，返回 `null` 表示该节点本轮无事可做：

| 策略 | 语义 |
|---|---|
| `hub` | 所有节点把本地四账户小计发给入口，入口求和后交付 |
| `ring-gossip` | 每个节点把自己的小计发给每个邻居，收到即转发未见过的小计 |
| `tree-aggregate` | 沿出生树向父节点聚合，根汇总后把结果下发 |
| `adaptive` | 在 `ring-gossip` 基础上，检测到同伴退休/失败时用 `atn_rewire` 换到存活节点 |

**所有策略只传聚合值**：本地每个账户的小计（4 个整数）+ 已应用条目数。**不传原始条目**。这一点是 Phase 4 的前置验证——如果连脚本都只能靠传原始数据才能算对，说明任务设计有问题，先修任务再谈拓扑。

**确定性成本代理**：没有模型就没有真实 token。报告以下四个确定性指标，作为"上下文成本"的代理：

1. `messages`：ATN 消息总数
2. `hops`：每条消息从发送者到最终聚合者的跳数之和
3. `maxContextBytes`：任一节点收到的 ATN 载荷字节数总和的最大值（这是上下文增长的直接来源）
4. `delivered`：是否交付了 oracle 认可的正确答案

### 涉及文件

- 新增 `experiments/reference-policy.ts`、`experiments/reference-run.ts`
- 新增 `npm run experiment:reference` 脚本
- 复用 `experiments/topology-host.ts`、`experiments/topology-task.ts`、`experiments/evaluation.ts`（oracle 不变）

### 验收

1. 四个策略都能交付 oracle 通过的答案（`delivered: true`）
2. 输出四种策略的 `messages` / `hops` / `maxContextBytes` 对照表，写入 `experiments/results/reference-baseline.json`
3. `hub` 的 `messages` 应显著低于 `ring-gossip`——若不然，说明消息路径没有被拓扑约束住，先修 `atn_send` 的邻居规则再继续
4. 全程零模型调用（断言 issuedModelCalls === 0）
5. 新增确定性测试：`tests/integration/reference-policy.test.ts`，不依赖网络与凭据

**Phase 0 完成前不要跑任何付费模型实验。**

---

## Phase 1：交付不再是固定角色

### 问题

`submit_answer` 只有入口能用（`experiments/run.ts:225`），而入口和所有节点一样吃 16 步预算（`experiments/run.ts:191`、`src/runtime.ts:628`）。补充实验里入口第 16 步退休、零提交尝试，`node-6` 第 14 步提交被拒 → `quiescent-without-submission`。一个宣称"同能力、无固定角色"的网络把交付固定在一个会准时死掉的节点上。

### 设计

把"交付"变成一张普通的、可认领的任务，复用已有的 orphan + claim 通道。

1. `TaskRecord` 增加可选字段 `kind: 'work' | 'delivery'`，缺省按 `'work'` 处理（旧记录无需迁移）。
2. `atn_start` 创建网络时，隐式记录入口承担交付义务；**不新增任务记录**，保持既有行为。
3. 入口节点退休（`retired`/`failed`）且网络未交付时，运行时的退休处理把该义务**物化成一张显式任务**：`kind: 'delivery'`，`holderId` 为原入口，描述包含 objective 与 successCriteria。它随后自然进入 `orphanTasks`。
4. `atn_deliver` 的授权改为：**调用者是入口节点，或调用者是当前交付任务的持有者**。其余机械门槛（无 open 任务、无待审提案、无待投递邮件、goalVersion 匹配）保持不变。
5. 新增只读运行时方法 `deliveryHolder(networkId): NodeId | null`，供实验 harness 判断谁有提交权，保证**规则只有一处定义**。
6. 实验 harness 的 `submit_answer` 改为调用 `deliveryHolder` 判定，而不是硬编码 `agent === entry`。

### 涉及文件

- `src/schema.ts`（`kind` 字段）
- `src/runtime.ts`（退休物化交付任务、`deliver` 授权、`deliveryHolder`）
- `src/tasks.ts`（`orphanTasks` 对 `kind` 的处理）
- `src/tools.ts`（`atn_deliver` 描述更新）
- `experiments/run.ts`（`submit_answer` 授权）
- `src/observer.ts`（如需在面板展示交付任务归属）

### 验收

1. 确定性测试：入口在交付前耗尽预算退休 → 另一节点在 `atn_status` 中看到孤儿交付任务 → 认领 → `atn_deliver` 成功
2. 确定性测试：入口仍 `active` 时，交付任务不可被他人认领
3. 模型运行中 `quiescent-without-submission` 不再出现（前提是 Phase 4 的预算足够）

---

## Phase 2：认领必须带来授权，并且描述可执行

### 问题

`orphanTasks`（`src/tasks.ts:246`）把死主任务开放给所有人，但场景里失效分片的证据只有指定备份槽能读（`experiments/topology-task.ts:112`）。7/8 的节点认领了也读不到数据，任务描述还是通用的"贡献工作"。所以 8 次运行 0 次认领是**理性的**，不是模型能力问题。

同时，宿主当前**预先指定**了备份节点（slot 1），分工是给定的，认领通道没有存在的必要——这直接抵消了"涌现分工"的实验意图。

### 设计

1. **宿主不再预分配备份。** `TopologyScenario` 去掉"slot 1 自动获得 slot 7 的读取权"。失效分片的恢复变成一张**孤儿任务**，任何节点可认领。把"预分配备份"保留为一个**独立对照臂**，用于区分"路由效率"与"自组织"。
2. **认领即授权。** `TopologyScenario` 新增 `authorizeRecovery(sessionId: string, slot: number): void`；节点成功认领该恢复任务后，宿主授予它读取该槽位文档的权限。
3. **认领事件可被宿主观测。** 在 `src/observer.ts` 增加 `task/claimed` 观察事件（或在 `atn_status` 的返回里暴露 `claimedTask`，宿主轮询——优先用观察事件，避免额外调用）。
4. **描述必须可执行。** 失效分片的恢复任务由宿主创建时，`description` 明确写出：失效槽位号、需要读取的文档 id、以及"完成后用 `atn_send(kind=result)` 结算"。

### 涉及文件

- `experiments/topology-task.ts`（去掉预分配、新增 `authorizeRecovery`）
- `experiments/topology-host.ts`（把认领事件接到 `authorizeRecovery`）
- `experiments/run.ts`（失效注入时创建带具体描述的恢复任务）
- `src/observer.ts`（认领事件）

### 验收

1. 确定性测试：节点认领失效槽位恢复任务后，能读到此前被拒的 `initial-7` / `correction-7`
2. 确定性测试：未认领的节点仍然读取被拒
3. 参考策略的 `adaptive` 分支能通过认领完成恢复（Phase 0 已覆盖）
4. 模型运行中 `claimsConfirmed > 0`

---

## Phase 3：遥测只在实质变化时注入

### 问题

指纹包含 `stepsUsed` / `stepsRemaining`（`src/local-feedback.ts:101` 只剥离了 `observations[].elapsedMs`），而注入内容含 `steps=N/16, remaining=M`（`src/topology-feedback.ts:86`）。**任一同伴消耗一步，整块遥测就重新注入到所有邻居的上下文。** 8 节点活跃时几乎每轮都注入，纯浪费。

### 设计

1. 新增 `materialFingerprint(feedback)`，只对以下内容取指纹：
   - 邻居集合本身
   - 每个同伴的 `lifecycle`（active → draining / retired / failed）
   - 每个同伴的**终态**计数：`completed` / `failed` / `unreachable` / `retries` / `recoveries` / `downstreamFailures`
   - 终态观察的 `taskId` 列表
2. **从指纹中排除**：`stepsUsed`、`stepsRemaining`、`open`、`elapsedMs`、`meanLatencyMs`。这些易变或连续漂移的量不触发注入。
3. 注入文本中，`steps` / `remaining` 只在**模型显式调用 `atn_status`** 时返回，不再随快照附带。
4. **限流**：同一节点两次遥测注入之间至少间隔 N=3 个准入步，即使期间发生实质变化也合并为一次。避免一批同伴同时退休造成 8 次注入。

### 涉及文件

- `src/local-feedback.ts`（`materialFingerprint`）
- `src/topology-feedback.ts`（注入条件与文本）
- `src/runtime.ts`（限流状态；`preStep` 附近）

### 验收

1. 确定性测试：同伴消耗一步**不**产生反馈消息；同伴退休**产生**反馈消息
2. 确定性测试：连续 3 次实质变化在限流窗口内合并为 1 次注入
3. `atn_status` 仍能返回实时 `stepsUsed` / `stepsRemaining`

---

## Phase 4：任务协议最小化与预算标定

### 问题

- 正确答案要求 8 个分片按账户求和 + 列出全部 16 个文档 id，**所有信息必须到达提交者**；提示词写着 "Exchange evidence **or** derived findings"，诱导模型直接搬运原始条目。结果是上下文爆炸：主实验 ~7,460 token/次调用，补充实验 ~17,180 token/次调用。
- 全局 token 阈值比每节点预算先绑死，导致 P1 的每节点预算在主实验里根本没被检验。
- `maxTasks` 上限 32 且累积不清零，8 节点下撞满 5 次。
- 8 次 `max-tokens` 截断（输出上限 4096）——同样是搬运原始数据的症状。

### 设计

1. **提示词改为只传聚合值。** `renderTopologyPrompt` 明确写出："发送你负责槽位的四个账户小计和已应用条目数。**不要发送原始条目。**" 把"交换证据"改为"交换小计"。
2. **证据清单不再需要传输。** 阶段 2 的公告由宿主发布，其中包含全部 `initial-N` / `correction-N` 文档 id 列表。提交者据此组装 `evidence` 字段，无需从同伴获取。
3. **成本指标进报告。** `report.json` 增加 `atnPayloadBytes`（全部 ATN 载荷字节和）与 `atnMessages`（消息条数），使"搬运原始数据"在报告里直接可见，与 Phase 0 的 `hub` 基线并列展示。
4. **预算标定。** 主实验只保留**一个**绑定约束：
   - 每节点步数（16）是被测机制，保留为真实约束
   - 全局 `observed-tokens` 阈值按"一次不限阈值的对照运行实测成本 × 2"设定，作为安全网而非绑定项
   - 具体做法：先跑一对不限 token 阈值（仅 `--calls` 封顶）的运行测量真实成本，再据此设定阈值
5. **任务上限。** `maxTasks` 从 32 提到 128，或改为按阶段重置的计数。二者取其一，在实验装配里明确记录。
6. **输出上限。** `--output-tokens` 提到 8192，配合第 1 条的消息纪律；截断若仍出现，说明协议纪律没被执行，作为失败信号保留。

### 涉及文件

- `experiments/topology-task.ts`（提示词、阶段 2 公告含文档 id）
- `experiments/run.ts`（参数默认值、报告字段）
- `experiments/telemetry.ts`（`atnPayloadBytes` / `atnMessages` 采集）
- `src/config.ts`（若需要实验侧覆盖 `maxTasks`）

### 验收

1. 参考策略的 `hub` 与 `tree-aggregate` 在 `maxContextBytes` 上显著低于 `ring-gossip`（Phase 0 产出）
2. 模型运行报告包含 `atnPayloadBytes` / `atnMessages`，且能与 `hub` 基线并列比较
3. 主实验不再出现 `max-tokens` 截断，或截断次数显著下降
4. 主实验中全局 token 阈值**不**触发（对照运行实测成本的 2 倍足够）

---

## Phase 5：测量门与重跑

### 设计

1. **前置门**：实验 runner 在跑任何 ATN 臂之前，先断言"参考策略在完全相同的限制下能交付"。不满足则拒绝启动付费运行。这是防止再次花 650 万 token 换回"预算用光"的硬闸门。
2. **相对指标**：每次 ATN 运行报告 `atnMessages / reference.messages` 与 `atnPayloadBytes / reference.maxContextBytes`，把"拓扑有没有帮上忙"变成数字。
3. **样本量**：单个任务变体、每配置 1 次运行不足以支持任何结论。在单次机制跑通后，扩到 2 个任务变体 × 2 臂 × 3 次重复 = 12 次，且**预先固定**主指标（答案通过率、相对消息数、相对载荷字节）。
4. **失败保留**：继续保留全部失败样本，不用重采样替换。

### 验收

1. runner 在参考策略不通过时拒绝付费运行（确定性测试）
2. 报告含相对指标
3. 重跑结果能给出：两臂的通过率、相对基线消息数、以及重连次数与结果的对应关系

---

## 明确不做的事

- **不新增机制。** 本轮只让已有机制可测；孤儿认领、重连、每节点预算都已存在。
- **不引入中心规划模型、固定角色或强制轮次。**
- **不动 mutation 队列、投递回执、恢复补发。**
- **不在 Phase 0 完成前跑付费模型。**
- **不把"重连发生"当作收益证据。** 13 次邻居变化只证明机制被触发。

## 预期结果与判读边界

即使全部完成，也应预期**拓扑收益是常数倍级别**（消息数与载荷字节的差异），而不是质变：该任务的最优解是全节点向聚合者汇总，树与环只差跳数。要检验真正的"涌现分工"，需要后续让节点**不被指派**分片、而是自己发现并认领工作——本设计把认领通道修好（Phase 2）只是为那一步铺路，不声称本轮能测出涌现。

若 Phase 0 显示 `hub` 与 `ring-gossip` 的消息数差异很小，说明消息路径没有被拓扑有效约束，此时应优先修 `atn_send` 的邻居规则，而不是继续扩样本。

## 实施补充：交付任务容量与结算

Phase 1 的交付义务不能因为普通工作任务已经用完 `maxTasks` 而阻止入口退休。实现保留 `maxTasks` 作为普通工作任务的累计上限，并为运行时创建的 `kind='delivery'` 任务单独保留至多 `maxTotalNodes` 条记录；模型工具不能创建这种任务。该保留容量不修改 mutation 队列、原子持久化、投递回执、租约或退休条件。一次网络最多有一条交付任务重试链，每次移交要求前一持有者已经退休或失败，所以初始物化加后续认领不会超过节点总量上限。

交付任务的成功结算只随 `atn_finish(scope='network')` / 运行时 `deliver()` 原子发生，普通 `atn_send(kind='result')` 不得提前解除交付义务。交付持有者的死亡继续使用现有 orphan + claim 重试链，不覆盖历史尝试。只读 `deliveryHolder` 与交付提交使用同一纯函数，提交时在网络 mutation 内重新校验，以免认领和交付竞争造成过期授权。

Phase 2 的宿主用 `provisionRecoveryTask` 在失效节点仍存活时创建明确的阶段 2 恢复义务，再调用既有 `failNode` 使其进入 orphan 通道；这样即使初始任务已经结算，也不会丢失恢复义务。创建与认领仍只写网络原子记录，认领事件在持久提交之后、邮件唤醒之前通知宿主。

## 实施与验证记录（2026-10-05）

Phase 0 已通过零模型验收；Phase 1–5 的代码与确定性回归已实现。本轮没有启动外部模型，实测成本标定、模型截断率以及 12 次主实验的结果尚未产生。

最终检查：`npm run typecheck`、`npm run build` 通过；`npm test` 通过 313 项内核/单元测试与 8 项客户端测试，失败数为 0。

默认采用自组织恢复，四个参考策略均通过真实认领读取失效分片，并只发送四账户小计、已应用条目数与槽位来源。`experiments/results/reference-baseline.json` 保存完整结果：

| 策略 | messages | hops | maxContextBytes | 最大节点动作数 | oracle |
|---|---:|---:|---:|---:|---|
| hub | 22 | 22 | 1346 | 11 | 通过 |
| ring-gossip | 68 | 68 | 3811 | 14 | 通过 |
| tree-aggregate | 27 | 27 | 1420 | 12 | 通过 |
| adaptive | 67 | 67 | 4633 | 15 | 通过 |

计量包含建网任务、控制消息和结果信封；同一邮件只计一次，转发产生新邮件。`hops` 是已送达的实际边传输数，每个运行时发送跨一条边。上下文代理累计接收的邮件载荷，包含信封及结构化结果，不含共同提示词和工具输出。hub 沿真实有向邻居路径路由，不允许跨非邻居直接发送普通消息；这些数值是可实现参考成本，不是数学最优下界。`atnPayloadBytes/reference.maxContextBytes` 按设计保留，另报同口径的总载荷比值 `relativeTotalPayloadBytes`。

参考脚本不调用模型循环。专用宿主让真实 Agent 的输入直接写入 Session，再由原有运行时确认持久回执，并在 `llm/stream` 设置禁止调用的断言。普通基线不消耗准入步；闸门以每次文档读取/运行时动作占一个准入步的保守代理重跑 hub，使用与对应实验相同的运行时配置、任务、恢复模式和总动作上限。四策略在 16 步代理下均可交付；这不保证真实模型的推理成本、token 用量或墙钟完成时间。

默认主实验矩阵为两个任务 × 两条自组织臂 × 三次重复。`atn-no-rewire-preassigned-backup` 与 `atn-adaptive-preassigned-backup` 是独立对照模式，不混入默认矩阵。失败样本保留在 `results.json`，`summary.json` 汇总通过率、相对成本和每次重连对应的结果。

执行入口：

```sh
# 离线参考；不需要网络、模型或凭据
npm run experiment:reference

# 显式启动两任务各一对标定；仅在要执行外部模型时加 --execute
npm run experiment:pilot -- --calibrate --models <model-id> --out <calibration-directory>

# 使用实测标定文件，主实验阈值自动取匹配两臂最大已知成本的两倍
npm run experiment:pilot -- --calibration <calibration-directory>/results.json --models <model-id> --out <main-directory>
```

模型命令缺省只展示计划；标定命令和主实验命令均须显式 `--execute` 才会调用模型。主实验缺少匹配标定时拒绝执行；标定失败、用量未知或发生输出截断也不能生成安全阈值。输出上限默认 8192，普通任务上限 128，每节点默认 16 步；总调用安全上限必须覆盖所有节点的步数配额。

交付持有者既可 `submit_answer`，也可用最终 JSON 作为 `atn_finish(scope=network)` 的 summary；成功的原生交付会直接成为实验提交，避免网络完成后再提交被权限门拒绝。恢复 ACL 跟随当前实验场景保存；本轮没有新增整个实验跨进程恢复能力。
