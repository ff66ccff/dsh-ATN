# 可测性恢复实施与验收（2026-10-05）

本报告对应 [实施说明](MEASURABILITY_RECOVERY_BRIEF.md)。起点是已有 P0–P5 未提交工作区，保留这些改动，没有恢复到 Git HEAD。实施前完整测试实际通过 371 项 runtime/集成测试及 8 项 UI 测试。模型能力与工程验收分别报告，所有诊断保留 `causalClaim:false`。

最终源码的真实免费模型固定臂在下述显式 32 步条件下 **5/5 两阶段正确**；零付费脚本扫描 **45/45**。六工具、六规则和事后边级判据已落地，固定协议字节下降 **33.97%**，394 项 runtime/集成与 8 项 UI 测试及五项要求命令通过。仍未完整满足的是平均输入 token 的稳定明显降幅，以及逐项全部新增测试的修复前失败留证；详见末尾验收边界。

## 实现范围

| 项目 | 当前实现与证据 |
|---|---|
| 4.1 边级评价 | 持久保存 `(requesterId, holderId, comparisonKey)` 的不同任务样本；换边冻结被移除边当时的样本，新边可无历史；评分及网络 mutation（含停止）重算原记录。默认 `requesterMinSamples=2`，精确重试和 needs-more 转终态不重复计数。区分 `new-edge-unobserved`、`no-ratings-at-all`；宿主否决继续抑制冲突认可 |
| 4.2 六工具 | `start / spawn / send / status / board / finish`。`status.review` 保留原反馈校验，`board.documents/topics` 合并知识发布；旧 `knowledgeFingerprint` 仍兼容读取。为解决说明中“列出 7 个名称、完成标准 ≤6”的冲突，额外将换边并入 `status.rewire`。`claimTaskId/review/rewire` 每次最多一个原子写 |
| 4.3 上下文 | 共同规则 6 行；固定协议字节由真实注册表测量；本地反馈正文上限 4096 字节，仅截断可选明细，保留同伴 ID、计数；白板仍按原分页字节上限读取。后续任务邮件只保留任务标识和新差异，持久原邮件及回执不变 |
| 4.4 可配置校准 | 链长、每节点步数、全局调用与输出上限显式记录；自动推进默认关闭。提示要求立即提交阶段 1、按照实际配置安排阶段预算，白板示例给出创建版本和更新规则。确定性扫描与真实免费模型重复验证分开记录 |
| 4.5 评价 | 四个独立布尔 `phase1Submitted/phase1Correct/phase2Submitted/phase2Correct`。主指标保持两阶段均正确；缺阶段 1 提交单列纪律失败，错误答案另外计求解失败 |
| 4.6 错误 | 对全部 24 次历史运行逐事件审计：35 次模型 finish error 和另 224 次工具执行错误全部分类。原始 NUL 调用在真实 Harness 及安装的提供商解析器合成 SSE 中复现；排除 ATN 注册生成 NUL，保留最终上游归因未知 |

保留入口宿主所有权、网络原子 mutation 队列、单向边、live Agent 身份、持久投递、生命周期、白板作者与版本检查。生产默认 `stepBudget=64` 未提高；实验中的步数、调用和 token 观测阈值是分别记录的参数，不将步数称为 token、HTTP 或费用上限。

## 固定成本实测

| UTF-8 字节 | 实施前 | 实施后 | 变化 |
|---|---:|---:|---:|
| `systemPromptBytes`（ATN 共同规则） | 1,521 | 969 | -36.29% |
| `toolSchemaBytes`（真实注册表全部 ATN 定义） | 9,322 | 6,191 | -33.59% |
| `fixedContextBytes` | 10,843 | 7,160 | -33.97% |
| 工具数 / 规则行数 | 9 / 9 | 6 / 6 | 满足上限 |

测量记录在 `.artifacts/measurability/baseline-context.json` 和 `after-context.json`，包含完整 schema。`tests/integration/fixed-context.test.ts` 将 7,200 字节设为回归上界，另精确断言六个名称及六行规则。这里的固定成本只包括 ATN 规则和 ATN 工具，不包括宿主其他提示、实验 `read_evidence/submit_checkpoint` 工具、历史消息或提供商封装。

每次真实模型调用保留 `callCosts` 的固定字节和 `inputTokens`；任何 usage 缺失都保留 null。完整 `meanInputTokensPerCall` 在有未知调用时为 null，同时报告已知调用均值和覆盖率，不能将未知当零。提供商 `inputTokens` 不含其单独报告的 cache token。历史 24 次、2,211 调用的逐调用分布保存在 `.artifacts/measurability/baseline-input-distributions.json`，带每个事件文件 SHA-256。

