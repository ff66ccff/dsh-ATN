# 分布式拓扑实验与协议冒烟测试

默认实验现在比较 `atn-no-rewire` 与 `atn-adaptive`：8 个节点、每节点独占证据、阶段更新和确定性的节点失效。原有三个短任务保留为五种 Harness 装配的协议冒烟测试；它们不用于证明拓扑收益。本文说明运行方法，实际结果见 [Review 改造后真实模型验证](REVIEW_VALIDATION_2026-10-04.md)：两个免费模型与 DeepSeek V4.1 Flash 共运行 8 次，已观察到主动重连和预算退休，唯一答案通过的是扩大 token 阈值后的禁重连对照。尚无自适应收益证据。

此前短任务的执行结果见[免费模型与 Muse 实测](PILOT_FREE_MUSE_RESULTS_2026-10-04.md)及[原 v2 报告](PILOT_RESULTS_2026-10-04.md)。这些历史结果不能移用于新的分布式任务。

## 分布式任务族与干预有效性

`shift-ledger-1` 和 `shift-ledger-2` 是同一任务族的两组确定性输入。每组有 8–16 个证据分片，每片含 12 条初始交易和第二阶段更正。入口也只拥有一个分片，公共提示词不含交易正文；`read_document` 根据实际调用 agent 的会话身份检查权限。`id="mine"` 返回当前节点可读取的文档 id，猜测其他分片的 id 不能越权读取。

宿主在任何模型请求发往 provider 前创建所有节点，并设置相同的环形初始图：每个节点连接环上前后各两个节点。N=8 时度数为 4，小于潜在同伴数 7，且入口可达所有节点。初始图属于两组共享的实验设置，不计为主动重连；出生连接本身可能在祖先槽位填满后产生从入口不可达的分支，所以不能只凭 N≥8 假定实验图有效。

所有初始分片均被原持有者读取后，宿主触发第二阶段：使最后一个 worker 真正失败并释放其运行句柄，将它的初始证据及更正备份转交 slot 1，向存活节点发送仅含阶段和故障通知的公开消息，并按原权限分别释放每个分片的更正。更正会删交易、调整账户并追加交易，旧汇总因此失效。模型自行选择协作、汇总和重连策略，宿主不提供分工脚本或中间正确答案。此触发点由逻辑读进度定义，不使用容易受模型速度影响的固定墙钟时间。

两组必须使用相同 `taskSha256`、节点数量、初始图、故障/备份槽位、阶段规则和预算。默认每节点 16 步，包括入口；`--calls` 仍是所有节点共享的模型调用安全上限，并不替代每节点预算。`atn-no-rewire` 仅禁主动重连，失活邻居修复仍保留，因此它不是完全静止的图。

`report.json.manipulation` 单独记录初始图节点数、最大/最小度数、入口可达数、初始分片读取数及更正读取数。`checks` 检查节点规模充足、图稀疏且可达、信息确实分散读取、阶段变化发生、故障注入时 worker 仍活跃且确实失败；这些检查决定 `valid`。`outcomeChecks` 另行记录更正全部读取和失效分片备份恢复，它们是性能结果，不参与干预有效性，恢复失败不能据此被排除。所有尝试都必须保留并进入两组总体结果，包括未推进至第二阶段的困难失败；可以分层描述有效干预样本，但不能筛掉失败后宣称更高成功率。`valid` 与最终答案验收彼此独立，都不作因果收益声明。

```bash
# 默认计划：两种 ATN 模式、8 节点、每节点 16 步、全网至多 128 次调用
npm run experiment:pilot
# 两个任务变体；加 --execute 才会发起真实推理
npm run experiment:pilot -- --tasks shift-ledger-1,shift-ledger-2 --agents 8 --node-steps 16 --calls 128
# 旧短任务仍可用于五种模式的协议冒烟测试
npm run experiment:pilot -- --tasks ledger-reconciliation
```

宿主输入与 ACL 在 `experiments/topology-task.ts`，初始化/故障通知在 `experiments/topology-host.ts`，独立最终验收在 `experiments/topology-evaluation.ts`。单元测试检查越权、阶段门槛、备份权限、操控有效性和错误答案；真实 Harness 内核的确定性测试对两种 ATN 装配运行相同的八节点初始化、失败、证据恢复及最终验收，不调用外部模型。

## 对照模式与任务

| `--modes` 值 | 实际装配 |
|---|---|
| `single` | 单个 Agent；共同证据读取和最终提交工具 |
| `independent-pool` | `maxAgents - 1` 个互不通信的独立候选，加 1 个入口核对与合成答案 |
| `native-team` | Harness 原生 Team 服务与工具，保留成员创建、fresh/fork、同伴消息、共享任务板和等待能力 |
| `atn-no-rewire` | 正式 ATN 运行时，拒绝主动 `atn_rewire`；出生连接和失活邻居修复仍保留 |
| `atn-adaptive` | 正式 ATN 运行时，允许模型主动重连 |

