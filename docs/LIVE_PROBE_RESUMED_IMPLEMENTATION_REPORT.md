# 真实探针恢复实施报告（2026-10-15）

用户要求在停止核验后推导严格下界并继续实验。本轮已完成条件化严格下界推导、真实 Harness 零网络延迟口径实测、带余量的离线规划门，以及指定 **dsh-agy / Gemini 3.8 Flash medium** 真实批次。计划 5 个原 seed，实际完成 5 个，两阶段答案通过 **0/5**。未启动 seed：无；批次停止标记：无。没有替换失败 seed。

## 下界与门的含义

完整证明、假设、源码入口和三组门输出见 [严格下界推导](LIVE_PROBE_STRICT_BOUND_DERIVATION.md)。冻结任务有 4 个不同的非入口当前证据持有者。在不猜测、不硬编码隐藏 proof、经本地读取和实际 mail 因果取证的假设下，每个至少一次读取决策、一次之后的证据返回决策，再加入口两阶段 checkpoint，得 **N ≥ 4×2+2=10**，最大单节点步数至少 2。这不是紧确最小值或充足预算。若不约束信息来源，验证器不能排除猜中答案，普遍下界只能保守写为至少 1 个模型响应。

60/8 保留为参考策略计数，**不再称为严格下界**。历史均值也不作为时间硬下界；本轮不声称 120 秒数学不可能完成。规划门在独立层面采用显式来源和余量：

~~~text
历史成功调用延迟：71 个 dispatch→finish 区间，均值 8143.30985915493 ms，向上取整 8144 ms
调用规划：max(10, ceil(60×1.125)) = 68
节点规划：max(2, ceil(8×1.125)) = 9
所需期限：ceil(68×8144/1 + 30000) = 583792 ms
~~~

原 120000 ms 条件在该规划下只缺期限；583792 ms 的充足对照被放行；选定并发作为调整轴的边界对照指出需并发 7。期限／并发是可替代调整轴，**标签是明确的修复策略，不是算术识别的唯一物理原因**。新 600000 ms 条件通过，余 16208 ms；调用上限余 28、节点步数余 3。原始算术见 [feasibility.json](execution-evidence/live-probe-resumed-20261015/feasibility.json)。

历史延迟来自上一批同路由、medium、输出 4096 的实际配对时间，排除 5 个取消调用，有幸存偏差；不包含全部准备／收尾，且当前负载可变。12.5% 动作／节点余量与 30 秒宿主预留为事先冻结的工程选择，不保证完成。新增标定调用 0。

## 冻结条件与派发保护

| 条件 | 上一批 | 本轮 |
| --- | --- | --- |
| provider / 插件 | agy / dsh-agy@0.4.4 | 相同 |
| 模型 / 档位 | gemini-3.8-flash-tiered / medium | 相同 |
| seed | 17 / 31 / 45 / 59 / 73 | 相同 |
| 节点 / 链长 | 8 / 2 | 相同 |
| 每节点步数 / 调用上限 | 12 / 96 | 相同 |
| 输出 / 已观测 token 准入阈值 | 4096 / 400000 | 相同 |
| provider 并发 / 阶段推进 | 1 / checkpoint-only | 相同 |
| 期限 | 120000 ms | **600000 ms** |

只改变期限，没有为了结果同时放宽并发、步数或调用上限。历史五臂是 48 步／节点、384 调用、600 秒，虽然期限相同，其预算仍不同，未并入同一比较。新 [plan.json](execution-evidence/live-probe-resumed-20261015/plan.json) 与原 plan 的差异由脚本逐项断言。

默认入口不执行模型，--execute 分支先过门才加载 provider／读取插件账户。缺少延迟来源、路由不符、规划不通过均在 mount 前拒绝。全部节点请求、prepared config 和逐次 dispatch 核对 agy／指定模型／medium／4096。插件自行读取原账户，无直接 HTTP 推理。实际调用证据见 [逐次派发](execution-evidence/live-probe-resumed-20261015/provider-calls.jsonl) 和 [执行日志](execution-evidence/live-probe-resumed-20261015/execution.txt)；元数据发现本身不冒充推理证据。

## 逐 seed 真实结果

| seed | phase 1 | phase 2 | runner / provider 调用 | 秒 | 最大节点步数 | 停止原因 | 清理 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 17 | 已提交未通过 | 未提交 | 46 / 46 | 398.871 | 12/12 | phase-2-quiescence | released |
| 31 | 未提交 | 未提交 | 34 / 34 | 350.055 | 11/12 | phase-1-quiescence | released |
| 45 | 已提交未通过 | 未提交 | 58 / 58 | 551.725 | 12/12 | phase-2-quiescence | released |
| 59 | 未提交 | 未提交 | 32 / 32 | 369.019 | 9/12 | phase-1-quiescence | released |
| 73 | 已提交未通过 | 未提交 | 54 / 54 | 439.584 | 12/12 | phase-2-quiescence | released |

