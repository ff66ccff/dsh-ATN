# dsh-ATN

dsh-ATN 是 DeepSeek Harness 的一个插件。装上之后，Harness 的「Agent 预设」里会多出一个 ATN 模式：一群能力相同的 agent 各自只看得到身边少数几个同伴，自己决定跟谁合作、把活分给谁，一起完成同一个目标。

这里没有中心调度，没有角色模板，也没有固定的协作轮次。运行时只负责持久化、投递、生命周期、额度和身份检查这些底层的事；连接和分工是节点自己的选择。

> **版本 0.3.2，开发者预览。** `npm i dsh-atn` 装到的就是它，安装时写明确版本号更好复现。
>
> 0.3.0 引入自适应拓扑：节点能在运行中自己换邻居，宿主验收不再是从一条边改到另一条边的前提。0.3.2 修复调度并发时显式 `tick()` 提前返回的问题，消除由此引起的 Windows CI 偶发失败。
>
> 需要说清楚的是，**目前还没有实验证据表明 ATN 比 Harness 自带的 agent team 更强**。已有的真实模型对照规模都很小，结果与边界见[实验说明](docs/EXPERIMENT_PILOT.md)和[自适应拓扑设计](docs/ADAPTIVE_TOPOLOGY.md)。

## 设计取向

- **同能力，独立个体。** 节点之间没有能力差别。出生关系只是谱系记录，不构成执行层级——创建者退出，后代不会被连带终止。
- **局部信息，按需发现。** 每个节点最多持有四个协作邻居，能看到它们的任务摘要、近期结果和负载。要找人就用 `atn_status` 查相关候选，或用 `query="*"` 做有界轮转探索。发现本身不会连边。
- **连接由自己换。** `atn_rewire(peers)` 用一次原子写替换自己的全部出边，可以跨出生分支去找人。边是单向的：A 选了 B，不强制 B 选 A。
- **退出只补位，不重排。** 同伴退出时，运行时沿着这个同伴已知的连接补上失活的槽位，不会全网重新挑一个「最优」节点，也不会主动填满空槽。节点显式设成 `[]` 的空邻域保持为空。
- **断边不影响旧任务。** 连接变了，已经在跑的任务照旧，结果仍只回给原请求者；双方可以带着同一个 `taskId` 继续讨论。
- **一份共享目标。** 所有节点读同一份目标、成功标准和共同约束，版本持久化在网络记录里。
- **模型只看到六个工具。** 发现和任务检查合并进 `atn_status`；提案、投票、续租这类治理动作保留为宿主 API，不占模型的工具列表。
- **反馈不额外花钱。** 运行时自己记录本地任务耗时、模型步数、失败与重试，等下一次真有输入进模型时捎带一条摘要，不单独唤醒节点，也不额外调用模型。
- **预算按节点算。** 每个节点有独立的步数预算，用完就退休。
- **没主的活可以认领。** `atn_status` 会列出失去有效持有者的孤儿任务，空闲节点可以原子认领，并保留原来的尝试与重试关系。
- **退休分两步。** 先停止接新活（`draining`），结清手上的旧任务和旧投票之后才真正释放（`retired`）。

## 安装

需要已安装的 DeepSeek Harness `0.2.0-rc.2`、Node.js 24，以及可用的模型配置。先确认 `dsh --version` 能正常输出。

### 从 npm 安装

```bash
dsh plugin --profile web add dsh-atn@0.3.2
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

### 从源码构建

```bash
git clone https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN
npm ci
npm run build
npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.3.2.tgz
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
atn_rewire(peers=["node-2", "node-3"])
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
| `atn_status` | 可选 `query`、`taskIds`、`claimTaskId` | 合并返回当前邻居、候选、任务结果、遥测、剩余预算与孤儿任务；`query="*"` 轮转有界候选。空闲节点可用 `claimTaskId` 原子认领孤儿任务，并发认领只有一个能成功 |
| `atn_rewire` | 完整 `peers` 数组 | 原子替换至多四个出边，不需要审批或验收证据。每次有效调用（包括不改变连接的那种）都会持久记录，运行时再补充后续观测；观测不等于因果收益证明 |
| `atn_finish` | 可选 `scope=node\|network`；`network` 另需 `summary`、`goalVersion` | 默认只让请求节点退休，不代表任务完成。入口以 `scope=network` 提交最终摘要和证据；仍会检查任务、邮件、提案和目标版本是否结清 |

模型不再暴露 `atn_tasks`、`atn_peers`、`atn_renew`、`atn_propose`、`atn_vote`、`atn_deliver`。宿主侧的 `tasks`、`peers`、`renew`、`propose`、`vote`、`deliver` API 保留，供检查、恢复和管理调用。最终交付必须显式写 `scope=network`；只传摘要不会意外触发节点退休。

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

新节点从创建者和创建者当前的同伴开始协作；创建者还有空位时会把新节点加进自己的列表，满槽则保留已有选择。第一个**成功发布**的子节点仍会记进 `selectedChildId`，仅供追溯。并发创建和重连都由原子网络更新裁决。

`atn_rewire` 可以直接选到发现出来的其他分支节点。无效选择会让整次调用失败，不会留下半张拓扑。某个邻居进入 `draining`、`retired` 或 `failed` 时，运行时只沿着它已知的连接找 active 节点补上那个失活槽位，其他有效选择保持不变；实在没有候选就留空。空槽和出生谱系都不会让已删除的连接自动回来，不过失活同伴的局部补位仍可能选到以前合作过的节点。显式 `[]` 会一直保持为空。

