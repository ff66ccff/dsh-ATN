# 第 11 轮等预算基准实施记录（V3，终轮已完成）

V3 已完成代码实现、离线验收、只读模型目录检查、设计冻结和全部 **70/70 次真实运行**；每臂固定 14 个配对 seed。预检 15/15 次中有 11 次精确通过，真实调用覆盖完整，主批次按登记规则放行。最终精确通过数依次为 `single` 9/14、`single-scaffolded` 13/14、`independent-pool` 12/14、`native-team` 14/14、`atn-adaptive` 10/14。**全部 10 个正确率配对均未达到预登记区分判据，不是等效证明；本轮未建立 ATN 独立优势。** 研究线在第 11 轮关闭。

真实运行起止时间为 2026-10-08 09:53:04.055–12:47:26.823（Asia/Shanghai）。[最终五臂报告](EQUAL_BUDGET_BENCHMARK_IMPLEMENTATION_REPORT_V3.md)给出全部区间、逐运行证据和 14 份完整提示；[原始汇总](../experiments/results/equal-budget-runs-v3-20261008.json)、[统计 JSON](../experiments/results/equal-budget-report-v3-20261008.json)及[完整性记录](../experiments/results/equal-budget-integrity-v3-20261008.json)一并保留。README 已按结果定稿，打包验收通过；本轮没有执行发布。

本轮依据 [EQUAL_BUDGET_BENCHMARK_BRIEF_V3.md](EQUAL_BUDGET_BENCHMARK_BRIEF_V3.md) 实施，研究问题是在同等逐分片分解指令下，分布式结构是否仍有独立贡献。全部设计、目录记录、运行和统计维持 `causalClaim=false`。

## 冻结设计与执行位置

| 项目 | 已登记内容 |
|---|---|
| 设计版本 | `version=3`，`round=11` |
| 冻结时刻 | 2026-10-08 09:52:33.871（Asia/Shanghai）；原始 UTC：`2026-10-08T01:52:33.871Z` |
| 执行根目录 | `.artifacts/equal-budget/20261008-v3/` |
| 冻结设计 | `.artifacts/equal-budget/20261008-v3/design.json` |
| 设计文件 SHA-256 | `dc04b2bbaf48cd7cb4ec4aad19cd1e8e3bea11c7bf1beed413e4194793ecf5df` |
| 冻结源归档 | `.artifacts/equal-budget-v3-frozen-source/`，共 91 份受设计哈希约束的文件 |
| 构造性参考记录 | `.artifacts/equal-budget/20261008-v3/references.json` |
| 模型 | `deepseek-v4.1-flash`，经 `dsh-opencode-go` 调用 |
| fixture | 16 分片 × 10 订单；compact answer；与第 10 轮对应规模使用同一生成器 |
| 单次输出上限 | 8192 |
| 每臂可见调用总配额 | 512 |
| 已冻结运行矩阵 | 5 臂 × 14 个配对 seed = 70 次；实际保留 70/70 次，精确通过 58 次，未通过 12 次 |
| 执行顺序 | 顺序运行配对 seed 块；随 seed 轮换臂顺序；无依赖结果的重试 |
| 活体预检 | 前 3 个配对 seed，共 15 个计划观察，全部保留并计入最终 14 个 seed |

2026-10-08 12:47:56.474 的归档检查确认：91 份当前源码与冻结哈希、源归档相符；22 份历史文件原样保留；1121 份原始文件逐项登记哈希；70/70 运行顺序与设计匹配、报告哈希匹配，预检已从原始运行重算。没有删除或成功替换失败样本。

固定 seed 为：

```text
2026100801 2026100802 2026100803 2026100804 2026100805 2026100806 2026100807
2026100808 2026100809 2026100810 2026100811 2026100812 2026100813 2026100814
```

seed 固定 fixture，不控制 provider 的随机采样；14 是方案规定的最低样本数，不保证统计功效或等效性。

| 臂 | Agent 配额 | 单 Agent 可见调用配额 | 分解提示 |
|---|---:|---|---|
| `single` | 1 | 512 | 原公共任务提示 |
| `single-scaffolded` | 1 | 512 | 公共任务提示追加逐分片要求 |
| `independent-pool` | 16 | 各 32，总计 512 | 15 个独立候选分别负责分片 1–15，合并入口负责分片 16 |
| `native-team` | 16 | 各 32，总计 512 | 保留原 Harness team 分解流程 |
| `atn-adaptive` | 16 | 各 32，总计 512 | 保留 ATN 全机制分解流程 |

