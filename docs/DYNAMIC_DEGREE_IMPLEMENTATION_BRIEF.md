# dsh-ATN 动态出度实施说明

这份文档交给实现代理执行。当前出度上限是一个写死的常量 4：它与网络规模无关，因此在只有 2 个节点的网络里给出一个物理上不可满足的额度，在 32 个节点的网络里又限制了局部探索。本轮把出度上限改为**随网络规模按对数曲线增长**，并保持「稀疏、单调、可离线核验」三条性质。

实现代理在动手前必须先完整阅读本文件，并按第 8 节完成标准交付。

## 1. 当前基线（已独立核实）

- 工作区：`D:\dsh-ATN`，分支 `codex/release-ready`，工作树干净。
- `npm test` 为 **542 项 runtime／集成 + 8 项 UI，全部通过，0 跳过**（本轮开工前实测，退出码 0）。
- `MAX_COLLABORATION_PEERS = 4` 定义于 `src/topology.ts:20`；`checkedPeerLimit`（`src/topology.ts:22-27`）对 1–4 之外的值抛 `invalid-peer-limit`。
- 唯一的判定入口是 `collaborationPeerLimit(record: Pick<NetworkRecord, 'limits'>)`（`src/topology.ts:30-32`）。**它的签名只能看到 `limits`，看不到节点数量——这是本轮要动的缝。**
- 调用点：`src/runtime.ts:1084, 1097, 1265, 1514, 1662, 1711, 1731`；`src/observer.ts:46`；`src/topology-feedback.ts:73`。
- 另有三个内部调用点：`rewireNode`（`src/topology.ts:228`）、`reconcileTopology`（`:255`）、`connectPublishedNode`（`:284`）。
- 上限在**建网时一次性冻结**：`src/runtime.ts:857` 的 `limits: limitsFromConfig(this.config)`，来源 `src/config.ts:138-156`。
- 第二处未复用常量的字面量：`src/schema.ts:355` 的 `z.number().int().min(1).max(4).optional()`。
- 配置面：`src/config.ts:52`（默认值）、`:85`、`:106-107`（关系校验，拒绝 > 4）、`:140`（投影进 limits）、`:16`（文档注释「1–4」）。
- 模型可见面：`src/runtime.ts:1662` 在 `status()` 里返回该上限；`src/runtime.ts:193` 的注释写作 "Up to four active collaborators"。
- **`NEIGHBOURS_PER_DIRECTION = 2`（`src/topology.ts:17`）不是出度。** 它是旧出生谱系的引导槽位（2 上 + 2 下 = 4 个引导槽）。本轮**不得**改动它，也不得把它与本轮的出度上限混为一谈。
- 实验已显式冻结更低的上限，本轮必须继续尊重：`experiments/shifting-evidence-reference.ts:19,60,90,199`、`experiments/shifting-evidence-run.ts:262,289`、`experiments/topology-binding-audit.ts:105`。

## 2. 本轮要解决的核心问题

### 2.1 额度与规模脱钩

上限恒为 4，而网络规模由 `maxResidentNodes`（默认 8）与 `maxTotalNodes`（默认 32）描述。两端都错：

- **小网络**：N=2 时一个节点最多只有 1 个可能邻居，额度 4 是不可满足的；`collaborationPeers` 的 `slice(0, limit)` 在此掩盖了差异，但 `status()` 仍向模型报告 4，模型据此规划出的换边请求必然失败。
- **大网络**：N=32 时额度仍是 4，局部探索半径被固定住，与「自适应拓扑」的定位不符。

### 2.2 「动态」必须单调，否则会静默截断已有边

`collaborationPeers` 用 `slice(0, limit)` 截断邻居表，`reconcileTopology` 用同一上限钳制超长列表。**如果额度会随规模下降，节点已建立的出边会在下一次读取时被静默砍掉。** 这是本轮最重要的约束：曲线必须是**单调非减**的。这就是本设计以**累计节点数**（而非当前 active 节点数）为输入的理由——active 数会因退休而下降。