输入 token 的新实测、每次真实运行和固定臂闸门见下方实测记录及 [校准报告](MEASURABILITY_CALIBRATION.md)。不同链长/协议的前后数字只作描述，不归因为某个单独改动的因果收益。

## 实验准入与产物

比较仍保留 `adaptive / fixed / no-feedback / no-board` 四臂。只有同模型、同配置、同源码、不同 runId 的 fixed 至少 5 次且 ≥80% 两阶段正确，并且各比较臂都至少 5 次，报告才允许描述拓扑差异；确定性脚本不能打开真实模型比较闸门。所有失败、超时、工具错误、未知 usage 和每次 sourceHashes 均保留。

成本包括 `atnTotalInteractions`、`atnTotalTransferBytes`、输入 token 分布以及通信相对同配置参考策略的倍数。白板读写有成本。换边 verdict 是证据质量诊断，旧里程碑不再用作能力目标；保留旧测试时显式标记其 M=1 历史条件。

最初扫描和一条真实模型运行在代码复查期间产生，未删除：`.artifacts/experiments/measurability-calibration-20261005` 有完整 45 次确定性结果，后来因比较契约排序修复而被新版扫描取代；`.artifacts/experiments/measurability-live-fixed-20261005` 在首运行尚未完成时主动中止，`interrupted.json` 说明原因。它不算模型失败或成功，也不混入后续统计。随后依次保留 v2（累计评价修复）、v3（显式预算参数扩展）、v4（宿主样本选择修复）的源码和独立实验；不跨版本挑选成功项。

## 错误归因边界

完整表与逐事件来源见 [TOOL_ERROR_AUDIT.md](TOOL_ERROR_AUDIT.md)，机器可读产物为 [tool-error-audit-20261005.json](../experiments/results/tool-error-audit-20261005.json)。35 个 finish error 为 TRANSPORT 26、RATE_LIMIT 4、SERVER 4、EMPTY_RESPONSE 1；缺参数和两个 NUL 是另 224 次工具错误的一部分。

NUL 在工具分派之前的持久响应流中已存在；192 个历史请求 header 的工具名均正常。没有原始 HTTP/SSE，不能把提供商模型、网关与当时适配器状态完全区分。没有模糊修复未知工具名，也没有将空响应改记成功。

59 次白板缺 `expectedRevision` 的工具错误已分类。当前 Harness 参数 DSL 无法在保持并列 `action/key/body/expectedRevision` 接口时表达跨字段条件 required；运行时继续严格检查。工具说明与实验示例已明确写入所需参数，这属于可用性改进，尚不能声称原错误率已经消失。

最终 v4 真实五次另有 **122 次工具错误**（各 seed 为 20/30/37/19/16），全部分类；模型 finish error 为 0，NUL 为 0。主要为元数据访问边界 62、非邻居发送 21、缺必需参数 11、失效游标 10、非入口提交 9。171 次 publish 没有版本参数错误；20 次 review 中 19 次成功、1 次被“任务尚未提交”守卫拒绝。另有 1 次 `UNKNOWN_TOOL` 的名字混入 markup，原始输入流在 ATN 分派前已包含该文本，注册名正常，不能进一步归因模型或网关。完整类别、逐事件原位置及 SHA 见 [v4 独立审计](../experiments/results/measurability-live-steps32-tool-errors-20261005-v4.json)。运行通过不代表无工具异常；这些错误不与历史 35/224 或其他批次合并。

## 测试证据的准确范围

新增验收覆盖真实 runtime 新边事后两次评分、冷恢复、停止刷新、未用反馈、无任务换边、白板元数据与旧记录查询、状态单写互斥、邮件压缩、反馈字节上限、四布尔与自动推进、准入闸门、NUL 边界及全量错误分类。

有实际红绿记录的修复包括：超长反馈摘要、累计评价的完整可比契约被另一个待评契约遮蔽、宿主样本选择的旧双边合同被较新单边合同遮蔽，以及回执尚 queued 但 Session 已记录时的邮件重复模板。两处合同问题是不同路径，分别保留 `edge-contract-before/after.log` 和 `host-contract-before/after.log`。固定上下文使用修改前真实注册表的留存数据回放，9 工具/9 行/10,843 字节均违反新增限制；修改后通过。错误审计模块有新增测试先失败后实现通过记录，不能把模块不存在的失败说成生产 NUL 故障被修复。