合计 runner 准入 224 次、实际插件派发 224 次。本批两者相等，没有派发前取消的 attempt。这些计数不等于底层 HTTP 请求精确计数，插件内部路由和重试不由此穷尽。清理全部 released：是；errors 与 toolErrors 全为 0：否；未记录 RATE_LIMIT：是。逐 seed 错误码和错误数在 [summary.json](execution-evidence/live-probe-resumed-20261015/summary.json) 保留。

本批 seed 59 的最后一次入口调用记录 UPSTREAM、status=null，随后入口 turn/end=error，再进入 phase-1-quiescence。这是上游错误伴随的失败，不能只写成协议静默。其余 seed 的模型错误为 0；所有 seed 工具错误为 0，未记录限流，均释放资源。上一批 AGY 的 errors=0 正向记录仍保留，不冒充本批也全为 0。

- seed 17：[report](execution-evidence/live-probe-resumed-20261015/seed-17-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-17-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-17-events.jsonl)。
- seed 31：[report](execution-evidence/live-probe-resumed-20261015/seed-31-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-31-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-31-events.jsonl)。
- seed 45：[report](execution-evidence/live-probe-resumed-20261015/seed-45-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-45-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-45-events.jsonl)。
- seed 59：[report](execution-evidence/live-probe-resumed-20261015/seed-59-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-59-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-59-events.jsonl)。
- seed 73：[report](execution-evidence/live-probe-resumed-20261015/seed-73-report.json)、[timing](execution-evidence/live-probe-resumed-20261015/seed-73-timing.json)、[events](execution-evidence/live-probe-resumed-20261015/seed-73-events.jsonl)。

## 延迟口径与真实分解

确定性实测中，两个 attempt 的服务分别为 [0,100]、[100,200] ms，排队分别为 0、90，收尾均为 0；旧 modelDurationMs 为 290，服务和墙钟为 200。原 telemetry **累加已 settle attempt 的生命周期，包含排队／准备及收尾**；并行 attempt 的等待重叠使累计值可超过墙钟。成功、失败、取消只要在遥测关闭前 settle 均纳入，关闭后的未完成调用不回填。[实测输出](execution-evidence/live-probe-resumed-20261015/timing-proof.json)、[定向测试](execution-evidence/live-probe-resumed-20261015/targeted-tests.txt)。

新模块分开记录 entered、provider dispatch、provider settle 和 kernel settle，逐 attempt 精确断言 queue+service+cleanup=total。queue 包含派发前解析／准备及 FIFO 等待；取消前未派发的服务为 0。两层 wrapper 的观测边界可能相差毫秒，以下保留差值，不篡改旧度量口径。

| seed | queue ms | service ms | cleanup ms | 新 attempt 总和 ms | 旧 modelDurationMs | 边界差 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 17 | 1425401 | 398368 | 4 | 1823773 | 1823776 | 3 |
| 31 | 1146003 | 349576 | 6 | 1495585 | 1495586 | 1 |
| 45 | 2274333 | 551255 | 4 | 2825592 | 2825597 | 5 |
| 59 | 1411807 | 368517 | 9 | 1780333 | 1780336 | 3 |
| 73 | 1669922 | 439067 | 9 | 2108998 | 2109003 | 5 |

每个 seed 的服务区间均断言不重叠。本批 aborted attempt 为 0；service 总和仍包括失败调用已等待的区间，不将失败区间纳入成功调用服务均值。

## 逐 seed usage 与解释边界

括号为缺少该字段的调用数，known 只是部分观测：

| seed | input known（未知） | output known（未知） | cacheRead known（未知） | totalTokens |
| --- | ---: | ---: | ---: | --- |
| 17 | 341388（0 次未知） | 2064（0 次未知） | 64327（0 次未知） | 46 次未知 |
| 31 | 248837（0 次未知） | 1491（0 次未知） | 33800（0 次未知） | 34 次未知 |
| 45 | 436495（0 次未知） | 2917（0 次未知） | 199421（0 次未知） | 58 次未知 |
| 59 | 218009（1 次未知） | 1749（1 次未知） | 38445（1 次未知） | 32 次未知 |
| 73 | 401066（0 次未知） | 2555（0 次未知） | 112673（0 次未知） | 54 次未知 |

已知 input 合计 1645795、output 合计 10776。完整 total、reasoning 和 cacheWrite 按原始未知字段保留，**没有把 known=0 写成实际消耗 0**。400000 是已观测 totalTokens 准入阈值；若插件不完整上报 totalTokens，它不能代表精确 token 或费用硬上限。stepBudget 仍是单节点步数，不是 token、HTTP 或费用上限。费用与实际订阅消耗未测量。