### 2.3 语义变更必须显式，不得静默

`maxCollaborationPeers` 的语义从「出度上限本身」变为「出度上限的天花板」。这是一个**语义变更**，必须在配置文档、README、`status()` 返回与迁移说明中同时写明，不得让既有 profile 的配置项含义悄悄漂移。

## 3. 目标

- **G1 动态**：有效出度上限随累计节点数按对数曲线增长，不再恒为 4。
- **G2 单调**：有效上限在整个网络生命周期内**非减**；任何时刻都不会因上限变化而截断已存在的出边。
- **G3 稀疏**：默认配置下的全网出边总数保持 O(N log N)，不与 N² 同阶；默认规模（8 节点）下有效上限**恰好为 4**，与现行行为逐位一致。
- **G4 天花板可配**：部署可配置一个硬天花板；实验显式冻结的低上限语义不变（冻结 2 仍得 ≤2）。
- **G5 可离线核验**：给出一个纯计算的度数表（N → 有效上限），不调用模型、可在 CI 中重跑。
- **G6 旧记录兼容**：持久化 domain 版本不变，旧网络记录可继续读取与运行。

## 4. 必须实施的项目

### 4.1 让上限看到网络规模

要求：

- 把 `collaborationPeerLimit` 的输入从 `Pick<NetworkRecord, 'limits'>` 扩展为能看到**累计节点数**的形态（整条 `record`，或显式传入计数）。实现形态由实现代理选择，但必须满足：
  - 全部 10 个调用点（第 1 节列出）统一走同一个函数，**不得**在任何调用点就地内联曲线计算。
  - 累计节点数定义为 `Object.keys(record.nodes).length`，即**该网络生命周期内已创建的全部节点**，包含已 retired / failed 的节点。**不得**改用 active 节点数（违反 G2）。
- `src/schema.ts:355` 的 `.max(4)` 必须改为引用同一常量，消除第二处字面量。

验收测试（确定性、零付费模型）：

- 存在单一导出函数，给定 `record` 返回有效上限；对同一 `record` 反复调用结果相同（纯函数，无隐藏状态）。
- 构造一个 N=2 的记录与一个 N=32 的记录，断言两者返回的上限不同且后者更大。
- 静态断言：`src/` 下不再存在 `max(4)` / `> 4` / `1–4` 形式的出度上限字面量（`NEIGHBOURS_PER_DIRECTION` 除外）。

### 4.2 对数曲线

要求：

- 有效上限 = `clamp(1, ceil(log2(N)) + 1, ceiling)`，其中 `N` 为累计节点数、`ceiling` 为第 4.3 节的天花板。
- 必须满足的度数表（`ceiling` 不成为约束时）：

  | N | 1 | 2 | 3 | 4 | 5–8 | 9–16 | 17–32 |
  |---|---|---|---|---|---|---|---|
  | 有效上限 | 1 | 2 | 3 | 3 | 4 | 5 | 6 |

- **N=8 时必须为 4**，与现行默认行为一致。这是 G3 的锚点，不得漂移。
- 上限必须 ≥1：N=1 时给出 1，不得给出 0（0 会让入口节点无法建立任何出边）。

验收测试：

- 单元测试逐行断言上表每一档。
- 断言单调性：对 N=1..64 逐点断言 `f(N+1) >= f(N)`。
- 断言稀疏性：对 N=32 断言 `N * f(N) < N*N / 2`（即远低于全连接）。

### 4.3 天花板语义与默认值

要求：