4.1 的主要事后评价、4.2 合并接口、4.4/4.5 新口径等部分测试是在实现后新增，没有逐项重放原工作区红灯。因此实施说明“4.1–4.6 每项全部新增测试均留修前失败记录”的严格过程要求未完全满足，报告不补造证据。原有测试没有删除，单样本历史诊断显式使用 M=1；新增默认 M=2 测试另外验证实际新判据。

## 最终命令与真实实测

| 必须执行的命令 | 实测结果 | 保留日志（`.artifacts/measurability/`） |
|---|---|---|
| `npm test` | 394 项 runtime/集成 + 8 项 UI 全过；无跳过 | `test-final.log` |
| `npm run typecheck` | 通过，包含 UI 测试类型检查 | `typecheck-final.log` |
| `npm run build` | 通过 | `build-final.log` |
| `npm run pack:tarball` | 通过，生成 `.artifacts/dsh-atn-0.3.2.tgz` | `pack-final.log` |
| `npm run smoke:profile` | 通过；隔离 profile 安装、本身已有 183 行配置不变、入口/子节点均有精确六个 ATN 工具 | `smoke-final.log` |

完整测试首次执行有一个旧阶段切换 fixture 的定时竞态；改为入口和 worker 之间的明确 barrier，保留“运行中的 worker 必须收到第二阶段”的断言后全过。profile smoke 的旧 9 工具数量断言已迁移为六个精确名称，未移除检查。首次失败日志/原因与最终通过分开保留。

当前源码 v4 正式脚本扫描为 **45/45** 两阶段全对，九组各 5/5，最低 2/20 配置 5/5；上一源码 v2（38/45、最低配置 4/5）和 v3（38/45、最低配置 5/5）的完整扫描也独立保留。详见 [校准记录](MEASURABILITY_CALIBRATION.md) 及 [45 次产物索引](../experiments/results/measurability-calibration-20261005.json)。历史 Windows storage rename EPERM 不是无效数据，也不能归咎于模型；v4 未再出现不代表文件系统问题已修复。完整的源码和报告 SHA-256、每次错误位置在索引中。

统一机器可读汇总由 `node scripts/summarize-measurability.mjs` 生成 [measurability-recovery-20261005.json](../experiments/results/measurability-recovery-20261005.json)，包括全部逐调用分布、每个模型独立准入状态和未知 usage 覆盖率。

### 真实免费模型固定臂：Space Bunny

目录 `.artifacts/experiments/measurability-live-fixed-20261005-v2/` 保留全部五次产物。使用目录实测全部价格为零的 `space-bunny-free`，`--free-only` 强制排除非免费路线。链长 2、8 节点、出度 2、每节点 20 步、最多 160 调用、输出上限 4096、token 观测阈值 2,000,000、每次期限 360 秒、自动推进关闭。输出、观测阈值和期限显式沿用历史第二批的条件，不修改默认值；与脚本扫描不同条件分别统计。源码哈希一致。

| seed | 阶段1提交/正确 | 阶段2提交/正确 | 调用 | 已知输入均值 | usage覆盖 | ATN交互 | ATN字节 | 交互/字节参考倍数 | 结束原因 |
|---:|---|---|---:|---:|---|---:|---:|---|---|
| 17 | 是/是 | 是/是 | 97 | 2099.96 | 93/97 | 121 | 195052 | 3.46 / 7.83 | phase-2-submitted |
| 31 | 是/是 | 否/否 | 113 | 2134.07 | 111/113 | 118 | 190766 | 3.37 / 7.27 | observed-token-limit |
| 45 | 是/是 | 否/否 | 130 | 2045.31 | 127/130 | 148 | 207521 | 4.23 / 7.85 | observed-token-limit |
| 59 | 是/是 | 是/是 | 96 | 2715.45 | 89/96 | 135 | 193503 | 3.86 / 7.42 | phase-2-submitted |
| 73 | 是/是 | 是/是 | 122 | 2135.58 | 119/122 | 150 | 237109 | 4.29 / 9.14 | phase-2-submitted |

主指标 **3/5**，阶段 1 提交与正确均为 **5/5**，阶段 2 提交与正确均为 **3/5**。提交纪律失败 0，已提交错误证明 0；两个阶段 2 缺失是预算停止，不能算解题正确。**这组 20 步配置的真实固定臂准入未通过**，不据此解释自适应收益。

