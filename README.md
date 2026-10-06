# dsh-ATN

dsh-ATN 是 DeepSeek Harness 的一个插件。装上之后，Harness 的「Agent 预设」里会多出一个 ATN 模式：一群能力相同的 agent 各自只看得到身边少数几个同伴，自己决定跟谁合作、把活分给谁，一起完成同一个目标。

这里没有中心调度，没有角色模板，也没有固定的协作轮次。运行时只负责持久化、投递、生命周期、额度和身份检查这些底层的事；连接和分工是节点自己的选择。

> **版本 0.4.0，开发者预览。** `npm i dsh-atn` 装到的就是它，安装时写明确版本号更好复现。
>
> 0.4.0 将模型界面收敛为六个工具和六行规则：反馈与换边并入 `atn_status`，知识发布并入 `atn_board`，固定上下文约减少 34%。这是破坏性变更，旧工具调用的迁移方式见下方的 [0.4.0 变更](#040-变更)。
>
> 需要说清楚的是，**目前还没有实验证据表明 ATN 比 Harness 自带的 agent team 更强**。已有的真实模型对照规模都很小，结果与边界见[实验说明](docs/EXPERIMENT_PILOT.md)和[自适应拓扑设计](docs/ADAPTIVE_TOPOLOGY.md)。

## 设计取向

0.4.0 包含 P0–P5（请求者反馈、知识指纹、白板、可配置出度及新任务族）及可测性恢复改动，将模型面收敛为六个工具和六行规则；实现、校准与未完成项见[恢复报告](docs/MEASURABILITY_RECOVERY_REPORT.md)，历史真实模型数据见[实验记录](docs/FULL_FEEDBACK_EXPERIMENT.md)。实验代码与原始结果保留在仓库，不随插件 npm 包发布。

上一轮可测性恢复验收：固定协议由 10843 降到 7160 字节（-33.97%），394 项 runtime/集成与 8 项 UI 测试、类型检查、构建、打包及 profile smoke 全过。该轮源码的脚本校准 45/45；真实免费模型 fixed 在报告所列显式“链长 2 / 32 步 / 400 万 token 观测阈值”条件下 5/5，两阶段均提交正确，默认预算未提高。真实输入的已知调用均值为 1961.60（435/462 已知），尚不足以确认稳定明显降幅；部分新增测试的修复前失败留证仍不完整。这些历史运行不替代新任务复验。

本轮同伴质量差异实现见[实施报告](docs/PEER_VARIANCE_IMPLEMENTATION_REPORT.md)：固定 slot 持有旧版本证据，请求者按阶段／版本、键和必需字段拒绝；同能力与原子写语义保留。固定协议 7160→7060 字节，当前 419 项 runtime／集成和 8 项 UI 测试、类型检查、构建、打包与 smoke 通过。此前独立 bare-Node / Space Bunny 的 25 文件源码批次及全部失败完整归档，其 0/5 不证明实际 Desktop 导入路由失败。当前 26 文件源码的 90 次脚本扫描正确 57/90，选择链长 2／48 步；实际 Desktop 的 10 个导入模型与实时免费参考价交集只有 LongCat，另纳入用户授权的 DeepSeek V4.1 Flash。两模型各 5 次独立探针后 5 次 fixed 共 20 次正式 ATN 执行已完成，1,958 次可观测 LLM 尝试未记录到 provider 错误。DeepSeek probe 两阶段正确 3/5、fixed 4/5，通过可解性要求；LongCat probe 0/5、fixed 1/5，且 probe 用满 48/48 步。两个模型都仅在 2/5 探针中实际换边，可发现性闸门未通过。DeepSeek fixed 的 6 条父调用终止记录缺失与 LongCat 一次提交后报错返回在报告中分列保留，不能改记为连接失败。短工具往返各 2 rounds 只证明路由，不计 ATN；Muse 非免费、Space Bunny 未导入，实际 Desktop 未向它们发送推理请求。[最终实际导入索引](experiments/results/peer-variance-dsh-import-20261006.json)保留原始来源与哈希。四臂效果比较未执行，不声称拓扑收益。

- **同能力，独立个体。** 节点之间没有能力差别。出生关系只是谱系记录，不构成执行层级——创建者退出，后代不会被连带终止。
- **局部信息，按需发现。** 每个节点最多持有四个协作邻居，能看到它们的任务摘要、近期结果和负载。要找人就用 `atn_status` 查相关候选，或用 `query="*"` 做有界轮转探索。发现本身不会连边。
- **连接由自己换。** `atn_status(rewire={peers})` 用一次原子写替换自己的全部出边，可以跨出生分支去找人。边是单向的：A 选了 B，不强制 B 选 A。
- **退出只补位，不重排。** 同伴退出时，运行时沿着这个同伴已知的连接补上失活的槽位，不会全网重新挑一个「最优」节点，也不会主动填满空槽。节点显式设成 `[]` 的空邻域保持为空。
- **断边不影响旧任务。** 连接变了，已经在跑的任务照旧，结果仍只回给原请求者；双方可以带着同一个 `taskId` 继续讨论。
- **一份共享目标。** 所有节点读同一份目标、成功标准和共同约束，版本持久化在网络记录里。
- **模型看到六个工具。** `atn_status` 合并发现、任务检查、评价与换边；`atn_board` 统一发布知识和共享发现。治理保留为宿主 API。
- **反馈不额外花钱。** 运行时自己记录本地任务耗时、模型步数、失败与重试，等下一次真有输入进模型时捎带一条摘要，不单独唤醒节点，也不额外调用模型。
- **预算按节点算。** 每个节点有独立的步数预算，用完就退休。
- **没主的活可以认领。** `atn_status` 会列出失去有效持有者的孤儿任务，空闲节点可以原子认领，并保留原来的尝试与重试关系。
- **退休分两步。** 先停止接新活（`draining`），结清手上的旧任务和旧投票之后才真正释放（`retired`）。

## 安装

需要已安装的 DeepSeek Harness `0.2.0-rc.2`、Node.js 24，以及可用的模型配置。先确认 `dsh --version` 能正常输出。

### 从 npm 安装

```bash
dsh plugin --profile web add dsh-atn@0.4.0
dsh --profile web --dump-config
```

`--dump-config` 的输出里应当能看到宿主服务 `atn`、预设声明 `preset-atn`，以及预设内部的 `atn-tools`。桌面端把 `web` 换成实际在用的 profile 名。装完重启该 profile。

接着：

1. 打开「设置 → Agent 预设 → 自定义 → ATN」，可以看到它由哪些插件组成，也可以点「设为新任务默认」。
2. 新建任务；开启 Harness 的开发者工具时，也可以在新任务页的预设选择器里直接选 ATN。
3. 用自然语言把任务说清楚即可，例如「核对当前项目 README，拆给几个节点查，把证据汇总起来」。ATN 的提示词会引导入口模型先调 `atn_start`，再按需创建节点，不需要你手写工具调用。

安装不会自动改变默认模式。Standard、PTC、Minimal、Creator 这些已有预设不会多出 ATN 的工具或提示词，已经开着的任务也保持原有预设。只选择 ATN 或者只发一句问候，插件不会自己建网——建网始终要由模型调用 `atn_start`。

### 从旧版本升级

0.1.0 把 ATN 工具全局加载，0.2.0 起把它们放进独立的 ATN 预设。升级就是对实际使用的 profile 重跑一遍上面的安装命令，重启后选择 ATN 新建任务。只升级旧的 `headless` profile 拿不到独立模式。已有会话不会自动迁移，升级前先把旧版本的网络停干净。

**0.4.0 是破坏性变更。** 模型不再注册独立的 `atn_rewire`、`atn_feedback`、`atn_publish` 工具。调用脚本和自定义提示词需迁移到 `atn_status(rewire={peers})`、`atn_status(review={taskId,status,summary,evidence,comparisonKey?})` 和 `atn_board(action="publish", key, body, documents, topics, expectedRevision)`；创建白板条目用 `expectedRevision=0`，修改时先读取当前版本。

### 从源码构建

```bash
git clone https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN
npm ci
npm run build
npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.4.0.tgz
```

用 `dsh plugin add github:...` 直接安装的方式没有验证过，建议走 npm 包或者自己构建的 tarball。

### 前置依赖

ATN 不是自成一体的插件，它面向完整的 Web/桌面 profile，需要 `agentPresets` 注册表、`systemPrompt`、`agents`、`tools`、`sessions`，以及 `storageDomain` 和 KV 后端（例如 `@deepseek-ai/dsh-storage-json`）。persona、工作区指令、文件/搜索、终端、技能、询问用户、待办、Web、展示和上下文压缩这些插件，都复用宿主提供的实现。缺依赖时预设会显示为不可用；缺存储时 `atn_start` 会以 `storage-unavailable` 明确失败。

Bundle 只往宿主配置里加 `atn` 和 `preset-atn` 两行，六个 ATN 工具和共同规则都在预设作用域内，运行时由宿主统一持有。节点会加入创建者当时使用的同一预设版本，并记录 preset ID 和工作目录；冷恢复时按节点自己记录的 preset ID 挂载当前定义，预设缺失或不可用就明确失败，不会退回当前默认模式。

没有预设注册表的 `headless` profile 不提供这个模式。自定义嵌入式装配仍可显式加载 `dsh-atn` 和 `dsh-atn/tools`，但那是全局工具装配，不是本插件默认的安装入口。

## 上手例子

在选择了 ATN 的新 Session 里，节点会自己发现并选择同伴。下面展示的是底层协议，`node-*`、`task-*` 以工具实际返回值为准：

```text
atn_start(objective="把 docs/x.md 的结论核对清楚", successCriteria="每条结论都有可复查来源", constraints="不要访问付费模型")
atn_spawn(task="核对第 2 节的三条来源", context="x.md 第 2 节")
atn_status(query="来源核对")
atn_status(rewire={peers:["node-2", "node-3"]})
atn_send(to="node-3", kind="task", body="补充核对第 3 节")
```

这里假设发现结果里已经有可复用的 `node-3`。它收到的任务上会写清 `holder`、`requester` 和 `taskId`。如果请求者是 `node-1`，做完应当回：

```text
atn_send(to="node-1", kind="result", taskId="<返回的任务 id>", body="完成", summary="第 3 节已核对", evidence=["docs/x.md:40-58"])
```

即使双方中途重连过，这份结果仍然送得回去。之后是继续协作还是 `atn_finish`，由各节点根据后续工作自行决定——上面的例子不是固定流程。

失败时显式传 `outcome="failed"`，并在摘要里说明原因。省略 `outcome` 一律按 `completed` 结算，正文里写「失败」不会改变状态。

请求者收到的是正文、持久结算的 `outcome`、完整 `summary` 和 `evidence` 引用；恢复补发使用同一份持久结果。消息标识、摘要与证据也计入 `maxMessageBytes`，超限会拒绝整次结算。新建消息 id 不接受换行，同 id 重试要先按稳定标识去重。另外，把证据传过去不等于证据已经被独立验证，`completed` 始终只是任务持有者的声明。

只有 `atn_start` 会创建网络。安装插件本身不会运行任何蜂群，其他 Session 也不会产生 ATN 状态或额外的模型请求。

## 工具

| 工具 | 必要输入 | 语义 |
|---|---|---|
| `atn_start` | 目标、成功标准、共同约束 | 在当前 ATN Session 初始化网络、建立初始任务，返回网络/节点/任务标识；不额外生成主管 |
| `atn_spawn` | 局部任务、上下文、可选寿命 | 创建一个同能力独立节点，先把它连到创建者及其已有同伴（至多四个）；创建者有空槽时也连向新节点。id 由运行时分配 |
| `atn_send` | 目标、类型、正文；`result` 另需任务标识、摘要、证据，可选 `outcome=completed\|failed`；可选稳定 `messageId` | 新的 `task` 和 `note` 只能发往自己的出边邻居或自己。`result` 只能结清自己持有的任务并交给其原请求者，默认 `completed`，`outcome` 仅对 `result` 有效。带真实 open 任务 id 的 `note` 允许任务双方在断边后继续讨论。发送者取自真实调用者。带 `messageId` 的同内容重试幂等；同一个 id 换成别的内容或结果状态会被拒绝 |
| `atn_status` | 可选 `query`、`taskIds`；可选写操作 `claimTaskId`、`review` 或 `rewire`（三选一） | 返回邻居、候选、任务、遥测和预算。`review={taskId,status,summary,evidence,comparisonKey?}` 评价请求结果；`rewire={peers}` 原子替换完整出边；空闲节点可认领孤儿任务 |
| `atn_board` | `action=read\|publish\|remove`；写入需 `key`、`expectedRevision`，发布另需 `body`，可带 `documents`、`topics` | 有界共享白板及发现元数据。仅作者可修改或删除；创建用版本 0，更新使用读到的当前版本。读取支持查询与分页，不唤醒其他节点；读写次数和载荷字节单独计量 |
| `atn_finish` | 可选 `scope=node\|network`；`network` 另需 `summary`、`goalVersion` | 默认只让请求节点退休，不代表任务完成。入口以 `scope=network` 提交最终摘要和证据；仍会检查任务、邮件、提案和目标版本是否结清 |

模型不再暴露 `atn_feedback`、`atn_publish`、`atn_rewire`、`atn_tasks`、`atn_peers`、`atn_renew`、`atn_propose`、`atn_vote`、`atn_deliver`。宿主侧的 `tasks`、`peers`、`renew`、`propose`、`vote`、`deliver` API 保留，供检查、恢复和管理调用。换边的 `baselineTaskIds` / `candidateTaskIds` 只留在宿主 runtime API，不再进入模型 schema。最终交付必须显式写 `scope=network`；只传摘要不会意外触发节点退休。

节点也可以让出既有义务：`draining` 节点仍能提交自己旧任务的 `result`、投出已分配给自己的旧票、发送普通通知，但不能再发起新 `task`，也不再接收新任务。

入口 Agent 归宿主所有：插件卸载或网络完成都不会 `dispose` 它。

## 可视化 ATN 网络

ATN 预设会话的顶部会多出一个「可视化ATN网络」按钮，位置在预设名称右边；其他预设、或者预设信息还没加载出来的时候不显示。点开能看到当前会话所属网络的节点、共享目标、任务和近期活动——同一网络的入口会话和子节点会话都能打开这份观察视图。ATN 会话还没建网时显示等待建网的空状态。切到别的预设会话，面板会跟着入口一起关闭并停止轮询。

- 实线箭头 `A → B` 表示 A 当前选了 B 当协作者；互相选择会画出两个方向。勾上出生关系，可以用虚线单独看谁创建了谁。
- 点节点能看到运行/空闲/退出状态、正在调用的工具、待办任务、完成或失败的结果、出边邻居和入边来源。活动区展示任务分配、消息投递、工具调用、投票和连接变化。
- 面板开着的时候，每次请求结束后大约一秒刷新；关掉或者切换会话会取消旧请求。连接异常会明确标记上一份快照已经过期，恢复后继续刷新。
- 观察接口是只读的，走 Harness 已有的、已认证的桌面/Web 通道，不启动也不唤醒节点，不改协作边，也不会把全网信息塞进模型工具的局部视野。任务最多显示 200 条，活动最多保留 120 条；实时连接事件不跨进程保存，重启后由持久化的任务、消息和目标记录补出历史。

## 连接、任务与退出

每个节点的 `peerIds` 持久保存最多四个出边邻居，`atn_status` 返回的 `neighbours` 是当前真正可协作的列表。`creatorId` 和 `selectedChildId` 永久保留出生谱系，后续重连不改这些记录，通信和新提案的审批者也不再由谱系决定。

读到缺少 `peerIds` 的旧记录时，运行时会按旧的出生链邻域初始化一次，并在原子更新里持久保存；已经存在的 `peerIds: []` 表示主动断开，不会被重新初始化。`atn_status` 不再返回旧的 `upstream` / `downstream` 分组。

连续调用 `atn_status(query="*")` 会从上次返回的位置继续往下轮转，每次最多给出三个非邻居 active 候选。游标按网络和调用节点分别保存在内存里，运行时重启后从第一批重新开始；普通文本查询保持相关性排序，也不会推进探索游标。`recentResults` 是字符串数组，每条摘要用 `[completed]`、`[failed]` 或 `[unreachable]` 标明终态，`unreachable` 任务没有结果正文时用任务描述代替。节点可以据此自行决定重试、换人还是重连。

节点用 `atn_board(action="publish", key, body, documents, topics, expectedRevision=0)` 发布文档、主题和发现。文本查询检索白板元数据及任务文本；旧记录的 `knowledgeFingerprint` 作为兼容只读元数据参与查询；相关性相同才比较请求者本地认可率、共享认可记录、当前负载和稳定顺序。`knowledgeFingerprint` 明确标注自报来源，接受次数来自有结果哈希绑定的真实请求者评价，不能由发布者填写。`requesterFeedback` 是当前观察者请求过的工作；`verifiedFeedback` 保留独立宿主检查结果。旧记录没有知识指纹或评价时按未知处理。

请求者收到完成结果后，用 `atn_status(review={...})` 给出 `accepted`、`rejected` 或 `needs-more` 并附证据。不能自评，不能评价别人的请求，也不能评价开放任务或交付义务。完全相同的重试保留原记录；`needs-more` 可以在同一 `comparisonKey` 下变为最终认可或拒绝，最终评价不能覆盖。`needs-more` 不按拒绝计分，缺少可比样本时仍报告 `insufficient-evidence`。宿主否决会使冲突的本地认可退出有效信号，但保留原始意见供审计。下一次正常输入会带上本地质量摘要，不为评价额外创建模型调用。

按请求契约检查可见的阶段／版本、返回的键和必需字段；不匹配的阶段／版本、错误的键或缺少必需字段可本地判为 `rejected`。先用 `atn_status(query=...)` 发现其他持有者，再用单独的 `atn_status(rewire={peers:[...]})` 替换完整出边列表。请求者无法检查的隐藏证明正确性仍由宿主独立验收。

可运行 `npm run experiment:feedback-milestone` 重现旧机制诊断（显式 M=1），详见 [P0/P1 里程碑](docs/FEEDBACK_MILESTONE.md)。该里程碑不再是能力或实验准入判据。完整机制另有 [P0–P5 实施及实测说明](docs/FULL_FEEDBACK_EXPERIMENT.md)：白板、稀疏拓扑和变化依赖链任务均已实现，真实模型结果与确定性机制证据分开报告。

边级评价按 `(requesterId, holderId, comparisonKey)` 累计不同任务的评分。换边冻结旧边样本，新边待观测；后续评分和停止会更新原记录，默认两侧每边至少 2 个终态评分才比较。`new-edge-unobserved` 与 `no-ratings-at-all` 区分尚未使用新边和从未评价；所有结果保留 `causalClaim:false`。

白板最多保留 64 条、合计 64 KiB，每条含元数据不超过 4096 UTF-8 字节；读取每页最多 8 条、16 KiB，返回余页游标。没有隐式逐出其他作者条目：容量满时需更新或删除自己的条目。写入使用精确版本检查；修改或删除后旧分页游标失效。成功读写的次数与载荷字节累计保存，删除条目不清零用量。白板不结清任务、不改变宿主验收，也不会因发布而启动其他模型。

新节点从创建者和创建者当前的同伴开始协作；创建者还有空位时会把新节点加进自己的列表，满槽则保留已有选择。第一个**成功发布**的子节点仍会记进 `selectedChildId`，仅供追溯。并发创建和重连都由原子网络更新裁决。

`atn_status(rewire={peers:[...]})` 可以直接选到发现出来的其他分支节点。无效选择会让整次调用失败，不会留下半张拓扑。某个邻居进入 `draining`、`retired` 或 `failed` 时，运行时只沿着它已知的连接找 active 节点补上那个失活槽位，其他有效选择保持不变；实在没有候选就留空。空槽和出生谱系都不会让已删除的连接自动回来，不过失活同伴的局部补位仍可能选到以前合作过的节点。显式 `[]` 会一直保持为空。

下一次实际收件箱输入获准进入模型时，运行时会附上局部连接变化和遥测摘要：第一次说明当前邻居，之后把同伴退出、自动补位和主动重连合并成相对上次已持久记录的 Session 快照的差异。摘要正文最多 4096 UTF-8 字节，截断明细保留同伴 ID 和计数。同任务在同一收件 Session 的完整头部只展示一次，后续邮件保留 task 标识与差异。摘要只涉及该网络里自己那几个有界邻居；中间变化会合并成最终差异，没有变化就不重复附加，也不会单独唤醒节点。快照跟着正常输入保存，重启后继续比较，不需要维护临时拓扑事件队列。耗时、步数、失败、重试和下游失败都来自运行时观察，不要求安装 `verifyTask`；宿主验收另行记录，自报完成或者成本低都不构成正确性证明。

退出分两段：`draining` 不接新任务和新提案，但继续处理旧任务、投出已分配给自己的旧票；旧任务和旧审议结清后，调度器自动把它转成 `retired` 并释放 handle。已经投过票的节点不必等别人投票。重连本身不取消任务，不改持有者和请求者，也不改已有的投票名单。

## 宿主治理与验收（可选）

宿主 `ctx.atn.propose` 提交时会一次性固定基础版本、计划正文和全网其他 active/published 节点（至少一个）。提案精确保留 `goalHistory[0]` 里的 objective、successCriteria、constraints，只允许改 `plan`。有人反对就直接 `rejected`；沉默或超时不通过（`expired`）；当前版本已经变了是 `stale`；网络关了就是 `cancelled`。新提案不依赖通信边，旧提案仍按冻结名单授权。升级前尚未提交、又试图改写启动契约的提案会被取消。通知邮件额度不够时原子拒绝，不减少审批人。日常连接和分工由节点自主决定。

`atn_spawn` 和 `atn_send(kind=task)` 可以指定 `dependsOn`（最多 16 个已完成且未被宿主拒绝的上游提交，允许上游尚未验收）和 `retryOf`（自己请求过的失败尝试）。`completed` 只表示已提交，`acceptance` 单独记录独立验证器、证据和结果摘要哈希。模型只能读验收状态，宿主通过 `ctx.atn.verifyTask` 执行检查；没配验证器就一直保持未验收。`atn_finish(scope="network")` 仍然是协议层面的结清，不代替质量评分。

## 停止

宿主级的硬停止是运行时的普通方法，不需要模型配合：

```ts
await ctx.atn.stop(networkId, '用户要求停止')
```

它会先持久关闭新工作入口、结算未完成的提案和开放任务，再取消并等待所有 ATN 持有的 handle 释放，返回 `{ released, stragglers, stragglerDetails, reason }`。`released` 只包含确认 `dispose()` 成功的节点；`failed` 和 `timed-out` 都留在 `stragglers` 里并给出可诊断的原因，超时之后仍可继续追踪，后续 settle 只更新状态，不改写已经返回的报告。停止是持久终态：重启、续期、重发投递和迟到的票都不会让网络复活；重复调用 `stop` 是幂等的。**本版没有提供 CLI 子命令**，停止入口就是 `ctx.atn.stop(...)` 这个宿主方法。

## 配置

所有可变参数都在 Cordis Config 里，安装后可以在 profile 的 `cordis.patch.yml` 覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `maxResidentNodes` | 8 | 驻留工作节点；`provisioning`/`draining` 仍占槽 |
| `maxTotalNodes` | 32 | 每网络累计节点；释放槽位不重置 |
| `maxCollaborationPeers` | 4 | 每节点出度上限，允许 1–4；新依赖链实验设为 2，出生、重连和失效修复都遵守该上限 |
| `requesterMinSamples` | 2 | 每个比较边的最少终态请求者评分；精确重试和 needs-more 转终态不重复计样 |
| `maxTasks` / `maxProposals` | 256 / 64 | 累计正式任务与提案 |
| `maxPendingMailPerNode` / `maxRetainedMail` | 64 / 1024 | 普通邮件的每发送节点待发量与全网保留量；真实任务结果另有结算保留额度 |
| `maxMessageBytes` / `maxDocumentBytes` | 8192 | 单条消息（含 envelope，结果另含摘要与证据）与目标正文的 UTF-8 上限 |
| `defaultLeaseMs` / `maxLeaseExtensionMs` | 5 / 30 分钟 | 默认租约与单次续期上限 |
| `networkDeadlineMs` / `proposalDeadlineMs` | 60 / 2 分钟 | 网络硬期限与提案期限 |
| `stepBudget` | 64 | 每节点 admitted step 预算：入口与子节点分别计数，耗尽只退休对应节点；全网的 `stepsUsed` 保留为汇总指标 |
| `domainName` | `atn_networks` | 持久域名称 |

`stepBudget` **不是** HTTP 请求数、token 预算或者费用上限：它覆盖已经加入网络的入口和子节点准入步数，不覆盖 provider 重试、辅助模型调用、其他 Agent，也不覆盖用户自己写的代码。预算不会因为重连、续期或恢复而重置。

普通邮件额度满了之后，每个已承接任务的首次真实 `result` 仍可以走结算保留额度，避免普通协作邮件挤占结果回传的空间。这个额度只允许真实持有者发给该任务记录中的请求者，不能用于 `task`、`note` 或重复结果；稳定 `messageId` 重试仍复用原记录。全网保留邮件的硬上界是 `maxRetainedMail + maxTasks`，每个发送节点的待发邮件硬上界是 `maxPendingMailPerNode + maxTasks`；消息字节限制、网络状态和任务身份检查照常生效。这个机制不会删除已有回执，也不保证被停止的网络继续结算。

配置在插件加载时校验，而不是拖到第一次写入才失败：每个计数和时长必须是正整数（`0`、负数、小数和非数字都拒绝），`domainName` 必须匹配 `[a-z][a-z0-9_]*`，字段之间的关系（例如 `maxTotalNodes >= maxResidentNodes`、`proposalDeadlineMs <= networkDeadlineMs`）也在同一次校验里检查。

## 并发与生命周期

网络记录是唯一的原子持久化单元，所有网络写操作都经过**按 `networkId` 串行的 mutation 队列**：读取、额度检查、id 分配、业务变换和 `store.update` 都在同一个临界区里完成，`store.update` 的回调只使用传进来的最新记录，绝不基于调用前的旧快照写回。并发 spawn、rewire、send、proposal、vote 和 step admission 因此不会丢节点、连接、任务、邮件、票或者预算。

- **原子发布与初始任务发件箱。** `atn_spawn` 先持久化 `provisioning/pending` 意图，创建 Agent 成功后再在**一次 mutation** 里完成发布、谱系记录、初始连接、任务创建和对应的 queued 邮件。节点与任务额度在创建 Agent 前检查一次，发布时再按最新记录检查。发布或上下文准备失败会补偿节点和未结任务并释放 handle；已经承接的任务遇到临时投递失败则保留 queued 邮件，交给调度或恢复重试。
- **持久投递回执。** 只有目标 Session 历史里已经出现来源为 ATN、稳定消息标识匹配的 `user/message`，并且包含这段历史的 checkpoint flush 成功，才会标记为 `delivered`。还躺在 pending inbox 里或者已被 claim、但还没记进历史的输入保持 queued；当前进程的防重记录避免重复注入，后续由调度或恢复继续确认。初始任务也走这条路径。`send` 可能返回 queued 而节点其实已经在处理；`atn_finish(scope="network")` 会先刷新已消费邮件的收据，再检查待投递的阻塞项。`delivered` 不表示模型已经完成任务，也不保证外部工具的副作用恰好发生一次。
- **退休才释放。** `draining` 节点结清旧任务和旧票后由调度器转成 `retired`，并在同一次调度里启动它名下 ATN-owned handle 的释放，只有 dispose 确认成功才移除所有权记录。`retired`/`failed` 节点不再获得模型步，`draining` 只允许处理已有义务。入口 Agent 永远归宿主所有，完成、停止和退休都不会 `dispose` 它。
- **路由完整继承。** 子节点记录并继承创建者实际请求的 provider/model/**reasoningEffort**，恢复时用持久化的 effort，不回退到 profile 默认值。
- **恢复补发 goal context。** goal 提交会持久保留可重放的当前 revision；提交时没有 live Agent 的节点不会被标记为已同步，`recover()` resume 后按自己的 session 幂等补写当前 revision 的 goal snapshot。

## 数据放在哪

网络记录放在 `storageDomain` 的 `atn_networks` 域里（`single` 布局，一个网络记录一次原子更新），物理位置由 profile 选的后端决定；用 `dsh-storage-json` 时就是 backend `root` 下的一个 JSON 文档。节点上下文是真实的 Harness Session（`sessionId` 记在节点上）。ATN 不读写用户工作目录里可以被覆盖的 JSON 文件，也不把普通 Markdown 当成唯一的授权来源。

## 现状与限制

- 已验证基线是 Harness `0.2.0-rc.2`、Cordis `4.0.4`、Node.js 24。Harness 还在开发者预览阶段，不承诺未来版本兼容。
- 单进程、单执行环境：不支持多机或多进程共享网络，也不能同时起两个运行时写同一份存储。
- 受限 permission/sandbox 策略在真实执行路径上的拒绝行为还没有验证（AUTH-01/02/03）。Agent preset 的同构绑定、旧版本继承和冷恢复已经覆盖，但 preset 本身不是权限沙箱。
- `lastGoalVersionSent` 只表示消息交给了输入队列，不表示模型已经读到或者 step 已经准入（CONTEXT-02 尚未完成）。恢复时会按 Session 历史和实时输入重新判断要不要补发。
- 邮件要等到目标 Session 里出现匹配的 `user/message` 历史、并且 checkpoint 成功持久化，才算 `delivered`；仅仅进入收件箱或者正在 claim 都不够。queued 邮件能在整个内核重建后重放，并按稳定身份去重。网络记录和 Session 是两个持久化边界，所以这不是分布式恰好一次执行，也不保证外部工具的副作用恰好发生一次。
- 忙流停止测试覆盖的是遵守 AbortSignal 的模型 adapter；忽略取消或者拒绝 dispose 的外部资源会被列入 straggler，无法保证已经退出。
- 子节点继承创建者**实际使用**的模型路由，并记录创建前的委派策略种子；恢复时按自身持久记录重建，不会向更宽松的节点重新继承。
- 发送者、投票者和入口身份都取自真实 live Agent，模型参数伪造不了；同伴消息也不会被当成人类授权。
- 一个普通入口 Session 在 MVP 阶段只启动一个网络。
- 节点步数预算覆盖 ATN 网络内的入口和工作节点；原生其他委派工具和用户可执行代码可能绕开这层调度。
- 用户硬停止、硬资源限制和进程崩溃不保证结清已承接的工作。

## 开发

```bash
npm install
npm run typecheck
npm test                       # 单元 + 内核集成 + UI 交互测试，不调用真实模型
npm run build
npm run pack:tarball
npm run smoke:profile          # 需要本机 dsh CLI；默认路径见脚本，可用 DSH_CLI 覆盖
npm run smoke:visualization    # 真实 Web profile 的观察接口、拓扑变化和浏览器包加载验证
```

单元和集成测试使用临时 Session 与工作区，目前是 434 项，另有 8 项 UI 交互测试。`smoke:profile` 需要 `DSH_CLI` 指向一个 `dsh` 启动器（默认是 DeepSeek Desktop 的 launcher），它会在临时 Harness home 的 Web profile 里安装真实 tarball，用确定性模型验证预设列表、Standard 隔离、ATN 工具调用和子节点同构能力。测试用随机本地端口，不打开浏览器、不调用付费模型；缺 CLI 会明确失败。这还不等于 PROFILE-03 的全链路验收。GitHub CI 在 Linux 和 Windows 上跑类型检查、测试、构建和打包，不跑依赖本机 CLI 的 smoke。

可视化部分另有 8 项客户端交互测试，隔离共享 Modal 组件，验证只有 ATN 预设显示入口、元数据更新、离开 ATN 后关闭面板，以及刷新、取消、切换会话、断线重试和节点选择。`smoke:visualization` 在真实 Web profile 里验证严格观察接口、运行中的工具、失败结果、重连和客户端包分发，不等于桌面窗口的渲染验收。

### 真实模型 pilot

```bash
npm run experiment:catalog              # 查询实时模型目录，不进行推理
npm run experiment:pilot                # 打印默认对照计划，不进行推理
npm run experiment:pilot -- --execute   # 使用已配置的 OPENCODE_API_KEY 执行
```

实验固定使用 Harness `0.2.0-rc.2` 和 `dsh-opencode-go@0.1.20`，默认跑 `shift-ledger-1`，比较禁止主动重连和允许自主重连的 ATN。任务族把信息分散到不同节点，中途注入修订信息和节点故障；网络至少 8 个节点、邻域至多 4 个，但 8 节点四邻居图的可达性约束很弱，不能据此认定该任务能测出拓扑收益。默认模型是 `deepseek-v4.1-flash`，每次 8 个 agent、全网 128 次可观测模型调用、每节点 16 步、每次 1536 输出 token、250,000 已观测 token 的准入阈值和 180 秒期限；`shift-ledger-2` 提供另一份阶段变化任务。

两种 ATN 使用相同的信息权限、阶段变化和故障条件。报告里的 `manipulation.valid` 检查这些实验条件是否真的发生过，通过只说明实验可解释，不代表拓扑带来了收益。显式指定 `--tasks ledger-reconciliation` 可以复现旧的共享输入任务；默认会恢复单 agent、独立候选合成、原生 Agent Teams 和两种 ATN 的五模式小规模对照。外部验收器只检查最终答案，不接受模型自报完成，也不参与挑选答案。凭据、预算和可重复性边界见[实验说明](docs/EXPERIMENT_PILOT.md)。

实验 provider 属于开发依赖；仓库根的 `overrides` 把它的预发布 peer 依赖固定到 Harness `0.2.0-rc.2`，不改动用户的全局安装或 profile。每批实验用新的结果目录并拒绝覆盖；提交时计量和清理后计量分别保留，未结任务、待投递邮件和活动节点状态独立于答案评分记录。

目前的结果记录：[拓扑测量改造后的验证（2026-10-05）](docs/TOPOLOGY_MEASUREMENT_RESULTS_2026-10-05.md) 是 6 次校准，DeepSeek V4.1 Flash 与免费 Space Bunny 各 2/2 通过，LongCat 2.5 Preview 两组都在 600 秒期限内没有交付；三个模型都没能通过主实验的校准准入。[Review 改造后的验证（2026-10-04）](docs/REVIEW_VALIDATION_2026-10-04.md) 观察到 13 次实际主动重连和 5 次节点预算退休，主实验答案通过 0/6。[免费模型与 Muse 实测](docs/PILOT_FREE_MUSE_RESULTS_2026-10-04.md) 和[更早的十次同资源上限运行](docs/PILOT_RESULTS_2026-10-04.md) 作为历史记录保留。这些数字都还不构成自适应收益证据。

### 仓库与发布文件

Git 保留源码、测试、文档、CI 和 lockfile；`.gitignore` 排除依赖、构建目录、tarball、测试报告、缓存、临时数据、上游参考检出、编辑器设置和本地凭据配置。已跟踪的文件不会因为新增忽略规则自动移除，提交前可以用 `git ls-files -ci --exclude-standard` 检查，正常应该没有输出。

npm 按 `package.json` 的 `files` 白名单发布，只有 `lib/`、`cordis.patch.yml`、README、LICENSE、NOTICE 和自动包含的 package.json。构建产物由 npm 分发，不需要提交到 Git；发布前用 `npm pack --dry-run --json` 检查清单。真实安装 smoke 可以通过 `ATN_INSTALL_SPEC=dsh-atn@0.3.1` 切换成 registry 包验证。

### 0.4.0 变更

- 模型看到六个工具和六行规则：`atn_start`、`atn_spawn`、`atn_send`、`atn_status`、`atn_board`、`atn_finish`。
- **破坏性变更：** `atn_feedback` 并入 `atn_status(review={...})`，`atn_rewire` 并入 `atn_status(rewire={peers})`，`atn_publish` 的知识发布并入 `atn_board(action="publish", ...)`；这三个旧工具名不再注册。白板写入必须提供 `key` 和 `expectedRevision`，发布还需 `body`。
- 固定上下文约减少 **34%**：可测性恢复阶段的 ATN 规则与工具 schema 从 10,843 降至 7,160 UTF-8 字节（-33.97%），后续精简至 7,060 字节。计量不含宿主其他提示、历史消息或提供商封装；真实平均输入 token 已稳定明显下降仍未证实。
- 持久化边级评分，换边后累计更新诊断；旧环转发任务的 fixed 可解性校准保留为历史流程。拓扑绑定任务按下面的结构性证明与 adaptive 能力准入。
- 显式链长、预算与默认关闭的自动推进；记录四个提交/正确布尔、固定字节和输入 token 分布，分开统计提交纪律失败。
- 增加有界白板、可配置出度和变化依赖链任务；使用免费模型与 DeepSeek V4.1 Flash 测试，效果以独立最终答案检查和完整通信计量判断。

### 0.4.0：拓扑绑定（2026-10-06）

实验显式启用 `topologyBinding=true`（CLI 为 `--topology-binding`），使用 revision 3 fixture。宿主在任务／邮件的原子 mutation 内只允许真实本地持有者返回精确事实；第三方转发明确失败，且不产生结算或邮件。白板仅传递规范化元数据，事实由直连 task/result 获取，固定环的自动补边也不能扩大事实可达性。各节点保持相同模型、六个 ATN 工具和权限；未修改生产默认值。

`npm run experiment:topology-proof` 纯计算重跑 fixture 证明。8 节点、出度 2、链长 2、seed 17/31/45/59/73 都需要两阶段共 4 条不同持有者直连边，固定环不可达；各 seed 的零模型自适应构造性参考均正确，最大 27/48 步。换边可发现性按成功尝试率判定（至少一次且 100%），零尝试、拦截、同列表和未结算分别记录；必要性由结构证明承担。

完整回归为 430 项 runtime／集成与 8 项 UI，零失败、零跳过，typecheck、build、pack、profile smoke 通过。真实 DeepSeek 首轮完整探针 3/5；串行等待和固定初始化确认修复后，在同一 48 步预算下独立五次探针 **4/5 两阶段正确，21 次换边尝试全部成功，拦截／同列表／未结算均为 0，最大 31/48 步（64.58%）**。所有原始 Session 与持久化数据核对通过，原 Desktop profile 哈希不变。未观察到真实 `evidence-not-owned` 拦截，第 4.5(2) 条未满足，四臂比较未执行，`mayInterpretTopology=false / causalClaim=false`。实际通过项、完整失败样本、修复前失败记录与未满足项见[本轮实施报告](docs/TOPOLOGY_BINDING_IMPLEMENTATION_REPORT.md)。LongCat 因历史能力不足排除，不与 DeepSeek 合并计数。此前按换边运行频次判定可发现性的结论已纠正，频次不再参与准入。

### 0.4.0：四臂比较实现与准入（2026-10-06）

按[四臂方案](docs/FOUR_ARM_COMPARISON_BRIEF.md)删除了以真实违规／拦截计数证明强制生效的准入条件。`npm run experiment:binding-reference` 在同一 ACL、fixture 和 48 步预算下，五个 seed 的构造性参考为 adaptive **5/5**、fixed **0/5**；分别取得 **4/4** 和 **0/4** 必需事实，入口分别使用 **27/48** 和 **10/48** 步，模型调用均为 0。[参考对照](experiments/results/four-arm-reference-20261006.json)与[结构证明](experiments/results/four-arm-proof-20261006.json)可离线核验。固定不可完成是任务设计的结构约束，不能作为自适应收益。

最终提交事实按精确所有者、请求时单向直连、实际 task/result 和提交前交付时间正向审计；失败样本保留，审计失败的运行不计入比较。历史 11 次真实绑定执行的 34 条事实通过[追溯审计](experiments/results/four-arm-historical-fact-flow-20261006.json)；新同源码 DeepSeek 五次独立探针为 **3/5 两阶段正确，18 次换边全部成功，最大 30/48 步（62.50%）**，五次 rawAudit 和 14 条已提交事实均通过。seed 31 第二阶段未提交、seed 73 两阶段未提交，均保留。第一载体退出后只续跑四个未执行 seed，未替换或重复样本。新探针低于 ≥4/5，四臂各 0 次，比较 rejected、余量与成本未测；旧源码 4/5 未借用，LongCat 排除，预算与生产默认值未提高。[准入与成本](experiments/results/four-arm-admission-and-cost-20261006.json)保留探针 371 次调用和完整失败成本；参考调用为 0，调用倍数未定义。其他成本倍数只表示协调开销，不是拓扑收益。实际通过项和未完成项见[实施报告](docs/FOUR_ARM_COMPARISON_IMPLEMENTATION_REPORT.md)，`mayInterpretTopology=false / causalClaim=false`。

434 项 runtime／集成 + 8 项 UI 测试、typecheck、build、pack 和 profile smoke 已实际通过；先前一次遥测快照与异步邮件投递竞争的失败输出已保留，测试通过显式等待投递修复，原断言保留。

### 0.3.1 变更

- 只修正这份 README 中关于 npm 标签的说明；功能与 0.3.0 相同。

### 0.3.0 变更

- 模型界面收敛为六个工具和九行共同规则：`atn_status` 合并发现、任务与原子认领，`atn_finish(scope="network")` 承接最终交付，治理与续期转为可选的宿主操作。
- 拓扑变为可自主调整：`atn_rewire` 原子替换自己的出边，不再需要宿主验收才能重连；失活邻居只在局部补位，显式空邻域保持为空。
- 新增「可视化ATN网络」入口，只读展示节点、连接、共享目标、任务和近期活动。
- 发现返回任务、带终态的近期结果和运行时遥测；重复 `query="*"` 轮转探索少量候选，节点可以复用同伴或跨分支连接。
- `atn_send` 的结果可以显式声明 `outcome="failed"`；下一次正常输入会附带局部连接变化，供节点自行决定重试、换人还是重连。
- 结果向请求者完整传递摘要和证据；子节点的初始任务与发件箱原子提交，目标 Session 持久接收后才确认投递；普通邮件满额后仍为已承接任务保留有界的结果回传空间。
- 引入每节点步数预算和孤儿任务的原子认领，保留任务依赖、重试关系与可选的宿主验收。
- 没有增加角色模板、中心规划模型或固定协作轮次；实际群体效果仍要用真实任务和 agent team 对照测量。

## 仓库内容

| 路径 | 内容 |
|---|---|
| `src/` | 正式运行时：领域记录、拓扑、任务、信箱、提案、生命周期、Cordis service、模型工具 |
| `tests/unit/` | 纯领域行为：拓扑推导、存储顺序、限额、信箱、全票审议、任务持有者、生命周期与恢复决策、配置边界校验 |
| `tests/integration/` | 真实 Harness 内核装配：模型工具调用驱动的创建/交付/审议路径、真实 storageDomain、注入时钟与持久重建，以及并发写入、退休释放、stop straggler、spawn 失败补偿、续期边界、恢复 goal context、effort 继承和稳定 message id 的专项测试 |
| `src/client/` / `tests/client/` | 原生会话头部入口、只读拓扑面板，以及刷新/取消/交互测试 |
| `tests/smoke/` | 真实 `dsh` profile 安装与启动验证 |
| `experiments/` | 真实模型 pilot：共同任务、独立验收器、模型目录、内核对照装配与实验计量；不随插件 npm 包发布 |
| `prototype/` | 早期一次性验证原型，**不是**正式实现，保留作对照 |
| `docs/` | 规格、验收清单、原型报告和[实施报告](docs/REPAIR_IMPLEMENTATION_REPORT.md)等历史记录；报告里的状态都是当时的，不代表当前版本 |

## License

[Apache-2.0](LICENSE)。本包不复制 DeepSeek Harness 源码，只使用其已发布包的公开 API；依赖及其许可证见 [NOTICE](NOTICE)。
