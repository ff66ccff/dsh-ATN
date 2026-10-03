# dsh-ATN

面向 **DeepSeek Harness** 的自适应拓扑网络插件，在 **“Agent 预设”页以独立的 ATN 模式**出现：让同能力、独立执行的 agent，通过局部信息和按需协作完成共同目标。

> **当前版本：0.2.0 开发者预览版，npm 标签 `next`。**
> 已通过 139 项测试，以及真实 Web profile 的 tarball 安装、ATN 预设注册、工具隔离和模型工具调用创建子节点检查。完整验收仍未完成：受限权限执行路径（AUTH-01/02/03）和 PROFILE-03 的完整消息、投票、退休与交付链路仍待验证，见[实施与验证记录](https://github.com/ff66ccff/dsh-ATN/blob/v0.2.0/docs/REPAIR_IMPLEMENTATION_REPORT.md)。

## 核心设计

- **同能力、独立个体**：出生关系不构成执行层级，创建者退出不会默认终止后代。
- **局部信息、按需发现**：节点只持有自己的任务、必要上下文和最多四个邻居。
- **四个邻居位置**：向上沿 `creator_id`、向下沿 `selected_child` 各取最近两个 `active` 节点；路径尽头留空，不跨分支补位，邻域不保证对称。
- **自动向外补位**：节点进入 `draining` 后离开当前拓扑，沿既有路径连接更外层节点，出生记录不变。
- **持久共享目标**：所有节点读取同一份简短目标、成功标准和共同约束，版本持久化在网络记录里。
- **全体邻居同意**：提案在创建时固定基础版本、正文和审批名单；必须得到该名单全体明确同意，多数票、沉默和超时都不通过。
- **分阶段退休**：完成局部任务后等待新任务；决定退休时不接新工作，但继续结清旧任务和旧审议后才释放。

运行时负责持久化、投递、生命周期、额度和身份检查，不充当决定分工的中心 LLM。

## 安装与启用

### 从 npm 安装

需要已安装的 **DeepSeek Harness `0.2.0-rc.2`**、Node.js 24，以及可用的模型配置。先确认 `dsh --version` 能正常运行，然后执行：

```bash
dsh plugin --profile web add dsh-atn@0.2.0
dsh --profile web --dump-config
```

输出应包含宿主服务 `atn`、预设声明 `preset-atn`，以及该预设内部的 `atn-tools`。桌面端若使用其他 profile，将 `web` 换成桌面端实际运行的 profile 名称。安装后重新启动该 profile。

1. 打开 **设置 → Agent 预设 → 自定义 → ATN**，可查看它的插件组成，并点击“设为新任务默认”。
2. 新建任务；开启 Harness 的“开发者工具”时，也可在新任务页的预设选择器里直接选择 **ATN**。
3. 输入任务，例如“核对当前项目 README，拆分给节点核查并汇总证据”。ATN 提示词会引导入口模型先调用 `atn_start`，再按需创建节点；用户不必手写工具调用。

安装不会自动切换默认模式。Standard、PTC、Minimal 和 Creator 等已有模式不增加 ATN 工具或提示词；已经开始的任务保持其原有预设。仅选择 ATN 或发送问候也不会由插件自动创建网络，网络仍由模型调用 `atn_start` 创建。

也可安装 [npm 包 dsh-atn](https://www.npmjs.com/package/dsh-atn) 的 `next` 标签，但固定 `0.2.0` 更便于复现。预览版沿用 `next` 发布，不自动移动原有 `latest` 标签，请明确指定版本或标签。

### 从 0.1.0 升级

`0.1.0` 将 ATN 工具全局加载；`0.2.0` 默认将它们放入独立 ATN 预设。对实际使用的 Web/桌面 profile 执行上述安装命令，重启后选择 ATN 并新建任务。仅升级旧 `headless` profile 不会得到独立模式。已有会话不会自动迁移；升级前先完成或停止旧版本的网络。

### 从源码构建

```bash
git clone --branch v0.2.0 https://github.com/ff66ccff/dsh-ATN.git
cd dsh-ATN
npm ci
npm run build
npm run pack:tarball
dsh plugin --profile web add ./.artifacts/dsh-atn-0.2.0.tgz
```

直接用 `dsh plugin add github:...` 安装的构建流程尚未验证，推荐 npm 包或构建后的 tarball。

### 前置服务

独立模式面向完整的 Harness Web/桌面 profile，需要 `agentPresets` 注册表、`systemPrompt`、`agents`、`tools`、`sessions`，以及 `storageDomain` 和 KV backend（例如 `@deepseek-ai/dsh-storage-json`）。预设复用宿主提供的 persona、工作区指令、文件/搜索、终端、技能、询问用户、待办、Web、展示和上下文压缩插件。缺少依赖时预设会显示不可用；缺少存储时 `atn_start` 会以 `storage-unavailable` 明确失败。

Bundle 只新增 `atn` 和 `preset-atn` 两条宿主行；九个 ATN 工具和共同规则属于预设作用域。运行时由宿主统一持有，节点加入创建者正在使用的同一预设版本，并记录 preset ID 和工作目录。冷恢复按节点自己记录的 preset ID 挂载当前定义；预设缺失或不可用时明确失败，不改用当前默认模式。

不带预设注册表的 `headless` profile 不会提供这个模式。自定义嵌入式装配仍可显式加载 `dsh-atn` 和 `dsh-atn/tools`，但这是全局工具装配，不是本插件默认的安装入口。

## 最小使用例

在选择了 **ATN** 的新 Session 中，模型可使用以下工具（此处展示底层协议）：

```text
atn_start(objective="把 docs/x.md 的结论核对清楚", successCriteria="每条结论都有可复查来源", constraints="不要访问付费模型")
atn_spawn(task="核对第 2 节的三条来源", context="x.md 第 2 节")
atn_peers()
atn_send(to="node-3", kind="task", body="补充核对第 3 节")
atn_send(to="node-3", kind="result", taskId="task-4", body="完成", summary="3 节已核对", evidence=["docs/x.md:40-58"])
atn_finish(reason="本地工作已交回")
```

只有 `atn_start` 会创建网络；安装插件本身不会自动运行任何蜂群，其他 Session 不会产生 ATN 状态或额外模型请求。

## 工具语义

| 工具 | 必要输入 | 语义 |
|---|---|---|
| `atn_start` | 目标、成功标准、共同约束 | 在当前 ATN Session 初始化网络，建立初始任务，返回网络/节点/任务标识；不生成额外主管 |
| `atn_spawn` | 局部任务、上下文、可选寿命 | 创建同能力独立节点；id 由运行时分配，显示名称不是授权凭据 |
| `atn_send` | 目标、类型、正文；`result` 另需任务标识、摘要、证据；可选稳定 `messageId` | `task` / `note` / `result`；发送者取自真实调用者，`result` 只能结清自己持有的匹配任务。带 `messageId` 的重试幂等：同一业务消息不会产生第二封邮件、第二个任务或第二次结算；同一 id 配上不同发送者、目标或内容则被明确拒绝 |
| `atn_peers` | 可选查询 | 默认返回当前四个邻居及有界摘要；查询只给少量候选，不改变审批名单 |
| `atn_finish` | 可选说明 | 请求正常退休，不立即销毁，也不等于任何任务完成 |
| `atn_propose` | 完整替换正文、理由 | 建立不可变提案并固定当前有效邻居为审批名单 |
| `atn_vote` | 提案标识、明确赞成/反对 | 按固定名单和真实调用者授权；同票重试幂等，不一致的改票被拒绝 |
| `atn_renew` | 请求时长、**自己仍持有的 open `taskId`** | 必须在同一临界区内核验：网络 open、节点 `active`/`draining`、任务存在且由调用者持有且仍 open、时长在网络额度与期限内。没有 open 任务的节点不能续期 |
| `atn_deliver` | 摘要、证据、目标版本 | 入口节点面向用户的最终交付；机械门槛不满足时拒绝完成 |

一位节点也可以让出既有义务：`draining` 节点仍可提交自己旧任务的 `result`、投出已分配给自己的旧票、发送普通通知，但不能再发起新的 `task`，也不能接收新任务。

入口 Agent 是宿主所有：插件卸载或网络完成都不会 `dispose` 它。

## 四邻居与正常退出

向上沿出生链、向下沿 `selected_child` 链各取最近两个 `active` 节点；`provisioning`、`draining`、`retired` 和明确失败都会被跳过，但出生和分支记录永远保留。路径尽头留空，不跳到兄弟分支；循环或断裂的谱系会明确报错，而不是悄悄换一张图。

第一个**成功发布**的子节点才占用 `selected_child`；创建失败不占位。并发创建由同一次原子网络更新裁决。

退出分两段：`draining` 不接新任务和新提案，但继续接受自己旧任务的结果、并投出已分配给自己的旧票；旧任务与旧审议结清后由调度器自动转为 `retired` 并释放 handle。已投票的节点不必等其他人投票。

## 文档全票更新

`atn_propose` 提交时一次性固定基础版本、替换正文和有效邻居（提案者不是自己的审批者，至少需要一个审批者）。任一反对直接 `rejected`；沉默和超过截止时间不通过（`expired`）；提交时若当前版本已变则 `stale`；网络在最后一票前关闭则 `cancelled`。修改内容或基于新版本重提都需要新的投票，旧票不被继承。旧提案只按冻结名单授权：已经离开当前邻域的节点仍可投旧票，补位者不能投新提案。

## 停止

宿主级硬停止是运行时的普通方法，不需要模型配合：

```ts
await ctx.atn.stop(networkId, '用户要求停止')
```

它先持久关闭新工作入口、结算未完成提案与开放任务，再取消并等待所有 ATN 持有的 handle 释放，返回 `{ released, stragglers, stragglerDetails, reason }`。`released` 只包含**确认 `dispose()` 成功**的节点；`failed` 与 `timed-out` 都留在 `stragglers` 里并给出可诊断原因，超时后仍可继续追踪，后续 settle 只更新状态、不改写已经返回的报告。停止是持久终态：重启、续期、重发投递和迟到票都不会恢复该网络；重复调用 `stop` 幂等。**本版没有提供 CLI 子命令**，停止入口是 `ctx.atn.stop(...)` 这一宿主方法。

## 配置

所有可变参数都在 Cordis Config 里，安装后可在 profile 的 `cordis.patch.yml` 覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `maxResidentNodes` | 8 | 驻留工作节点；`provisioning`/`draining` 仍占槽 |
| `maxTotalNodes` | 32 | 每网络累计节点；释放槽位不重置 |
| `maxTasks` / `maxProposals` | 256 / 64 | 累计正式任务与提案 |
| `maxPendingMailPerNode` / `maxRetainedMail` | 64 / 1024 | 待发与累计保留邮件 |
| `maxMessageBytes` / `maxDocumentBytes` | 8192 | 单条消息（含 envelope）与目标正文的 UTF-8 上限 |
| `defaultLeaseMs` / `maxLeaseExtensionMs` | 5 / 30 分钟 | 默认租约与单次续期上限 |
| `networkDeadlineMs` / `proposalDeadlineMs` | 60 / 2 分钟 | 网络硬期限与提案期限 |
| `stepBudget` | 4096 | **admitted step 预算**：只统计本运行时为 ATN 持有节点准入的模型步 |
| `domainName` | `atn_networks` | 持久域名称 |

`stepBudget` **不是** HTTP 请求数、token 预算或费用上限：它不覆盖 provider 重试、辅助模型调用，也不约束宿主所有的其他 Agent 或用户自己写的代码。

配置在插件加载时校验，而不是等到第一次写入才失败：每个计数和时长必须是**正整数**（`0`、负数、小数和非数字都拒绝），`domainName` 必须匹配 `[a-z][a-z0-9_]*`，字段之间的关系（例如 `maxTotalNodes >= maxResidentNodes`、`proposalDeadlineMs <= networkDeadlineMs`）也在同一次校验里检查。

## 并发与生命周期一致性

网络记录是唯一的原子持久化单元，所有网络写操作都经过**按 `networkId` 串行的 mutation 队列**：读取、额度检查、id 分配、业务变换和 `store.update` 都在同一个临界区内完成，`store.update` 的回调只使用传入的最新记录，绝不基于调用前的旧快照写回。并发 spawn、send、proposal、vote 和 step admission 因此不会丢节点、任务、邮件、票或预算。

- **创建三合一**：`atn_spawn` 先持久化 `provisioning/pending` 意图，创建 Agent 成功后在**一次 mutation** 中同时完成发布、`selected_child` 占用和初始任务创建。额度不足会在创建 Agent 之前拒绝；发布后失败会标记节点及其未结任务为 `failed`，启动 handle 释放并保留失败原因；释放失败或超时会继续保留 handle 的跟踪记录，不会留下 active 却无任务的节点。
- **退休才释放**：`draining` 节点结清旧任务与旧票后由调度器转为 `retired`，并在同一次调度里启动其 ATN-owned handle 的释放，只有 dispose 确认成功才移除所有权记录；`retired`/`failed` 节点不再获得模型步，`draining` 只允许处理已有义务。入口 Agent 永远由宿主所有，完成、停止和退休都不会 `dispose` 它。
- **路由完整继承**：子节点记录并继承创建者实际请求的 provider/model/**reasoningEffort**，恢复时使用持久化的 effort，不回退到 profile 默认值。
- **恢复补发 goal context**：goal 提交会持久保留可重放的当前 revision；提交时没有 live Agent 的节点不会被标记为已同步，`recover()` resume 后按其 session 幂等补写当前 revision 的 goal snapshot。

## 数据位置

网络记录放在 `storageDomain` 的 `atn_networks` 域里（`single` 布局，一个网络记录一次原子更新），由 profile 选择的后端决定物理位置；使用 `dsh-storage-json` 时是 backend `root` 下的一个 JSON 文档。节点上下文是真实的 Harness Session（`sessionId` 记录在节点上）。ATN 不读写用户工作目录里可覆盖的 JSON 文件，也不把普通 Markdown 当作唯一授权来源。

## 兼容与安全边界

- 已验证基线：Harness `0.2.0-rc.2`、Cordis `4.0.4`、Node.js 24。Harness 仍在开发者预览阶段，不承诺未来版本兼容。
- 单进程、单执行环境：不实现多机或多进程共享网络，也不能同时启动两个运行时写同一份存储。
- 尚未验证受限 permission/sandbox 策略在真实执行路径上的拒绝行为（AUTH-01/02/03）。Agent preset 同构绑定、旧版本继承和冷恢复已覆盖，但 preset 本身不构成权限沙箱。
- `lastGoalVersionSent` 表示消息交给了输入队列，不表示模型已读取或 step 已准入（CONTEXT-02 尚未完成）。恢复会根据 Session 历史与实时输入重新判断是否需要补发。
- JSONL Session 历史中已落地的邮件可在整内核重建后去重；硬崩溃时尚未持久写入的 inbox 不提供跨存储的恰好一次保证。
- 忙流停止测试覆盖遵守 AbortSignal 的模型 adapter；忽略取消或拒绝 dispose 的外部资源会被列入 straggler，无法保证已经退出。
- 子节点继承创建者**实际使用**的模型路由，并记录创建前的委派策略种子；恢复时按自身持久记录重建，不向更宽松的节点重新继承。
- 发送者、投票者和入口身份都取自真实 live Agent，模型参数无法伪造；同伴消息不会被当成人类授权。
- 一个普通入口 Session 在 MVP 中只启动一个网络。
- 网络额度只对 ATN 持有的节点负责；原生其他委派工具和可执行用户代码可能绕开这层调度。
- 用户硬停止、硬资源限制和进程崩溃不保证结清已承接的工作。

## 开发

```bash
npm install
npm run typecheck
npm test                       # 单元 + 内核集成测试，确定性 adapter，无真实模型调用
npm run build
npm run pack:tarball
npm run smoke:profile          # 需要本机 dsh CLI；默认路径见脚本，可用 DSH_CLI 覆盖
```

单元和集成测试使用临时 Session 与工作区。`smoke:profile` 需要 `DSH_CLI` 指向一个 `dsh` 启动器（默认是 DeepSeek Desktop 的 launcher），在临时 Harness home 的 Web profile 中安装真实 tarball，并使用确定性模型验证预设列表、Standard 隔离、ATN 工具调用和子节点同构能力。测试使用随机本地端口、不打开浏览器、不调用付费模型；缺少 CLI 会明确失败。这尚不等于 PROFILE-03 的全链路验收。GitHub CI 在 Linux 和 Windows 上运行类型检查、测试、构建与打包，不自动执行依赖本机 CLI 的 smoke。

### 仓库与发布文件

Git 保留源码、测试、文档、CI 和 lockfile；`.gitignore` 排除依赖、构建目录、tarball、测试报告、缓存、临时数据、上游参考检出、编辑器设置及本地凭据配置。已跟踪文件不会因为新增忽略规则自动移除，提交前可用 `git ls-files -ci --exclude-standard` 检查；正常应无输出。

npm 使用 `package.json` 的 `files` 白名单，仅发布 `lib/`、`cordis.patch.yml`、README、许可证、NOTICE 和自动包含的 package.json。构建产物由 npm 分发，无需提交到 Git；发布前使用 `npm pack --dry-run --json` 检查清单。真实安装 smoke 可通过 `ATN_INSTALL_SPEC=dsh-atn@0.2.0` 切换为 registry 包验证。

### 0.2.0 变更

- 新增“Agent 预设 → 自定义 → ATN”模式，包含基础工作工具、九个 ATN 工具和模式提示词；其他预设保持隔离。
- 创建节点继承实际使用的预设版本和工作目录；冷恢复按持久 preset ID 挂载，缺失时明确失败。
- 新增六项预设集成测试及完整 Web profile 的模式 smoke；补充忽略规则、升级说明和发布文件范围。

## 仓库内容

| 路径 | 内容 |
|---|---|
| `src/` | 正式运行时：领域记录、拓扑、任务、信箱、提案、生命周期、Cordis service、模型工具 |
| `tests/unit/` | 纯领域行为：拓扑推导、存储顺序、限额、信箱、全票审议、任务持有者、生命周期与恢复决策、配置边界校验 |
| `tests/integration/` | 真实 Harness 内核装配：模型工具调用驱动的创建/交付/审议路径、真实 storageDomain、注入时钟与持久重建，以及并发写入、退休释放、stop straggler、spawn 失败补偿、续期边界、恢复 goal context、effort 继承和稳定 message id 的专项测试 |
| `tests/smoke/` | 真实 `dsh` profile 安装与启动验证 |
| `prototype/` | 早期一次性验证原型，**不是**正式实现，保留作对照 |
| `docs/` | 规格、验收清单、原型报告与[实施报告](https://github.com/ff66ccff/dsh-ATN/blob/v0.2.0/docs/REPAIR_IMPLEMENTATION_REPORT.md)；历史报告中的当时状态不代表当前版本 |

## License

[Apache-2.0](LICENSE)。本包不复制 DeepSeek Harness 源码，只使用其已发布包的公开 API；依赖及其许可证见 [NOTICE](NOTICE)。
