# 可测性恢复：校准记录（2026-10-05）

当前源码 v4 的零付费脚本扫描共 45 次，**45 次两阶段正确**；预先规定的最低配置“链长 2、每节点 20 步”取得 **5/5**。这是固定策略通过真实 Harness、ATN 工具、证据 ACL、白板计量与持久化的可行性结果，**不代表真实模型已达到 4/5，也不支持拓扑收益解释**。真实免费模型的独立重复由本轮实施报告另行记录；其输出、时间和观测 token 条件与这里不同，不能混合计入同一准入闸门。

独立真实验证现已完成：当前源码 Space Bunny fixed 在显式链长 2、32 步、256 调用、4096 输出、4m 观测 token 阈值及 600 秒条件下 **5/5**；详见[最终源码复验](MEASURABILITY_RECOVERY_REPORT.md#最终源码-v4-的复验)。脚本与真实模型各用自己的五次结果；真实输入已知均值 1961.60、覆盖 435/462，未知不补零，稳定降本结论仍受限。

所有 45 次明细、每调用固定字节与输入 usage、错误、源码 SHA-256 及产物路径/hash 保存于 [校准索引](../experiments/results/measurability-calibration-20261005.json)。完整日志在 `.artifacts/experiments/measurability-calibration-20261005-v4/`：每次含 `manifest.json`、`report.json`、`events.jsonl`、`summary.json`、原始会话和 storage，共 585 个产物文件。导出时验证全部运行记录的源码 hash 与当前 25 个被测源文件一致。

历史版本全部保留：最早目录 `measurability-calibration-20261005` 完成 45 次后发现多合同边证据排序问题，添加了 `SUPERSEDED.json`；[v2 独立索引](../experiments/results/measurability-calibration-20261005-v2.json) 保存 38/45、最低 2/20 为 4/5；[v3 独立索引](../experiments/results/measurability-calibration-20261005-v3.json) 保存 38/45、最低 2/20 为 5/5。v2→v3 只将显式观测 token 参数允许上界从 2m 扩至 8m，默认 400k 未变；v3→v4 修复宿主证据选择器中只有 baseline 的合同提前返回、遮蔽更早双侧合同的问题。旧索引明确区分导出时 hash 匹配与当前源码已变，未在版本间挑选成功项或把旧运行并入新准入。

执行命令：

```powershell
node --import tsx/esm experiments/shifting-evidence-calibration.ts --out .artifacts/experiments/measurability-calibration-20261005-v4
```

扫描在首个样本前写入 `plan.json`：链长 2/3/4 × 每节点 20/32/48 步，每个配置固定使用种子 17、31、45、59、73；8 节点、出度 2、调用上限分别为 160/256/384、输出上限 1536、超时 30000 ms、观测 token 门槛 400000，`autoAdvance=false`。按“链长升序，再按步数升序”选择首个至少 80% 成功的配置，保留全部失败。实验显式参数不改变 runtime 默认预算。`stepBudget` 计模型步骤，不能解释为 token、HTTP 请求或费用上限。

| 链长 | 每节点步数 | 两阶段正确 | 阶段 1 提交 | 阶段 2 提交 |
| --- | ---: | ---: | ---: | ---: |
| 2 | 20 | 5/5 | 5/5 | 5/5 |
| 2 | 32 | 5/5 | 5/5 | 5/5 |
| 2 | 48 | 5/5 | 5/5 | 5/5 |
| 3 | 20 | 5/5 | 5/5 | 5/5 |
| 3 | 32 | 5/5 | 5/5 | 5/5 |
| 3 | 48 | 5/5 | 5/5 | 5/5 |
| 4 | 20 | 5/5 | 5/5 | 5/5 |
| 4 | 32 | 5/5 | 5/5 | 5/5 |
| 4 | 48 | 5/5 | 5/5 | 5/5 |

脚本适配器不读取宿主题库或 oracle；每个节点只从自己的 `read_evidence` 工具结果取本地事实，通过 `atn_board` 发布；入口从实际白板读取结果拼接链，并调用 `submit_checkpoint`。策略程序由人编写，虽然调用真实模型工具和 Agent loop，但未调用任何外部模型。脚本生成决策不产生 provider token，因此全部 `meanInputTokensPerCall=null`，没有把字节或脚本调用数伪装成 token。程序决策是确定性的；运行调度和 Windows 文件系统错误仍会影响完成率。

选定配置的五次结果全部如下；“交互倍数/字节倍数”分母是同 seed、同节点/步数/调用边界的固定环形收集参考策略。该参考执行真实 task/result 邮件，不是最优成本证明。白板与邮件都计入交互与字节，宿主 phase 通知另列。

| seed | 阶段1提交/正确 | 阶段2提交/正确 | 脚本调用 | ATN交互 | ATN字节 | 交互倍数 | 字节倍数 |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 17 | 是/是 | 是/是 | 51 | 25 | 20229 | 0.7143 | 0.8126 |
| 31 | 是/是 | 是/是 | 51 | 25 | 20235 | 0.7143 | 0.7710 |
| 45 | 是/是 | 是/是 | 51 | 25 | 20237 | 0.7143 | 0.7659 |
| 59 | 是/是 | 是/是 | 51 | 25 | 20233 | 0.7143 | 0.7755 |
| 73 | 是/是 | 是/是 | 51 | 25 | 20231 | 0.7143 | 0.7799 |

所有五次都未自动推进、cleanup=`released`、固定协议成本为 7160 字节。首阶段未提交的运行仍明确计为“提交纪律失败”；当原始会话还记录了 storage rename `EPERM` 时，该标签描述提交观测，不能据此归咎于模型纪律或推断链不可解。

本次 v4 扫描没有工具错误或 storage EPERM，45 次都完成。仍保留 31 条 `shifting-ended`：它们发生在完成第二阶段后，来自测量停止的 admission 拒绝，索引独立分类为 `measurement-ended`，未伪称 provider 错误。全部脚本调用数均为 51。

历史错误未被删除：v2 有 7 个失败运行、全扫描 14 条 storage EPERM；v3 也有 7 个失败运行、全扫描 17 条 EPERM，其中 `turn/end` error 10 条、`tool/result` error 7 条。它们均为 `.tmp → storage/atn_networks.json` 的 Windows rename 异常，逐事件位置、失败配置、提交状态、成功运行中出现的错误均在各自索引。脚本未实现板写入错误恢复。本次未观察到 EPERM，不能据此宣称底层文件系统问题已被修复，更不能将完成率差值归因于证据选择器修复。

报告分别保存 `phase1Submitted`、`phase1Correct`、`phase2Submitted`、`phase2Correct`。主指标仍为两阶段正确性的合取；第一阶段未提交单列 `submissionDisciplineFailure`，只有已提交但错误的证明才计 `solvingFailure`。当前扫描两个阶段提交均为 45/45，提交纪律失败 0 次，已提交错误证明 0 次；未提交不能被解释为已解出，也不能被解释为已提交的证明错误。

固定成本按实际注册 schema 序列化为 UTF-8 测得：

| 测量 | 实施前 | 实施后 | 减少 |
| --- | ---: | ---: | ---: |
| 共同规则 `systemPromptBytes` | 1521 | 969 | 36.29% |
| ATN工具 `toolSchemaBytes` | 9322 | 6191 | 33.59% |
| `fixedContextBytes` | 10843 | 7160 | 33.97% |
| 模型工具 / 规则行数 | 9 / 9 | 6 / 6 | 已达数量约束 |

此固定字节范围是 ATN 共同规则与全部 ATN schema，不包含实验额外的 `read_evidence` / `submit_checkpoint` schema、实验提示词、历史消息或 provider 封装；不是整个模型请求大小。原始定义和成本快照保留在 `.artifacts/measurability/baseline-context.json` 与 `after-context.json`。

旧 24 次真实运行的 2211 个调用输入 usage 已逐调用提取至 `.artifacts/measurability/baseline-input-distributions.json`，包含原始 event 文件 SHA-256。旧第二批 Space Bunny fixed 的 98 次调用中，94 次已知、4 次未知：已知 inputTokens 总计 199492，已知调用均值 2122.2553，完整 `meanInputTokensPerCall=null`。第一批同模型 fixed 为 71/75 已知，已知均值 1893.6620。第一批 DeepSeek fixed 46/46 已知，完整均值 1624.2609。`inputTokens` 沿用 adapter 口径、不含 cache；未知不补零。新真实模型输入均值须使用独立 live 运行的 `callCosts` 与覆盖率计算，脚本扫描不能证明真实输入 token 降幅。

实验 CLI 仍保留 `adaptive`、`fixed`、`no-feedback`、`no-board` 四臂；默认每臂至少 5 次，`--repeats` 小于 5 被拒绝。报告只在同模型、同执行类型、相同预算/任务条件及相同源码 hash 下检查 fixed ≥4/5；所有比较臂各 ≥5 次且来自真实 provider 才开放描述性拓扑比较。脚本记录始终 `mayInterpretTopology=false`，没有使用“非 insufficient-evidence 的换边”作为能力指标，也没有因果声明。

新增校验覆盖链长参数、配置对应步数提示、默认不自动推进及 opt-in 标志、阶段 2 正确而阶段 1 缺失的纪律分类、四臂准入闸门、白板元数据 ACL、逐调用 usage 与 unknown 保留。24 个实验相关测试通过，输出在 `.artifacts/measurability/experiment-tests.log`；其中后续将旧两阶段时序 fixture 改为确定性 barrier，保持“运行中 worker 必须看到第二阶段”的原断言，单文件 4 项再次通过。新增 4.4/4.5 断言是修改后验证，没有保留修改前测试失败记录；不能称已完成逐项 red→green 证明。全仓测试、构建、打包、profile smoke 与真实模型结果由本轮总实施报告记录。

v3 显式预算扩展有单独 red→green：旧实现拒绝显式 4m，失败原因为 `Invalid bounded observedTokenLimit`；仅修改验证允许上界至 8m 后，同一测试通过真实 runner 的 4m 条件，确认 manifest/report 写出 4m、超过 8m 被拒绝。该测试还用独立 CLI dry-run 验证默认 400000、16 steps、128 calls、2048 output、`autoAdvance=false` 均未更改。证据为 `.artifacts/measurability/observed-token-bound-red.log`、`observed-token-bound-green.log`；完整 shifting integration 文件 5 项通过，输出 `shifting-evidence-tests-v3.log`。本节脚本扫描仍使用原始 400k/20–48 步扫描条件，没有因为真实模型需要更大显式预算而改变脚本默认或题库。