五次共 558 调用，539 次已知 input usage、19 次未知，按已知调用加权均值 **2203.60**，完整 `meanInputTokensPerCall=null`。同模型同 seed=17 的旧第二批为 **2122.26**（94/98 已知），新值 **2099.96**（93/97 已知），仅低约 **1.05%**；新五次的已知均值还高于这个单次历史值。没有足够证据称平均输入 token 已明显下降。链长 4→2、协议和自动推进也改变了，不能从这些差值作单项归因。

### 真实免费模型固定臂：LongCat

Space Bunny 不能通过后，按相同种子、题库和显式资源条件独立筛查免费 `longcat-2.5-preview-free`，路径 `.artifacts/experiments/measurability-live-longcat-20261005/`。seed 17、31 均阶段 1 提交正确、阶段 2 未提交；分别 118、126 次调用，均在 360 秒期限结束，入口已经用满 20 步。两次失败使原计划的 4/5 门槛无法达到，因此这批提前停止；seed 45 的中断会话完整保留，59/73 未运行，三次未评价均为 null，不伪称失败或成功。`interrupted.json` 记录原因。**这是 0/2 的失败可行性筛查，不是满足每臂 ≥5 的模型对比，不与 Space Bunny 合并计数。**

### 显式增加实验余量：32 步

20 步的真实批次仍受 token 观测阈值及入口步数限制，因此继续实施说明建议的下一档校准：Space Bunny、链长 2、每节点 **32** 步、**256** 调用、输出 **4096**、token 观测阈值 **4,000,000**、期限 **600 秒**、自动推进关闭，种子仍为 17、31、45、59、73，目录 `.artifacts/experiments/measurability-live-fixed-steps32-20261005/`。题库、ACL、提交判据和生产 runtime 不变；这些是显式实验条件，未来若做四臂比较必须四臂同用此配置。

为容纳显式参数，runner 只将观测 token 参数的允许上界从 2m 扩展至 8m；CLI 默认仍是 **400k**，生产默认步数仍是 **64**。新增测试先在原 2m 验证上界上失败，再验证显式 4m 可执行、超过 8m 拒绝、所有原默认不变。日志为 `observed-token-bound-red.log` 与 `observed-token-bound-green.log`。旧 v2 源文件 25 份逐一与原报告 SHA-256 核对并保存在 `.artifacts/measurability/source-v2/`；不把旧实验说成当前源码运行。

v3 的五次结果均已完成，主指标 **5/5**，两个阶段的提交与正确比例均为 100%，全部由阶段 1 checkpoint 推进、阶段 2 提交结束，无自动推进。不同条件下的成功不替换 20 步失败。

| seed | 阶段1提交/正确 | 阶段2提交/正确 | 调用 | 已知输入均值 | usage覆盖 | ATN交互 | ATN字节 | 交互/字节参考倍数 |
|---:|---|---|---:|---:|---|---:|---:|---|
| 17 | 是/是 | 是/是 | 91 | 2258.69 | 85/91 | 141 | 219321 | 4.03 / 8.81 |
| 31 | 是/是 | 是/是 | 143 | 2277.78 | 138/143 | 199 | 322720 | 5.69 / 12.30 |
| 45 | 是/是 | 是/是 | 92 | 2064.90 | 86/92 | 128 | 203392 | 3.66 / 7.70 |
| 59 | 是/是 | 是/是 | 122 | 2290.24 | 116/122 | 163 | 297556 | 4.66 / 11.40 |
| 73 | 是/是 | 是/是 | 85 | 1848.53 | 79/85 | 104 | 159431 | 2.97 / 6.15 |

共 533 调用，504 次已知输入 usage、29 次未知，已知均值 **2173.82**，完整均值 null。每次源码一致且完整产物保留，详见 [v3 汇总快照](../experiments/results/measurability-recovery-20261005-v3.json)。它通过了当时源码、这些显式条件下的固定臂可行性门槛，未执行另外三臂，不能解释拓扑收益。

### 最终源码 v4 的复验

最终只读审计又发现宿主自动选择样本的边界问题：较新的 baseline-only 合同提前返回，遮蔽较早已有双边证据的合同。`selectRequesterRewireSamples` 现在先遍历寻找双边匹配，再使用单边后备；新增测试先红后绿，独立验证宿主 `observed-improvement`、两侧样本数和 `causalClaim:false`。固定臂会在工具调用前禁用换边，因此这条有评分的分支不会影响上一批 fixed；仍将 v3 的 25 个源文件按原 SHA 逐一归档至 `.artifacts/measurability/source-v3/`，不把历史运行改写成新源码运行。