`single-scaffolded` 与 `single` 使用相同模型、系统提示、工具 schema、fixture、文档读取权限和预算。新增臂唯一的模型可见差别是用户任务提示末尾追加一段逐分片指令。运行器没有为该臂新增工具、自动分片调度器或中间结果存储能力；中间结果要求由模型通过既有对话和工具完成。

## 只读目录先决条件

准备阶段和执行阶段都在开始推理前执行只读目录检查，保存成功和失败记录。模型不可见或目录请求失败时，执行器写入 `infrastructure-*.json` 并停止，不启动模型尝试、不将其解释为架构失败。

| 检查 | 上海时间 | 状态 | 记录 |
|---|---|---|---|
| 初始检查 | 2026-10-08 09:43:43.698 | 目标模型可见 | `experiments/results/equal-budget-catalog-v3-initial-20261008.json` |
| 准备前检查 | 2026-10-08 09:52:33.859 | `available` | `.artifacts/equal-budget/20261008-v3/catalog-prepare.json` |
| 执行前检查 | 2026-10-08 09:53:04.004 | `available` | `.artifacts/equal-budget/20261008-v3/catalog-execute-1791424377760-da28a124-f6d6-46a6-9406-dea194ec40b6.json` |

这些检查均为 `readOnly=true`、`issuedModelCalls=0`。可见性只描述检查时刻，不承诺之后每次 provider 路由都成功。后续如果实际尝试出现零调用或异常，仍须保留该次记录。

## 两个预检闸门与报告项

V3 仅登记两个可行性闸门：

1. 15 个预检观察中至少一次精确完成。
2. 每个预检观察均有真实调用覆盖：`issuedModelCalls` 与 `metrics.totals.attempts` 相等，且同为正整数；脚本 adapter 记录不能充当真实模型证据。

实际预检保留 15/15 次、精确完成 11 次，15 次的两种调用计数全部一致且为正整数，状态为 `passed`。最终 70/70 次也全部满足真实调用覆盖，零调用 0 次、调用证据未知或矛盾 0 次。共记录 2555 次可见模型调用；这个总数不是 HTTP 请求数或费用。

在完整预检矩阵到齐前，状态保持 `pending`。矩阵重复或包含未登记项属于输入契约错误；源哈希、设计、模型与配额验证用于保证运行确实属于冻结实验，不是根据结果选择样本的额外闸门。V1/V2 冻结设计继续使用各自原规则，不追溯套用 V3。

以下均按臂进入报告，**不阻止 V3 主批次**：

- 截断的已知调用数和涉及运行数，以及截断覆盖未知项。
- 最大单次输出、余量及覆盖情况；无完整覆盖时，完整最大值和余量保持 `null`，已知下界另列。
- 正向事实流审计结果、审计缺口和未知覆盖。
- 总 token、峰值输入上下文、运行时间和协议开销中的未知值。

未知与失败分开记录。缺失审计或显式 `factFlowAudit.unknown=true` 计为未知审计，不计为已知审计失败。缺失 usage、未结算调用和缺少逐调用记录保持未知，不用零填充。已知 token 小计和已知峰值下界不能替代完整总量或完整峰值。

`issuedModelCalls=0` 且 attempts 为零的尝试单列为零调用；两计数缺失、不一致或不合法则列为 dispatch 未知。两类都保留在已尝试样本分母中，均不能写为模型推理失败；它们不能满足真实调用覆盖闸门。

主批次是否获准，必须从已验证的原始记录重算。手工改写 `preflight.json` 不会放行；已经开始但未完成的尝试保留为中断，不补跑一个成功样本替换它。排他锁阻止同时启动两个批次。

## 逐分片提示全文与哈希

追加指令原文如下，UTF-8 文本内容已经纳入冻结设计：

```text
Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.
Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.
Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.
After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.
```

