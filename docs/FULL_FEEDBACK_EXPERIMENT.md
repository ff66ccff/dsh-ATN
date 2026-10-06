# P0–P5 实施与变化证据链实验

> 本文下方保留 2026-10-05 两轮历史协议和原始结果，不代表当前工具接口。可测性恢复后的接口、校准、错误归因及完成边界见 [本轮恢复报告](MEASURABILITY_RECOVERY_REPORT.md) 和 [校准报告](MEASURABILITY_CALIBRATION.md)。原来的换边 verdict 里程碑已取消：新边在换边前没有任务样本，74/74 insufficient-evidence 不能解释为模型不使用反馈。

当前协议使用六个工具、六行共同规则：评价与换边分别是 `atn_status(review={...})`、`atn_status(rewire={...})`，知识发布是 `atn_board` 的 `documents/topics/body`。边级评分默认每侧每边 M=2，事后更新，仅作诊断。自动推进默认关闭，链长、每节点步数、调用和输出上限均显式记录，不提高 runtime 默认预算。

当前比较的准入要求是同模型、同配置 `fixed` 至少 5 次且正确率至少 80%，每个比较臂至少 5 次；未达到只报告可行性。主指标仍为 `phase1Correct && phase2Correct`，同时报告两个阶段的提交比例；未提交阶段 1 单列为提交纪律失败。成本报告包括全部运行、通信次数/字节、输入 token 分布及未知 usage。确定性脚本的通过不能替代真实模型准入，也不能证明拓扑收益。