当前 v4 已以完全相同的 32 步条件、五个种子完成复验，目录 `.artifacts/experiments/measurability-live-fixed-steps32-20261005-v4/`；独立脚本扫描为 45/45。五次真实运行使用同一组当前源码 SHA，题库和种子未改，所有原始会话、storage、manifest、events、report 和 batch 保留。

| seed | 阶段1提交/正确 | 阶段2提交/正确 | 调用 | 已知输入均值 | usage覆盖 | ATN交互 | ATN字节 | 交互/字节参考倍数 |
|---:|---|---|---:|---:|---|---:|---:|---|
| 17 | 是/是 | 是/是 | 96 | 2078.86 | 91/96 | 139 | 244094 | 3.97 / 9.80 |
| 31 | 是/是 | 是/是 | 89 | 1833.34 | 87/89 | 117 | 159949 | 3.34 / 6.09 |
| 45 | 是/是 | 是/是 | 120 | 2093.03 | 113/120 | 151 | 237401 | 4.31 / 8.98 |
| 59 | 是/是 | 是/是 | 99 | 1854.80 | 93/99 | 127 | 181264 | 3.63 / 6.95 |
| 73 | 是/是 | 是/是 | 58 | 1874.73 | 51/58 | 73 | 100535 | 2.09 / 3.88 |

**真实 fixed 主指标为 5/5，两个阶段的提交和正确均为 5/5，提交纪律失败 0、已提交错误证明 0。** 全部以 `phase-2-submitted` 结束、cleanup=`released`，没有自动推进。`selectedLiveCalibration` 只选择这批完整、当前源码且满足门槛的真实运行；旧版本的 5/5 不会代替当前版本。选择表示已测试真实条件中的最低合格档，不证明全局最低预算。四臂比较尚未执行，`mayInterpretTopology=false`，不作拓扑收益或因果结论。

共 **462** 次调用，输入 usage 已知 **435** 次、未知 **27** 次（覆盖 **94.16%**）；已知输入总计 **853296**、按调用加权均值 **1961.60**，完整 `meanInputTokensPerCall=null`。相对历史同模型 fixed seed 17 的已知均值 2122.26，批次均值低 **7.57%**；同 seed 17 的当前值 2078.86 仅低 **2.04%**。上一 v3 五次均值 2173.82 也完整保留。历史基线只有这一个同模型 fixed 运行，且链长、步数、调用/观测阈值/期限、协议和自动推进条件均不同，因此这些是观察数字，**不能认定平均输入 token 已稳定明显下降或由工具合并单独造成**。

当前真实批次复现命令（仅允许目录当前标价全部为零的模型）：

```powershell
./scripts/run-pilot.ps1 -Experiment shifting-evidence --execute --free-only --models space-bunny-free --modes fixed --chain-length 2 --steps 32 --max-calls 256 --max-output-tokens 4096 --observed-token-limit 4000000 --timeout-ms 600000 --repeats 5 --seed 17 --out .artifacts/experiments/measurability-live-fixed-steps32-20261005-v4
```

## 验收边界

| 目标 | 实际状态 |
|---|---|
| G1 可解 | 当前源码、上述真实固定臂 5/5；脚本扫描最低 2/20 为 5/5。两个执行类型和不同预算分开统计 |
| G2 收敛 | 恰好 6 个模型工具、6 行规则 |
| G3 降本 | 固定协议 10843→7160 字节；真实输入逐调用分布及已知均值已提供，但稳定明显下降尚未证实，完整均值因未知 usage 为 null |
| G4 判据 | 持久边级样本、默认 M=2、事后重算与两个不足原因均有测试；不作因果声明 |
| G5 归因 | 历史 35 次 finish error、224 次工具错误全部分类；NUL 在进入 ATN 前已存在，上游模型/网关/适配器仍无法进一步区分。新批次另行审计，异常不被成功率隐藏 |
| G6 可测 | 四布尔、纪律分类、同配置同源码准入、每臂至少 5 次和成本口径已实现；尚未执行四臂效果比较 |
| 第 7 节过程证据 | 原测试保留并全部通过、五项命令通过；部分新测试没有原工作区的修复前失败记录，严格逐项 red→green 要求仍不完整 |

README 与历史实验页同步这些结果和未完成项。没有发布 npm、推送代码或把工程验收写成智能收益。