每个 seed 的完整 `single-scaffolded` 用户任务提示是该 seed 的原 `single` 公共任务提示、两个换行和上述追加指令。下表文件包含完整文本，不仅是追加段；路径相对于执行根目录 `.artifacts/equal-budget/20261008-v3/`。`design.json` 的 `scaffoldPrompt.prompts` 同时冻结完整 `text`、`path` 和 `sha256`，加载设计时逐项验证。14 份同哈希的公开归档副本在 [experiments/results/equal-budget-v3-prompts-20261008/](../experiments/results/equal-budget-v3-prompts-20261008/)，文件名保持 `single-scaffolded-seed-<seed>.txt`。

| seed | 完整提示文件 | SHA-256 |
|---|---|---|
| 2026100801 | `prompts/single-scaffolded-seed-2026100801.txt` | `cdd842f66fa725b5c8812c19666c5e872bff8bf2f83edaa2425f980446cc61ab` |
| 2026100802 | `prompts/single-scaffolded-seed-2026100802.txt` | `ddf3412c4e2a462236f09bd7b363142feb334127285c6f9524bc8187817b385c` |
| 2026100803 | `prompts/single-scaffolded-seed-2026100803.txt` | `2a88c191241ce14e45ea2915e2cc4a29a9c4824859f1bd414e32d62a6201dfd7` |
| 2026100804 | `prompts/single-scaffolded-seed-2026100804.txt` | `0378d82496fdb2a42555f41d4dd3f3b5445e8d72acc6a6de571227628c4d8aa6` |
| 2026100805 | `prompts/single-scaffolded-seed-2026100805.txt` | `3861c40a4454f66a0a86538f0db225fc86b40321261b06ddd11ae2857e210e43` |
| 2026100806 | `prompts/single-scaffolded-seed-2026100806.txt` | `7bdc6ad89e29f2e410a9ec9ab01f6771d28f8b41e60c60bd669e6a3a34d58157` |
| 2026100807 | `prompts/single-scaffolded-seed-2026100807.txt` | `18ac9b36e08d1fd9a7f1cba7b9d6282273e0036debb2a67b86324f38f39390d1` |
| 2026100808 | `prompts/single-scaffolded-seed-2026100808.txt` | `43acd1705b4bc308588d2efc73cacbf32ee66d77fa890fc0c9600067e30b1772` |
| 2026100809 | `prompts/single-scaffolded-seed-2026100809.txt` | `f5865a6786d38d1499d08d872fa8ca2bad7c63a18702c7c8fe0fbb82a9ea2630` |
| 2026100810 | `prompts/single-scaffolded-seed-2026100810.txt` | `af9250c67ea0852e49e1c9c1bd972e4993903e2aa92b5ea84622b6adeea4f9bf` |
| 2026100811 | `prompts/single-scaffolded-seed-2026100811.txt` | `4bf13886af362e55f9eb7d1ae65147757db91e66ad980e467805eb6fee8ca0c8` |
| 2026100812 | `prompts/single-scaffolded-seed-2026100812.txt` | `62a624a8f3d935d36f034e5582774261740bd662d49b6c396da502059f572b4f` |
| 2026100813 | `prompts/single-scaffolded-seed-2026100813.txt` | `f14eca3fd85f0a8e8ebed75fa9bd18f869fc3806a6324f3a014100162600f6fd` |
| 2026100814 | `prompts/single-scaffolded-seed-2026100814.txt` | `52a588f6718b00b8f87826ff50dfe946ec33af47997b7f70936c39fbb5143ea4` |

每次实际运行另在自己的 `runs/<mode>-seed-<seed>/equal-budget-prompt.txt` 保存当次完整用户任务提示，`manifest.json` 和 `report.json` 用 `taskPrompt` 记录文件和哈希。提示在 provider 载入前落盘，因此 provider 初始化失败仍有提示证据。最终五臂报告已经逐 seed 列出完整提示与哈希；本节追加段不代替完整提示交付物。

## 实施入口与复核命令

V3 通过显式 `--round 11` 选择，旧默认仍对应 V2。以下准备命令是本轮入口说明；已存在的冻结目录不可重新准备或覆盖：

```powershell
npm run experiment:equal-budget -- --prepare --round 11 --orders-per-shard 10 --root .artifacts/equal-budget/20261008-v3
npm run experiment:equal-budget -- --execute --round 11 --root .artifacts/equal-budget/20261008-v3
```