下一次实际收件箱输入获准进入模型时，运行时会附上局部连接变化和遥测摘要：第一次说明当前邻居，之后把同伴退出、自动补位和主动重连合并成相对上次已持久记录的 Session 快照的差异。摘要只涉及该网络里自己那几个有界邻居；中间变化会合并成最终差异，没有变化就不重复附加，也不会单独唤醒节点。快照跟着正常输入保存，重启后继续比较，不需要维护临时拓扑事件队列。耗时、步数、失败、重试和下游失败都来自运行时观察，不要求安装 `verifyTask`；宿主验收另行记录，自报完成或者成本低都不构成正确性证明。

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

单元和集成测试使用临时 Session 与工作区，目前是 315 项，另有 8 项 UI 交互测试。`smoke:profile` 需要 `DSH_CLI` 指向一个 `dsh` 启动器（默认是 DeepSeek Desktop 的 launcher），它会在临时 Harness home 的 Web profile 里安装真实 tarball，用确定性模型验证预设列表、Standard 隔离、ATN 工具调用和子节点同构能力。测试用随机本地端口，不打开浏览器、不调用付费模型；缺 CLI 会明确失败。这还不等于 PROFILE-03 的全链路验收。GitHub CI 在 Linux 和 Windows 上跑类型检查、测试、构建和打包，不跑依赖本机 CLI 的 smoke。

可视化部分另有 8 项客户端交互测试，隔离共享 Modal 组件，验证只有 ATN 预设显示入口、元数据更新、离开 ATN 后关闭面板，以及刷新、取消、切换会话、断线重试和节点选择。`smoke:visualization` 在真实 Web profile 里验证严格观察接口、运行中的工具、失败结果、重连和客户端包分发，不等于桌面窗口的渲染验收。

### 真实模型 pilot

```bash
npm run experiment:catalog              # 查询实时模型目录，不进行推理
npm run experiment:pilot                # 打印默认对照计划，不进行推理
npm run experiment:pilot -- --execute   # 使用已配置的 OPENCODE_API_KEY 执行
```

实验固定使用 Harness `0.2.0-rc.2` 和 `dsh-opencode-go@0.1.20`，默认跑 `shift-ledger-1`，比较禁止主动重连和允许自主重连的 ATN。任务族把信息分散到不同节点，中途注入修订信息和节点故障；网络至少 8 个节点、邻域至多 4 个，连接因此成为真实约束。默认模型是 `deepseek-v4.1-flash`，每次 8 个 agent、全网 128 次可观测模型调用、每节点 16 步、每次 1536 输出 token、250,000 已观测 token 的准入阈值和 180 秒期限；`shift-ledger-2` 提供另一份阶段变化任务。

两种 ATN 使用相同的信息权限、阶段变化和故障条件。报告里的 `manipulation.valid` 检查这些实验条件是否真的发生过，通过只说明实验可解释，不代表拓扑带来了收益。显式指定 `--tasks ledger-reconciliation` 可以复现旧的共享输入任务；默认会恢复单 agent、独立候选合成、原生 Agent Teams 和两种 ATN 的五模式小规模对照。外部验收器只检查最终答案，不接受模型自报完成，也不参与挑选答案。凭据、预算和可重复性边界见[实验说明](docs/EXPERIMENT_PILOT.md)。

实验 provider 属于开发依赖；仓库根的 `overrides` 把它的预发布 peer 依赖固定到 Harness `0.2.0-rc.2`，不改动用户的全局安装或 profile。每批实验用新的结果目录并拒绝覆盖；提交时计量和清理后计量分别保留，未结任务、待投递邮件和活动节点状态独立于答案评分记录。

目前的结果记录：[拓扑测量改造后的验证（2026-10-05）](docs/TOPOLOGY_MEASUREMENT_RESULTS_2026-10-05.md) 是 6 次校准，DeepSeek V4.1 Flash 与免费 Space Bunny 各 2/2 通过，LongCat 2.5 Preview 两组都在 600 秒期限内没有交付；三个模型都没能通过主实验的校准准入。[Review 改造后的验证（2026-10-04）](docs/REVIEW_VALIDATION_2026-10-04.md) 观察到 13 次实际主动重连和 5 次节点预算退休，主实验答案通过 0/6。[免费模型与 Muse 实测](docs/PILOT_FREE_MUSE_RESULTS_2026-10-04.md) 和[更早的十次同资源上限运行](docs/PILOT_RESULTS_2026-10-04.md) 作为历史记录保留。这些数字都还不构成自适应收益证据。

### 仓库与发布文件

Git 保留源码、测试、文档、CI 和 lockfile；`.gitignore` 排除依赖、构建目录、tarball、测试报告、缓存、临时数据、上游参考检出、编辑器设置和本地凭据配置。已跟踪的文件不会因为新增忽略规则自动移除，提交前可以用 `git ls-files -ci --exclude-standard` 检查，正常应该没有输出。

npm 按 `package.json` 的 `files` 白名单发布，只有 `lib/`、`cordis.patch.yml`、README、LICENSE、NOTICE 和自动包含的 package.json。构建产物由 npm 分发，不需要提交到 Git；发布前用 `npm pack --dry-run --json` 检查清单。真实安装 smoke 可以通过 `ATN_INSTALL_SPEC=dsh-atn@0.3.1` 切换成 registry 包验证。

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