可测性恢复的最终源码实测：脚本扫描 45/45；真实免费 Space Bunny fixed 在显式链长 2、32 步、256 调用、4096 输出、400 万 token 观测阈值、600 秒、自动推进关闭的条件下 **5/5**，所有产物保留。20 步旧批次 3/5 和 LongCat 提前停止筛查也独立保留。固定协议字节 10843→7160；当前真实输入已知均值 1961.60、覆盖 435/462，完整均值为 null，不能认定稳定明显降幅。394+8 项测试及五项验收命令通过；部分新增测试未完整保留修复前失败记录。当前仅验证可行性，尚未运行四臂效果比较。详见[恢复报告的最终源码复验与验收边界](MEASURABILITY_RECOVERY_REPORT.md#最终源码-v4-的复验)。

这轮保留原有 runtime 的原子写队列、持久投递回执、分阶段退休与恢复机制，补齐局部反馈和实验条件。设计判据是：动作产生可观察的局部反馈，并让该反馈参与下一次选择。

## 已实施机制

| 优先级 | 实现 | 可核查边界 |
|---|---|---|
| P0 | `atn_feedback`：真实请求者提交 accepted/rejected/needs-more；结果哈希绑定，进入发现排序与重连样本 | 本地意见不是宿主验证；宿主否决抑制冲突的正向信用，原始意见保留 |
| P1 | `atn_publish`：文档、主题和贡献的知识指纹；认可记录、负载由 runtime 派生 | 自报知识与实际评价分来源；所有节点任务描述相同时也能发现不同知识持有者 |
| P2 | `atn_board`：持久共享白板，发布和读取不产生邮件、不唤醒其他节点 | 64 条/64 KiB；单条含元数据 4096 字节；读取最多 8 条/16 KiB；作者权限、精确版本、分页失效、累计读写计量 |
| P3 | `maxCollaborationPeers`：持久出度上限 1–4，兼容默认 4；新实验设置 2 | 出生连接、重连、旧记录初始化和失效修复都执行约束；16 节点二邻居环测试直径为 8 |
| P4 | 两阶段变化依赖链：隐藏证据位置，下一阶段改变下一跳及知识持有者 | 独立检查有序链、原始证明、文档版本和终点；不是并行求和；允许集中汇总参考策略 |
| P5 | 九条行为规则：先读证据、发布知识、先查询再请求、评价结果、据反馈选择同伴 | 相对本轮起始 Git HEAD，共同规则从 2044 降到 1521 UTF-8 字节（减少 25.6%）；工具 schema 的新增开销不包含在此降幅中 |

白板每次写入必须携带预期版本。创建使用 `expectedRevision=0`；更新或删除只允许作者使用当前版本。容量满时明确拒绝，不暗中逐出别人的内容。删除后重建获得新的全局版本，旧更新不能覆盖新记录。成功操作的计量跨重启保留，删除条目不清零历史成本。

## 实验设计与复现

`experiments/shifting-evidence-run.ts` 使用真实 dsh Harness 内核、Agent Loop、持久 Session、ATN runtime 和 `dsh-opencode-go` 提供商插件。它不是桌面 UI 自动操作，也不是直接绕过 Harness 调用模型 HTTP API。所有节点具有相同模型与工具能力。

任务有八个节点、每节点最多两个出边，初始为双向环。每个节点只能读取宿主 ACL 授权给自己的当前阶段文档。公开根键启动一条四跳依赖链；证明字符串不能推测，必须从其他节点取得。第二阶段改变有用的路径及持有者，旧阶段证明不能通过最终检查。阶段变化不以答案正确或全部节点完成读取为条件。

每次真实调用前，确定性参考策略使用相同 ACL、环形图、步数和消息限额，在真实 runtime 上验证两阶段可解。它沿环收集实际任务结果并集中合成，不读取隐藏答案来选择输出。该参考是可行策略，不宣称最优策略。

四臂对照：

- `adaptive`：全部机制。
- `fixed`：禁止主动重连，保留同样的共享白板。
- `no-feedback`：禁用请求者评价，保留其他机制。
- `no-board`：禁用白板，用有向任务/结果邮件协作。

`adaptive` 与 `fixed` 的差异只衡量存在共享介质时主动选边的额外作用；白板本身跨拓扑可读，所以必须结合 `no-board` 解读，不能把白板收益归因于拓扑。

实时目录在 2026-10-05 列出免费模型 `space-bunny-free`、`longcat-2.5-preview-free`，以及用户指定的 `deepseek-v4.1-flash`。复现命令：

```powershell
./scripts/run-pilot.ps1 -Experiment shifting-evidence --execute `
  --models 'deepseek-v4.1-flash,space-bunny-free,longcat-2.5-preview-free' `
  --modes 'adaptive,fixed,no-feedback,no-board' --agents 8 --steps 20 `
  --max-calls 160 --max-output-tokens 1536 --observed-token-limit 800000 `
  --timeout-ms 240000 --out .artifacts/experiments/full-feedback-new-run
```

脚本优先使用已有进程凭据，否则使用仓库已有的当前用户 DPAPI 凭据加载方式。密钥只传给子进程，不写入报告。输出目录必须是新目录，失败运行保留，不用重试成功的数据替换原失败。

初轮会话记录显示 1536 上限截断了部分推理或工具参数，还发现模型通过知识指纹传递原始证明。因此第二轮使用 `protocolRevision=2`，在实验层限定知识发布为当前本地文档／键／阶段的固定元数据，隐藏候选任务／结果正文，仅按元数据发现，并限制任务查询、认领、退休理由及换边样本读取旁路。参考策略使用相同访问约束。生产 runtime 的原有访问语义保持不变。

第二轮对三个模型重跑全部四臂；节点数、出度、每节点步数与调用上限保持一致，输出上限改为 4096、总 token 观测阈值为 200 万、期限为 360 秒。两轮协议和预算不同，不能把跨轮变化归因于某个单独机制。第二轮复现命令：

```powershell
./scripts/run-pilot.ps1 -Experiment shifting-evidence --execute `
  --models 'deepseek-v4.1-flash,space-bunny-free,longcat-2.5-preview-free' `
  --modes 'adaptive,fixed,no-feedback,no-board' --agents 8 --steps 20 `
  --max-calls 160 --max-output-tokens 4096 --observed-token-limit 2000000 `
  --timeout-ms 360000 --out .artifacts/experiments/full-feedback-expanded-new-run
```

## 计量与解释

`atnMessages/atnPayloadBytes` 保留邮件口径。`atnBoard` 单独保存成功读取/写入次数及载荷字节。`atnTotalInteractions/atnTotalTransferBytes` 合计两种介质，防止把通信转移到白板后记为免费。白板字节是 UTF-8 JSON 载荷，不是提供商 token；完整模型上下文由实际 token usage 另计。`atnMaxContextBytes` 仍指累计邮件载荷，不代表包含白板和提示词的完整上下文。

准确率来自宿主对两个阶段最终输出的精确检查。请求者的认可率、重连证据、模型 token、错误、期限、清理和未结任务分别记录；协议结清与答案正确是不同判据。有限次同种子测试只用于发现可用性和成本问题，不能建立因果收益或“涌现智能”结论。

## 本次结果

两轮共 24 次真实运行，调用 2,211 次。完整结构化记录见 [JSON](../experiments/results/full-feedback-20261005.json)。两轮的源码哈希分别保存，同一轮内一致；最后一轮对应当时的 P0–P5 源码，不是本次可测性恢复后的源码。

已知 token 包含适配器报告的缓存 token；停止时取消的部分调用没有 usage，因此表中的数值不是完整账单或精确总量。目录参考价不等于实际订阅扣费。邮件／白板列依次为邮件数和白板读写操作数；字节列合计两者，宿主阶段通知另存在 JSON。

### 第 1 轮（12/12）

原协议，1536 输出上限、80 万 token 观测阈值、240 秒。**该轮发现知识索引携带证明，不能作为严格邮件拓扑对照。**失败和原始数据全部保留。

两个阶段均正确：**0/12**。原始文件目录：`.artifacts/experiments/full-feedback-live-20261005`。

| 模型 | 模式 | 阶段 1 / 2 | 调用 | 已知 token | 邮件 / 白板 | 通信字节 | 停止原因 |
|---|---|---|---:|---:|---:|---:|---|
| DeepSeek V4.1 Flash | adaptive | 未提交 / 未提交 | 76 | 811,230 | 41 / 33 | 42,871 | observed-token-limit |
| DeepSeek V4.1 Flash | fixed | 未提交 / 未提交 | 46 | 325,643 | 17 / 19 | 23,781 | phase-2-quiescence |
| DeepSeek V4.1 Flash | no-feedback | 未提交 / 未提交 | 70 | 822,632 | 27 / 39 | 62,124 | observed-token-limit |
| DeepSeek V4.1 Flash | no-board | 未提交 / 未提交 | 75 | 817,441 | 47 / 0 | 27,944 | observed-token-limit |
| Space Bunny Free | fixed | 未提交 / 未提交 | 75 | 805,676 | 36 / 43 | 63,345 | observed-token-limit |
| Space Bunny Free | no-feedback | 正确 / 未提交 | 70 | 806,219 | 39 / 35 | 80,774 | observed-token-limit |
| Space Bunny Free | no-board | 正确 / 未提交 | 69 | 823,111 | 48 / 0 | 36,455 | observed-token-limit |
| Space Bunny Free | adaptive | 未提交 / 未提交 | 75 | 805,148 | 37 / 39 | 83,786 | observed-token-limit |
| LongCat 2.5 Preview Free | no-feedback | 未提交 / 未提交 | 79 | 806,005 | 34 / 18 | 22,135 | observed-token-limit |
| LongCat 2.5 Preview Free | no-board | 未提交 / 未提交 | 70 | 846,427 | 30 / 0 | 12,746 | observed-token-limit |
| LongCat 2.5 Preview Free | adaptive | 未提交 / 未提交 | 78 | 812,144 | 33 / 16 | 17,666 | observed-token-limit |
| LongCat 2.5 Preview Free | fixed | 未提交 / 未提交 | 81 | 800,549 | 46 / 26 | 40,738 | observed-token-limit |

### 第 2 轮（12/12）

修正后的元数据边界，4096 输出上限、200 万 token 观测阈值、360 秒。该轮四臂共享同一访问边界和预算。

两个阶段均正确：**1/12**。原始文件目录：`.artifacts/experiments/full-feedback-bounded-20261005`。

| 模型 | 模式 | 阶段 1 / 2 | 调用 | 已知 token | 邮件 / 白板 | 通信字节 | 停止原因 |
|---|---|---|---:|---:|---:|---:|---|
| DeepSeek V4.1 Flash | adaptive | 未提交 / 正确 | 95 | 1,391,652 | 60 / 61 | 124,869 | phase-2-submitted |
| DeepSeek V4.1 Flash | fixed | 正确 / 正确 | 100 | 1,756,755 | 66 / 70 | 154,008 | phase-2-submitted |
| DeepSeek V4.1 Flash | no-feedback | 未提交 / 未提交 | 115 | 2,016,244 | 67 / 60 | 112,546 | observed-token-limit |
| DeepSeek V4.1 Flash | no-board | 未提交 / 未提交 | 104 | 2,015,554 | 89 / 0 | 47,164 | observed-token-limit |
| Space Bunny Free | fixed | 正确 / 错误 | 98 | 1,308,488 | 51 / 61 | 191,866 | phase-2-submitted |
| Space Bunny Free | no-feedback | 未提交 / 正确 | 117 | 1,904,402 | 67 / 68 | 191,718 | phase-2-submitted |
| Space Bunny Free | no-board | 未提交 / 未提交 | 113 | 2,005,363 | 95 / 0 | 89,065 | observed-token-limit |
| Space Bunny Free | adaptive | 未提交 / 正确 | 107 | 1,698,872 | 59 / 63 | 155,174 | phase-2-submitted |
| LongCat 2.5 Preview Free | no-feedback | 未提交 / 未提交 | 128 | 2,002,610 | 66 / 23 | 43,871 | observed-token-limit |
| LongCat 2.5 Preview Free | no-board | 未提交 / 未提交 | 121 | 2,002,423 | 71 / 0 | 29,766 | observed-token-limit |
| LongCat 2.5 Preview Free | adaptive | 未提交 / 未提交 | 131 | 2,034,043 | 75 / 33 | 63,328 | observed-token-limit |
| LongCat 2.5 Preview Free | fixed | 未提交 / 未提交 | 118 | 1,780,027 | 60 / 48 | 105,103 | timeout |

### 反馈闭环与换边

| 模型／模式（第二轮） | accepted / rejected / needs-more | 实际换边 | 非 insufficient 的请求者判据 | 知识索引中含证明的节点 |
|---|---:|---:|---:|---:|
| DeepSeek V4.1 Flash / adaptive | 0 / 0 / 0 | 8 | 0 | 0 |
| DeepSeek V4.1 Flash / fixed | 1 / 0 / 0 | 0 | 0 | 0 |
| DeepSeek V4.1 Flash / no-feedback | 0 / 0 / 0 | 12 | 0 | 0 |
| DeepSeek V4.1 Flash / no-board | 4 / 0 / 0 | 15 | 0 | 0 |
| Space Bunny Free / fixed | 1 / 0 / 0 | 0 | 0 | 0 |
| Space Bunny Free / no-feedback | 0 / 0 / 0 | 11 | 0 | 0 |
| Space Bunny Free / no-board | 3 / 0 / 0 | 18 | 0 | 0 |
| Space Bunny Free / adaptive | 4 / 0 / 0 | 10 | 0 | 0 |
| LongCat 2.5 Preview Free / no-feedback | 0 / 0 / 0 | 12 | 0 | 0 |
| LongCat 2.5 Preview Free / no-board | 0 / 0 / 0 | 14 | 0 | 0 |
| LongCat 2.5 Preview Free / adaptive | 0 / 0 / 0 | 9 | 0 | 0 |
| LongCat 2.5 Preview Free / fixed | 3 / 0 / 0 | 0 | 0 | 0 |

第二轮 109 次实际换边中，0 次具有非 insufficient 的请求者比较判据。其中禁反馈负对照贡献 35 次；**启用反馈的 74 次实际换边中，仍只有 0 次有足够比较证据。** **真实模型尚未达到 review 提出的换边证据里程碑。** 本地评价通道已经有实际记录，但评价数量、同请求者归属及新旧边的可比样本覆盖仍决定证据是否足够。

第一轮 DeepSeek 的禁白板臂提供一个具体例子：node-1 评价了两份结果，唯一主动换边由 node-6 执行；node-6 没有覆盖其新旧边的本地评价。因此返回 insufficient 是正确约束，不能借用其他节点的认可来填充效果样本。

第二轮 Space Bunny / fixed 的阶段二失败也有可核查原因：前三跳完全正确，末跳 key-10 与终点缺失。持有该事实的 node-21 在 11 次调用中只产生 3 次失败工具执行（缺参数或工具名含 NUL），另有一次 EMPTY_RESPONSE，始终没有成功读取或发布本地证据；持久网络记录中也没有相应证明。它属于实际工具执行／响应异常，不能直接归因于固定拓扑。

### 成本与边界

每次调用前的确定性参考均通过两个阶段：76 次协议动作、单节点最多 10 次，35 封邮件、25,486 字节。它是相同 ACL 和固定环上的可行集中汇总策略，模型调用为零；不能把它当作另一个真实模型成本实验。

DeepSeek V4.1 Flash / fixed 的正确答案运行使用 136 次邮件＋白板交互、154,008 字节，分别是该次参考的 3.89 倍和 6.04 倍；每节点步数、工具输入和真实 token 另行记录。

两轮共记录 35 个模型／适配器 finish error；每次运行的错误码和取消后的未知 usage 都在 JSON 中，未从统计删除。最后一轮资源清理结果：released。正确提交的运行仍可能有未结任务和排队邮件，不能称为已经完成网络协议结清。

白板使跨拓扑共享成为一种独立通信路径；fixed 仍保留生产 runtime 的失活节点修复。第二轮禁白板臂的发现只携带固定元数据，邮件路径受到出度二约束。单种子、每臂一次、提供商运行顺序与故障都限制了效应解释。**本轮不能证明自适应优于固定拓扑、参考策略或 agent team。**

## 工程验证

最终只读审计覆盖第二轮全部 12 臂、96 节点和 95 份持久知识指纹：证明／终点泄漏为零，`contributions` 全为空，逐节点、逐发布阶段的规范元数据比对全部通过。92 份为第二阶段、3 份保留合法的第一阶段索引，查询时会按当前阶段过滤。唯一未发布节点是 Space Bunny / fixed 的 node-21。每臂 21 个源码哈希组内一致，252 次当前文件核对及任务哈希核对全部通过。

最终源码通过 `npm run typecheck`、`npm test`（371 项 runtime／集成测试和 8 项 UI 测试）、`npm run build` 和 `npm run smoke:profile`。安装 smoke 使用当前打包 tarball，在真实 dsh Web profile 中确认九工具、子节点继承和其他预设隔离。该 smoke 的模型是确定性适配器，与上述真实提供商调用分开计数。

P0/P1 的确定性机制里程碑已在[早期记录](FEEDBACK_MILESTONE.md)中证明：有反馈处理臂出现一次 requester-sourced `observed-improvement`，缺反馈臂保持不足。它只验证样本匹配和持久链路，不能代替真实模型的效能结果。