执行期间不修改 `src/`、`experiments/`、`scripts/`、`package.json` 或 `package-lock.json` 中受冻结设计约束的源码。执行器在下一次尝试前重新核验全部源哈希；当前记录仅编辑文档。

| 验收命令 | 已实际观察的结果 | 日志 |
|---|---|---|
| `npm test` | 528 个后端测试和 8 个客户端测试通过；失败 0，跳过 0 | `.artifacts/equal-budget-v3-final-test.log` |
| `npm run typecheck` | 通过 | `.artifacts/equal-budget-v3-final-typecheck.log` |
| `npm run build` | 通过 | `.artifacts/equal-budget-v3-final-build.log` |
| `npm run smoke:profile` | 通过 | `.artifacts/equal-budget-v3-final-smoke.log` |
| `npm run pack:tarball` | 通过；包含最终 README 的 `dsh-atn-0.4.1.tgz`，98 个文件，285.6 kB；未发布 | `.artifacts/equal-budget-v3-final-pack.log` |

定向验证同时覆盖：`single` 与 `single-scaffolded` 去除唯一追加段后模型可见请求一致、单 Agent 配额一致、提示文件等于实际首次用户输入、未知 usage 保留、provider 失败时提示仍落盘、两个 V3 闸门、截断和审计缺口不设门、设计与提示篡改拒绝、旧 V1/V2 冻结设计兼容。

## 保留的项目语义

- 入口 Agent 由宿主持有；完成、停止、退休均不 `dispose` 入口。
- 网络记录仍是唯一原子持久化单元；检查和修改在同一 mutation 临界区内完成。
- 邻接边保持单向；出生谱系用于追溯，不自动提供通信边。
- 工具身份、发送者和投票者来自真实 live Agent。
- 同伴文本不构成人类授权；请求者评价不构成宿主验收。
- 同能力原则保持不变；拓扑约束信息可达性，不降低节点能力。
- `stepBudget` 与等预算配额计量可见模型调用，不能宣称为 token、HTTP 请求或费用上限。
- 正向事实流审计继续对全部真实运行执行；V3 改变的是审计缺口的闸门用途，不取消审计。
- 失败、超时、异常、中断、零调用及未知 usage 均保留。不得删除失败、补跑成功替换失败或挑选 seed。
- 不新增模型工具或 ATN 机制，不通过降低分片数或订单数规避阻塞。

第 10 轮 16×10 与 16×8 的冻结记录原样保留，既不合并为每臂 6 个同分布样本，也不混入本轮 14 个 seed 的统计。V3 的预检修正不重写第 10 轮的冻结闸门状态。第 10 轮 `single` 的失败不能直接记为 ATN 收益；新控制臂用于检查提示分解的混淆。

## 最终指标、未知与异常

正确率采用 Wilson 95% 区间；配对正确率采用 Tango 名义 95% 风险差区间、精确 McNemar 检验及十个臂对内 Holm 校正。登记的“可区分”同时要求完整配对、区间不含零、Holm p<0.05。连续指标给中位数、四分位数、次序统计量中位数 95% 区间与配对差。下表为全部样本的边际摘要，包含失败；完整报告另列成功和失败条件下的消耗。未知值不参与已知值中位数估计，也不填零。

| 臂 | 精确通过 | Wilson 95% | 墙钟中位数 ms [95% CI] | 墙钟已知/未知 |
|---|---:|---|---|---|
| `single` | 9/14（64.29%） | [38.76%, 83.66%] | 106075.5 [96924, 115778] | 14/0 |
| `single-scaffolded` | 13/14（92.86%） | [68.53%, 98.73%] | 119833.5 [101255, 143349] | 14/0 |
| `independent-pool` | 12/14（85.71%） | [60.06%, 95.99%] | 107953.5 [98091, 125399] | 14/0 |
| `native-team` | 14/14（100.00%） | [78.47%, 100.00%] | 204374.5 [151815, 334780] | 14/0 |
| `atn-adaptive` | 10/14（71.43%） | [45.35%, 88.28%] | 156955 [131179, 199185] | 14/0 |