seed 45 与 73 的已知输入已分别超过 400000。由于准入按上报 totalTokens 而其字段始终未知，该阈值没有阻止这些调用；不能宣称本批匹配了精确 400000 token 消耗预算。

上一批的逐 seed token 表、正向错误／释放记录和 Step 5 对照保留于 [停止报告第 4 节](LIVE_PROBE_FEASIBILITY_IMPLEMENTATION_REPORT.md)。两个不同 provider／模型在同样紧预算 12/96/4096/400000/120000 ms 下都失败，支持不能简单归因于选了一个弱模型；Step 5 还出现过 RATE_LIMIT，AGY 旧批没有记录到该错误。并发、入口与推理设置不同，不能证明预算是唯一原因或作受控能力比较。

原 runner report 的“五 arms”段落仍是通用模板，本轮实际只跑 adaptive。0/N 不作为模型能力、拓扑收益或速度结论。

## 门通过后的失败分析

- seed 17：至少一个节点到达 12 步；参考策略最多 8 步加余量得到的 9 步规划低估了真实局部需求，严格下界 2 不能替代需求估计；入口本身用满 12 步；phase 1 实际提交链长 1，冻结目标为 2；网络静默时未完成两阶段；加长墙钟不能保证协议继续推进；成功调用服务均值 8660.2 ms，高于规划输入 8144 ms；历史均值也偏乐观，但这不单独证明失败由延迟造成。
- seed 31：网络静默时未完成两阶段；加长墙钟不能保证协议继续推进；成功调用服务均值 10281.6 ms，高于规划输入 8144 ms；历史均值也偏乐观，但这不单独证明失败由延迟造成。
- seed 45：至少一个节点到达 12 步；参考策略最多 8 步加余量得到的 9 步规划低估了真实局部需求，严格下界 2 不能替代需求估计；入口本身用满 12 步；phase 1 实际提交链长 1，冻结目标为 2；网络静默时未完成两阶段；加长墙钟不能保证协议继续推进；成功调用服务均值 9504.4 ms，高于规划输入 8144 ms；历史均值也偏乐观，但这不单独证明失败由延迟造成。
- seed 59：网络静默时未完成两阶段；加长墙钟不能保证协议继续推进；成功调用服务均值 11132.6 ms，高于规划输入 8144 ms；历史均值也偏乐观，但这不单独证明失败由延迟造成；记录模型错误 1、工具错误 0，须连同原始报告解释；实际错误码 UPSTREAM，HTTP status 未知；不把上游错误归因为模型能力或唯一预算瓶颈。
- seed 73：至少一个节点到达 12 步；参考策略最多 8 步加余量得到的 9 步规划低估了真实局部需求，严格下界 2 不能替代需求估计；入口本身用满 12 步；phase 1 实际提交链长 1，冻结目标为 2；网络静默时未完成两阶段；加长墙钟不能保证协议继续推进。

没有替换、重跑失败 seed 或在运行中改变模型、档位和预算。必要下界成立不意味着实际需求等于下界；门通过后失败应回到上述实际步数、服务、协议和停止原因分析，不能把更多预算的需求再当作未经证明的唯一原因。

## 哈希与工程交付

固定的 **37 个旧源码哈希与 AGY 历史 plan 全部一致**；每个 seed 前复核。src/、旧 telemetry、旧设计参数与 sourceHashes 均未改写。新度量和门在新增模块内，其源码哈希以 extensionHashes 单独冻结并逐 seed 复核。旧失败对照副本仍可重放。原观察通道保持只读，参考运行仍为零模型。

新实验 wrapper 增加四时刻观测和可取消的 FIFO 排队，保留 provider 并发 1 及取消后不派发的约束；排队取消的 settle 记账时机可能与旧 tail 队列不同，不能把新旧延迟直接当作受控速度比较。本批没有派发前取消，此差异未产生额外真实派发。

- npm test：**558 runtime／集成 + 14 UI，全通过，零跳过**；新增 5 个有必要性的下界前提、门双向控制、派发前拒绝、排队分解和取消测试。未删除用例或降低既有断言。[test.txt](execution-evidence/live-probe-resumed-20261015/test.txt)
- npm run typecheck：退出 0；新增脚本另做显式 TypeScript 检查，退出 0。[typecheck.txt](execution-evidence/live-probe-resumed-20261015/typecheck.txt)、[script-typecheck.txt](execution-evidence/live-probe-resumed-20261015/script-typecheck.txt)
- npm run build：退出 0。[build.txt](execution-evidence/live-probe-resumed-20261015/build.txt)
- npm run pack:tarball：退出 0。[pack-tarball.txt](execution-evidence/live-probe-resumed-20261015/pack-tarball.txt)

README 与 docs/README 已链接推导及本报告。源码、测试和证据可本地复核；没有发布或推送。