`independent-pool` 的候选各自看到原题和共同证据，不看到彼此输出。入口看到候选的最终文本，自行对照原题核查并形成一次最终提交。候选求解及入口合成的调用、token 和耗时全部计入本次运行的共同预算；oracle 只在提交后评分，不以正确答案挑选最佳候选，不构成知道标准答案的 best-of-N。默认 3 个 agent 对应 2 个独立候选和 1 个入口。

此模式要求 `calls >= agents`。每个候选最多调用 `floor((calls - 1) / (agents - 1))` 次，为入口至少保留一次合成调用；默认 16 次总调用、3 个 agent 时，每个候选最多 7 次。候选达到自己的上限只结束该候选，不取消其他候选或入口。入口仍受剩余总调用量、token 观测阈值和运行期限约束，因此保留调用额度不等于保证合成成功。

`atn-no-rewire` 是“禁主动重连”消融，并不是一张永不变化的固定图。原生 Team 的启动指令明确授权使用 Agent Teams；Team 和 ATN 自行选择是否分工、如何交流和如何解题，没有预先指定成员角色、消息脚本或正确答案。独立候选基线的隔离与合成步骤属于该对照的定义，不约束其他模式的协作策略。

| `--tasks` 值 | 客观验收内容 |
|---|---|
| `shift-ledger-1` / `shift-ledger-2` | 分布式交易分片在更正、节点失败和备份转移后的最终四账户余额；仅 ATN 模式 |
| `ledger-reconciliation` | 合并订单、更正和事件，处理重复记录、退款与时间边界 |
| `release-candidate` | 联合检查主机配置、探测与审批，执行到期边界和选择规则 |
| `boundary-diagnosis` | 根据契约与案例识别代码的两个边界错误，给出所需运算符和各案例结果 |

旧短任务输入由 `experiments/tasks.ts` 提供；答案 oracle 只在宿主侧的 `experiments/evaluation.ts`。这些冒烟任务的模型仍能读取相同的题目文档；分布式任务使用前述独立 ACL。所有任务都没有 shell、文件系统、网络或环境读取工具，不能读取 oracle、测试文件或凭据。初始入口/Lead 通过 `submit_answer` 或最终文本回答提供 JSON 产物；Team/ATN 子节点通过原生协作工具返回发现，独立候选由宿主转交最终文本。运行结束后才评分，不向模型反馈验收答案以供重试。

最终文本提取只接受本次运行中最新轮次正常结束、其最终 step 以 `finish=stop` 结束的可见文本。截断、失败、旧轮次内容和纯 reasoning 不作为提交，不回退搜寻较早的“看起来像答案”的片段。独立候选使用同样的提取规则；无有效候选文本时记录为空，不用 oracle 补答案。

`evaluation.passed` 要求全部事实检查和输出结构通过；`score` 是事实检查通过比例。`completed`、Team 任务状态或 ATN 网络状态单独记录为协议观察，不能替代外部验收；提交正确答案也不自动证明全部协作义务已结清。

## 运行

需要 Node.js 24 和当前源码的 lockfile 依赖。实验固定 Harness `0.2.0-rc.2`、`dsh-opencode-go@0.1.20`，通过真实 Harness 内核与 provider 插件调用模型；不依赖桌面 UI 或 CLI profile，也不会改写已有 profile。`dsh-opencode-go` 是本仓库的开发依赖，其预发布 peer 依赖由仓库根 `package.json` 的 `overrides` 固定到 Harness `0.2.0-rc.2`，并由 lockfile 复现；这不会更改用户全局安装或现有 profile。

```bash
npm ci
npm run experiment:catalog
npm run experiment:pilot
```

前两个实验命令会查询实时网关目录及价格元数据；没有 `--execute` 时不发起模型推理。按本轮用户授权，仅允许目录实时确认免费的模型，以及精确 id `deepseek-v4.1-flash`，默认 `space-bunny-free`；CLI 选择与直接 `runPilot` 均检查该范围。Muse 和其他付费路由不在当前执行范围。目录免费标记不保证账户仍有额度，也不保证服务端接受请求；目录或价格元数据无法实时确认时停止选择，不用缓存猜测。历史批次的模型授权与结果保留在对应报告中。

已在当前环境配置 `OPENCODE_API_KEY` 后运行：

```bash
npm run experiment:pilot -- --execute
```