- `config.maxCollaborationPeers` 语义改为**天花板**，不再是出度本身。
- `MAX_COLLABORATION_PEERS` 的取值提高到 **8**，作为绝对硬上限；`config.maxCollaborationPeers` 默认值同为 8。
- 选择 8 的理由必须写进注释与文档：默认 `maxTotalNodes = 32` 时曲线给出 6，天花板 8 因此**永远不是默认配置下的约束**，只作为部署侧的安全阀。
- `src/config.ts:106-107` 的关系校验改为「不得超过 `MAX_COLLABORATION_PEERS`（8）」，`src/config.ts:16` 的注释同步改为天花板语义。
- 旧记录里冻结的 `maxCollaborationPeers: 4` 必须继续可读，且其效果为 `min(4, 曲线)`——即旧网络在 N≤8 时行为完全不变。**不得**为旧记录做数据迁移或重写。

验收测试：

- 配置 `maxCollaborationPeers: 2` 时，N=32 的有效上限为 2（实验冻结语义保持）。
- 配置 `maxCollaborationPeers: 8`（默认）时，N=32 的有效上限为 6。
- 手工构造 `limits.maxCollaborationPeers = 4` 的旧记录，断言 N=8 时有效上限为 4、N=32 时为 4（天花板生效）。
- 配置 `maxCollaborationPeers: 9` 被 `assertConfigRelations` 拒绝，错误信息指向 8。

### 4.4 模型可见面报告真实额度

要求：

- `src/runtime.ts:1662` 的 `status()` 必须返回**当前有效上限**，而不是天花板，也不是配置值。模型据此规划换边，报告天花板会让它提交注定失败的请求。
- `src/runtime.ts:193` 的注释与工具描述文本同步改写，不得再出现 "four" 这个定数。
- `src/topology-feedback.ts:52` 的 `snapshot.peers.length <= MAX_COLLABORATION_PEERS` 校验改为对**有效上限**校验；否则大网络下的合法邻居表会被误判为超限。

验收测试：

- 在 N=2 与 N=32 两个网络上分别调用 `status()`，断言返回的上限与 4.2 度数表一致。
- 构造一个 peers 长度等于有效上限的拓扑反馈快照，断言通过校验（修复前该用例在 N>8 时失败）。

### 4.5 单调性与截断安全

要求：

- 断言有效上限在网络生命周期内非减：节点只增不减，因此累计计数单调，曲线单调。
- `collaborationPeers` 的 `slice(0, limit)` 与 `reconcileTopology` 的钳制行为必须保留，但在新曲线下**不得**再截断任何已存在的合法出边。
- 若实现过程中发现任何路径会因上限变化而丢弃 `peerIds`，该路径必须改为保留；**不得**通过「上限永不下降」之外的手段绕过（例如不得引入静默裁剪）。

验收测试：

- 构造 N 从 1 增长到 32 的序列，在每一步断言既有节点的 `peerIds` 长度不减少。
- 显式断言 `reconcileTopology` 在累计计数增长后不会缩短任何节点的 `peerIds`。

### 4.6 交付离线度数表与证明脚本更新

要求：

- 交付一个纯计算脚本，对 `N = 1..maxTotalNodes` 输出：N、有效上限、全网出边上界、与全连接的比值。
- `experiments/topology-binding-audit.ts:105` 与 `tests/fixtures/binding-evidence.ts:49` 中冻结的上限必须改为**按曲线取值**，或显式冻结一个常数并写明理由。**不得**让结构证明悄悄继续使用旧的常量 4 而不作说明。
- 第五轮结构证明（`docs/TOPOLOGY_BINDING_IMPLEMENTATION_BRIEF.md` 所确立的可达性证明）如果因上限变化而结论改变，必须在报告中如实写明哪几个 seed 的结论发生变化。**不得**假定结论不变。

验收测试：

- 脚本对每个 N 输出一行，可在 CI 重跑，不调用模型。
- 若某 seed 的可达性结论与旧证明不同，报告中逐 seed 列出。

## 5. 文档同步（必须，不得省略）

以下每一处都在陈述「出度 ≤ 4」这一**已发布承诺**，必须逐条改写为曲线语义，并保留旧值的适用条件：