| 臂 | 每次运行的峰值输入 token 中位数 [95% CI] | 完整 input+output token 中位数 [95% CI] | 两项各自已知/未知 |
|---|---|---|---|
| `single` | 9271.5 [6011, 11035] | 61678 [56601, 64117] | 14/0 |
| `single-scaffolded` | 3122 [2813, 3506] | 60129 [56325, 61867] | 14/0 |
| `independent-pool` | 10300 [7735, 11746] | 146152.5 [140729, 149790] | 14/0 |
| `native-team` | 11114.5 [8690, 14651] | 273407 [249728, 302140] | 12/2 |
| `atn-adaptive` | 14737 [12992, 33126] | 201362 [163848, 277558] | 10/4 |

输入峰值是单次调用的 `inputTokens` 最大值，不是累计对话长度或能力指标；该 usage 字段不含 cache，不能写成完整上下文负载。总 token 指 input+output，不另加已含于 output 的 reasoning，也不拿 provider 的 total 字段替代。native-team 的 2 次和 ATN 的 4 次完整消耗未知保留；它们的已知小计不能变成全批完整总消耗。

| 臂 | 实际调用合计 | 每运行调用中位数 [95% CI] | 已知/未知 | 已观察截断调用/运行 | 完整最大输出；余量 | 输出未知调用/截断判断未知调用 |
|---|---:|---|---|---|---|---|
| `single` | 109 | 7 [6, 10] | 14/0 | 1/1 | 8192；0% | 0/0 |
| `single-scaffolded` | 247 | 18 [17, 18] | 14/0 | 0/0 | 6580；19.68% | 0/0 |
| `independent-pool` | 517 | 36.5 [35, 40] | 14/0 | 0/0 | 8037；1.89% | 0/0 |
| `native-team` | 1011 | 71.5 [58, 90] | 14/0 | 5/4 | 未知；未知（已知最大输出8192） | 2/3 |
| `atn-adaptive` | 671 | 40.5 [32, 54] | 14/0 | 6/4 | 未知；未知（已知最大输出8192） | 6/8 |

截断合计至少 12 次，涉及至少 9 次运行；native-team 和 ATN 仍有截断判断未知，已观察计数不能解释成完整计数。上表余量由全臂最大单次输出直接计算；每运行余量分布的中位数、95% 区间和未知项见最终报告。余量不是可行性阈值，两臂的完整输出覆盖缺失不能用已知最大值补成确定余量。

| 臂 | 审计通过/有覆盖缺口/整项未知 | 有提交的正向完成证据 | 已知审计事实/提交事实 | 无提交运行 |
|---|---|---:|---:|---:|
| `single` | 14/0/0 | 12 | 192/192 | 2 |
| `single-scaffolded` | 14/0/0 | 14 | 224/224 | 0 |
| `independent-pool` | 14/0/0 | 14 | 224/224 | 0 |
| `native-team` | 9/5/0 | 9 | 173/224 | 0 |
| `atn-adaptive` | 11/3/0 | 8 | 145/176 | 3 |

审计布尔通过与算术正确率不同：无提交运行可以没有审计违例，但不提供正向完成证据；有提交但算错也可能具备完整证据流。native-team 的 5 次与 ATN 的 3 次有审计覆盖缺口，**这 8 次全部是精确完成运行**，表示部分来源见证未知，不是已证明没有读取事实、能力不足或作弊。完整运行矩阵不等于所有来源审计完整；全部审计继续报告，没有排除这些样本。

保留的 12 次未精确完成包括 7 次有效答案中的余额/总额校验失败，以及 5 次无提交；`single` 的一次错误答案由 `final-text` 结束，其余错误答案由 `submitted` 结束。请求异常共涉及 3 次运行：`single` 的 seed 2026100807 记录 1 个 `TRANSPORT`，ATN 的 seed 2026100801 记录 3 个 `TRANSPORT`，native-team 的 1 次运行记录 1 个 `TIMEOUT` 后仍精确完成。本轮没有零调用尝试或 `UNKNOWN_MODEL` 目录故障。上述异常和错误均留在分母中，不把所有未通过一律归因为模型推理或架构。

## 配对判读与终轮关闭

下表列出全部正确率臂对，单位 pp 为百分点；均为 14 个配对、无缺失，Holm 校正后全部未建立差异。