默认选择 `space-bunny-free`、`shift-ledger-1`，两种 ATN 模式各运行一次。下面显式选择旧任务时，仍默认五种模式；先调整计划，再加 `--execute`：

```bash
npm run experiment:pilot -- --models space-bunny-free --tasks ledger-reconciliation,release-candidate,boundary-diagnosis --repeats 1
```

这份计划包含 1 模型 × 3 任务 × 5 模式，共 15 次运行；若另行选择两个获准模型，同样三题则为 30 次。每批上限 36 次，重复次数最多 3；使用少量任务先确认协议与计量，再扩大样本。增加重复前检查计划次数，例如默认五模式、三题、三次重复共 45 次，需要拆批。

Windows 可以使用仓库外的当前用户 DPAPI 凭据，无需把明文密钥写入源码、命令参数或配置文件：

```powershell
.\scripts\run-pilot.ps1 -PilotArguments @('--execute', '--models', 'space-bunny-free,deepseek-v4.1-flash', '--tasks', 'shift-ledger-1')
```

脚本优先使用当前 `OPENCODE_API_KEY`，否则读取 `%LOCALAPPDATA%\dsh-atn\credentials\opencode-go.dpapi`，临时传给子进程并在退出时恢复原环境变量。首次保存可在本机 PowerShell 中通过安全输入完成：

```powershell
$credentialPath = Join-Path $env:LOCALAPPDATA 'dsh-atn\credentials\opencode-go.dpapi'
New-Item -ItemType Directory -Force -Path (Split-Path $credentialPath) | Out-Null
Read-Host 'OpenCode API key' -AsSecureString | ConvertFrom-SecureString | Set-Content -LiteralPath $credentialPath
```

DPAPI 文件由当前 Windows 用户解密，不应复制进仓库。普通 npm 命令不自动读取它；需要时使用上述包装脚本。

## 参数与资源边界

PowerShell 的 `-PilotArguments` 逐项转交以下 runner 参数。

| 参数 | 默认值 | 含义 |
|---|---|---|
| `--execute` | 关闭 | 启用真实推理；否则仅输出计划 |
| `--models` | `space-bunny-free` | 实时免费模型或 `deepseek-v4.1-flash`，逗号分隔；其他付费路由拒绝 |
| `--modes` | 两种 ATN 模式 | 显式只选旧任务时默认五种模式；分布式任务仅支持 ATN 模式 |
| `--tasks` | `shift-ledger-1` | 上表中的任务，逗号分隔 |
| `--repeats` | `1` | 每个模型/任务/模式重复次数，最多 3 |
| `--agents` | `8` | 分布式任务预置 8–16 个节点；旧任务默认 3、允许 2–16；single 始终只有一个 |
| `--node-steps` | `16` | ATN 每节点步骤预算，包含入口，最多 64；耗尽节点退出；与总调用上限分开记录 |
| `--calls` | `128` | 每次运行全网调用安全上限，最多 256；旧任务默认 16；含 independent-pool 时必须不少于 agents |
| `--output-tokens` | `1536` | 每次模型调用的最大输出 token，最多 4096 |
| `--observed-tokens` | `250000` | 已观测 token 达到此值后拒绝后续调用；最多 2000000 |
| `--timeout-ms` | `180000` | 每次运行的取消期限，最多 600000 毫秒 |
| `--out` | `.artifacts/experiments/<时间与随机标识>` | 本批结果目录；必须是新目录，拒绝覆盖已存在目录 |

观测 token 限额是基于 provider 已上报 usage 的准入阈值，不是精确的总 token 硬上限：正在执行的调用可能超过阈值，缺失 usage 不会被伪装成零。调用上限由 `llm/stream` 入口控制；adapter 内部不可见的 HTTP 重试不在这个计数保证内。运行超时会触发取消，底层清理仍可能花费额外时间。401、403、429 会停止后续批次，不通过重复请求尝试绕过认证、权限或额度拒绝。

## 记录与解释

每次运行创建独立内核、Session 与工作目录；同一任务使用同一公开输入，manifest 记录其 SHA-256、版本、模型、限制和对照含义。runner 在进程加载时记录主要源码及 lockfile 的磁盘哈希；实验运行中不要修改源码。重复运行会轮换模式顺序；默认只重复一次，不能排除运行顺序和网关负载影响。

| 产物 | 内容 |
|---|---|
| `model-catalog.json` / 批次 `catalog.json` | 查询时间、候选模型和参考价格元数据 |
| `input.json` / `manifest.json` | 公开输入、输入摘要、装配版本及限制 |
| `events.jsonl` / `summary.json` | 实验计量事件与汇总：模型/工具调用、耗时、token、成本覆盖情况及 ATN 拓扑/任务变化 |
| `report.json` | 最终答案、外部评分、停止原因、调用数量、节点数量、协议状态和计量快照 |
| 批次 `results.json` | 已完成运行的汇总，逐次落盘 |
| `sessions/`、ATN 的 `storage/` | 本次运行的持久会话与协议状态 |