- `README.md:32`（拓扑层表格「出度严格受限（≤ 4）」）
- `README.md:62`（「出度硬顶控制：单节点最大活跃出边为 4」）
- `README.md:220`（配置表 `maxCollaborationPeers` 默认值与「硬约束 1–4」）
- `docs/ADAPTIVE_TOPOLOGY.md:11`（`atn_rewire` 的 `maxCollaborationPeers` 1–4 描述）
- `docs/STRATEGY_AND_POSITIONING.md:14, 22, 63`（三处把出度上限 4 当作机制证据）

改写时必须保留可核验性：**「默认规模（8 节点）下上限仍为 4」这一点必须写清楚**，因为它是历史实验结论仍然有效的前提。

## 6. 必须保留的既有语义

- 入口 Agent 由宿主拥有；完成、停止、退休都不 `dispose` 入口。
- 网络记录是唯一原子持久化单元；「检查 + 修改」在同一 mutation 临界区内完成。
- 边是单向的；出生谱系只作追溯。
- 工具身份、发送者、投票者取自真实 live Agent。
- 同伴文本不构成人类授权；请求者评价不构成宿主验收。
- `stepBudget` 不得被宣称成 token、HTTP 请求或费用上限。
- 同能力原则：本轮改的是**连接额度**，不是任何节点的模型、工具或权限。
- 持久化 domain 版本保持为 1。
- `NEIGHBOURS_PER_DIRECTION = 2` 的旧出生谱系引导语义不变。

## 7. 不要做的事

1. 不新增模型工具。
2. 不以当前 active 节点数为曲线输入（违反 G2 单调性）。
3. 不在调用点就地内联曲线计算，必须收敛到单一函数。
4. 不引入会静默截断既有 `peerIds` 的任何路径。
5. 不改动 `NEIGHBOURS_PER_DIRECTION`，也不把它当作出度。
6. 不删除已有测试，不降低断言强度。
7. 不为旧网络记录做数据迁移或重写。
8. **不得把未测试内容写成已通过。**

## 8. 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
```

并且：

1. 所有原有测试继续通过；因语义变更而必须修改的断言（第 9 节列出的清单）逐条给出修改理由，**不得**直接删除用例。
2. 4.1–4.6 各自的新增测试有可核对的修复前失败记录（无法重放的必须逐项列出，不得补造证据）。
3. 交付 4.6 的度数表脚本及其对 `N = 1..maxTotalNodes` 的完整输出。
4. 给出默认配置下 N=8 与 N=32 两个点的有效上限实测值，并明确 N=8 是否为 4。
5. 完成第 5 节全部文档改写，逐条列出改了什么。
6. README 与本轮报告同步记录实际通过项与未完成项。

交付物：

- 代码与测试改动。
- 度数表脚本与输出。
- 结构证明 seed 结论是否变化的逐项说明。
- `docs/` 下的一份本轮实施报告。

## 9. 预期需要修改的既有测试（实现前逐条确认）

这些用例断言了常量 4，改动后必然需要更新；**逐条确认其断言强度不降低**：

- `tests/unit/topology-limit.test.ts:44, 46, 87, 93-114 (DEGREE-04), 116-133 (DEGREE-05), 130-131`
- `tests/unit/config.test.ts:69-80`（遍历 1..4、默认 4、拒绝 5）
- `tests/unit/topology.test.ts:2, 16`（`['B','A','D','E']`）
- `tests/unit/adaptive-topology.test.ts:21, 23, 76, 150-151`
- `tests/integration/adaptive-topology.test.ts:212`
- `tests/integration/experiment-topology.test.ts:30`（`length === 4`）
- `tests/unit/experiment-topology.test.ts:10, 96`
- `tests/unit/five-arm-comparison.test.ts:101, 104`
- `tests/integration/topology-binding-reference.test.ts:15`（`maxPeers, 4`）
- `tests/fixtures/binding-evidence.ts:49`