| A−B | 点估计 pp | Tango 名义 95% 区间 pp | Holm p |
|---|---:|---|---:|
| `single` − `single-scaffolded` | -28.57 | [-54.65, -0.89] | 1.000 |
| `single` − `independent-pool` | -21.43 | [-53.38, 16.56] | 1.000 |
| `single` − `native-team` | -35.71 | [-61.24, -6.49] | 0.625 |
| `single` − `atn-adaptive` | -7.14 | [-42.15, 29.94] | 1.000 |
| `single-scaffolded` − `independent-pool` | 7.14 | [-21.64, 35.36] | 1.000 |
| `single-scaffolded` − `native-team` | -7.14 | [-31.47, 15.93] | 1.000 |
| `single-scaffolded` − `atn-adaptive` | 21.43 | [-11.71, 50.55] | 1.000 |
| `independent-pool` − `native-team` | -14.29 | [-39.94, 10.32] | 1.000 |
| `independent-pool` − `atn-adaptive` | 14.29 | [-16.70, 43.27] | 1.000 |
| `native-team` − `atn-adaptive` | 28.57 | [0.89, 54.65] | 1.000 |

有的名义 95% 区间不含零，但仍未达到 Holm p<0.05，因此不能挑选这些区间宣布正确率优势。14 个 seed 不保证足够功效，没有预登记等效界限；“未建立差异”不能写成各臂等效、架构贡献为零或提示造成了改善。

三条预登记解读均按本轮实际区间填写：

| 预登记观察与条件性解释 | 本轮对应证据 | 实际状态 |
|---|---|---|
| scaffolded 与三个分布式臂无法区分；若成立，信号与提示结构解释相容，没有建立 ATN 独立贡献 | scaffolded−pool 为 +7.14pp [-21.64, 35.36]；−native 为 -7.14pp [-31.47, 15.93]；−ATN 为 +21.43pp [-11.71, 50.55]；三个 Holm p 均为1 | 与“未区分”观察模式相容。不能证明等效、提示因果或零架构效应 |
| scaffolded 与 single 无法区分，且二者都明显低于三个分布式臂；若成立，支持分布式结构独立贡献 | scaffolded−single 为 +28.57pp [0.89, 54.65]，Holm p=1；但两个单 Agent 都低于三个分布式臂的完整差异没有建立 | 未观察到完整模式；不能给出该独立贡献结论 |
| scaffolded 明显优于 single，但仍低于三个分布式臂；若成立，支持指令与结构的共同贡献 | scaffolded−single 未通过登记检验；scaffolded 低于所有三个分布式臂也未建立 | 未观察到完整模式；不能作两种贡献的因果分配 |

消耗维度有部分可区分关联，仍不能替代正确率结论。例如 scaffolded 相对 single 的峰值输入差中位数为 -6035 token，配对区间 [-7899, -2581]，Holm p=0.00122；相对 pool 的完整 input+output token 差中位数为 -85749，区间 [-93955, -80978]，Holm p=0.00122；相对 native 的墙钟差中位数为 -97141 ms，区间 [-226251, -29417]，Holm p=0.0146。scaffolded 与 single 的墙钟和总 token、与 ATN 的墙钟均未建立差异；涉及缺失 usage 的 native/ATN 峰值和总 token 臂对也未满足完整配对判据。其余全部指标的区间与不可区分项保留在最终报告及统计 JSON 中，不以更快或较少 token 推导架构因果优势。

**等预算研究线已在第 11 轮关闭。** 五臂 × 14 seed、16 分片 × 10 订单的已测结果没有建立 ATN 独立正确率优势，维持“无证据”结论；不设计第 12 轮换任务、换规模或挑 seed 寻求更有利结果。第 10 轮的失败不能单独记成 ATN 收益。全部 `causalClaim=false`。`0.4.1` 已发布，本轮不阻塞该发布；当前结果不触发以 ATN 优势为依据的 `0.5.0` 主张。

完整运行、统计、证据归档与 [README](../README.md) 同步已经完成，全部五条验收命令均有成功记录。最终打包产物为 `.artifacts/dsh-atn-0.4.1.tgz`；维持版本 `0.4.1`，本轮未执行 `npm publish` 或其他发布操作。