`report.json` 的 `submissionMetrics` 是捕获最终提交时的计量快照，`metrics` 是清理结束后的汇总，两者分别保留；提交瞬间可能仍有在途调用，不能把前者当作全部消耗。报告还保留提交方式、最终文本提取状态、清理结果和停止时的协议状态。queued 邮件、open 任务及 active agent 数量独立于答案评分，既不因答案正确而归零，也不被隐藏；据此区分“答案通过”与“协作已正常收尾”。

计量事件不保存 prompt、回答正文、工具参数/结果或错误全文；`input.json`、最终答案和 Session 日志则包含实验内容。未知 usage、价格缺失、未结束请求和观察错误在覆盖字段中保留，不应按零成本解读。费用字段是按实时目录参考单价计算的估计，**不是 OpenCode 订阅账单、实际扣款或订阅额度消耗**；免费目录标记也不能替代账户账单。

比较分布式任务时先核查干预有效性，再看外部通过率，以及相同成功水平下的 token、耗时、调用与协调成本。失败与无效样本也要完整报告，不能挑选支持结论的运行。独立候选基线仅用于旧冒烟任务，全部采样与合成开销均保留。新任务只提供可测试的实验条件；仍需真实重复、效应区间、独立保留任务和匹配预算的随机重连对照，才能判断主动重连是否带来收益。

## 本轮实现范围

本轮已补上结果摘要/证据传递、初始任务发件箱与持久投递回执、每任务有界结算保留额度，以及独立实验计量和客观验收。这些改进解决执行可靠性和可测量性。

运行时只在匹配 ATN 消息的 `user/message` 已写入目标历史、且包含它的 checkpoint flush 成功后确认 `delivered`。仅在 pending inbox 中或处于 claim 过程的消息保持 queued；节点可能已开始处理，但交付仍等待历史收件回执。`atn_deliver` 会先刷新已消费邮件收据，再判断投递阻塞项。恢复按稳定消息标识去重；这不构成任意崩溃下外部副作用恰好一次的保证。消息字节限额包含稳定消息 id、结果摘要和证据；新建 id 不接受换行，已有相同 id 的原消息重试先去重。

请求失败或 claim 取消后，空闲节点上的未接收邮件可以重新唤醒：保留实际 inbox 消息身份，缺失时从持久发件箱重放；运行中的 claim 仍受去重保护。已停止或已耗尽适用步骤预算的节点不会因此重新开始工作。

## 后续阶段与验证门槛

以下为阶段目标，不能视作能力已经获得实验支持。外部 oracle 仍只在结束后评分；在线局部遥测由运行时直接观测，宿主验收是可选增强，主动重连不再以验收收益为准入门槛。分布式阶段任务和故障注入已实现，通用任务验证器、随机重连对照与统计评估仍待完成。治理保留宿主 API，但默认模型工具面休眠；默认任务状态/发现合并为 `atn_status`。

| 阶段 | 目标 | 需要验证的结果 |
|---|---|---|
| 治理与通信分离 | 目标治理依据独立于节点自主选择的通信边；保护人类目标与约束 | 提案者不能通过先删边、选择赞同者来缩小全局目标修改的审议范围；旧提案授权仍稳定 |
| 任务 DAG 与结果验收 | 显式依赖、重试来源、产物与验收状态，减少重复工作和提前收敛 | 未通过验收的上游结果不会被误当作已验证依赖；能追踪失败、替代解与下游影响 |
| 可验证反馈驱动重连 | 用局部验证收益、延迟、成本和信息互补性帮助节点选择协作者，保留独立探索 | 在同预算下，重连后的任务质量或效率改善可归因；收益缺失或负向时可被发现，不把同伴赞同当作质量信号 |
| 知识组合与跨任务泛化 | 保存有证据和适用条件的经验，保留不同假设；在未参与设计的任务族中检验 | 跨任务收益能在保留集复现，而不是记住本轮答案、固定角色或某条通信脚本 |
| 同预算统计评估 | 预先确定主指标、实际有意义的改进门槛与重复方法；补充随机重连和机制消融 | 同模型/工具/token/并发预算下报告效应量、区间及失败样本；区分采样、并行规模与自适应拓扑各自贡献 |

这些机制仍应允许节点依据局部信息自主分工和重连；独立治理规则与验收机制不要求加入固定的中心规划模型。只有对照、消融和跨任务验证共同支持时，才进一步讨论群体能力提升。
