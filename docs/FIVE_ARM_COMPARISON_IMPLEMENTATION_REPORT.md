# 五臂比较修订方案实施报告（2026-10-06）

执行 [修订方案](FOUR_ARM_COMPARISON_REVISED_BRIEF.md)。五臂各 5 次，共 25/25 次真实 Desktop 导入模型运行已完成；独立原始审计 全部通过。adaptive 两阶段完成 3/5 (60.00%) [23.07%, 88.24%]。主指标为完成运行的模型调用数；失败消耗另列。`mayInterpretTopology=true`，`causalClaim=false`，收益主张为 `not-supported`。

本轮没有增加重复数、提高预算或替换失败样本。旧 ≥4/5 能力门槛已删除；比较直接执行，比较结束后仅以 adaptive 至少一次两阶段完成判断是否有可比信号。换边／拦截／rejected／80% 步数余量均为诊断，不决定比较准入。身份、同源码／模型／预算、配对 seed、构造性绑定及正向事实流仍须核验。

## 设计与实际执行

模型为历史探针中实际完成过任务的 `deepseek-v4.1-flash`，经实际 Desktop 的 `dsh-opencode-go` → prepareCall 与 installed agent-loop 身份桥接；没有直接 HTTP 推理。LongCat 明确排除。旧探针仅用于模型选择，不借作本轮同源码能力估计。

配对 seed 固定为 17、31、45、59、73；8 节点、链长 2，48 步／节点、384 次全网可观测调用准入、4096 输出 token／调用、800 万已观测 token 准入阈值、600 秒／次；autoAdvance=false。各臂完全相同，只有 fixed-wide 的出度上限为 4，其他臂为 2。stepBudget 不是 token、HTTP 请求或费用上限。源码在运行前冻结，所有 manifest 哈希一致；生产默认值未修改。

原 Desktop profile 完整性：前后哈希一致；载体完整结束：是。原始 Session、storage、工具及 provider 事件保留在 `.artifacts/experiments/five-arm-deepseek-comparison-20261006/`。设计、源码快照、配置及命令日志在 `.artifacts/five-arm/`。

## 固定出度 4 的策略与零模型参考

选边函数仅接收运行时公开 live node ID，按可追溯的出生顺序排列；这些身份可通过有界 atn_status(query="*") 发现。每个节点一次性选择循环偏移 [-1,+1,+2,+3]，入口 peers 对应 slot [7,1,2,3]。选择发生在模型调用／证据读取之前，不输入 seed、fixture、任何阶段信息或文档。纯函数无 fixture/scenario 导入；静态 AST 测试核查唯一参数及数据来源。所有节点禁止主动换边，实际发送 ACL 还将自动补边限制在初始静态集合内。

| Seed | adaptive 必需事实／入口步／消息 | fixed 必需事实／入口步／消息 | fixed-wide 必需事实／入口步／消息 | fixed-wide 两阶段完成 |
|---|---|---|---|---|
| 17 | 4/4 / 27 / 19 | 0/4 / 10 / 11 | 1/4 / 13 / 13 | 否 |
| 31 | 4/4 / 27 / 19 | 0/4 / 10 / 11 | 0/4 / 10 / 11 | 否 |
| 45 | 4/4 / 27 / 19 | 0/4 / 10 / 11 | 1/4 / 13 / 13 | 否 |
| 59 | 4/4 / 27 / 19 | 0/4 / 10 / 11 | 2/4 / 16 / 15 | 否 |
| 73 | 4/4 / 27 / 19 | 0/4 / 10 / 11 | 2/4 / 16 / 15 | 否 |

以上三种参考均为零模型调用，通过真实 runtime、同一所有权 ACL 和实际 task/result，公开元数据选持有者，已收到事实构造答案。静态参考为诊断访问第二阶段，即使第一阶段没有提交；这种宿主推进不计真实完成。adaptive 每次 0 调用、27 入口步、19 消息，未经最优性证明。

fixed 的不可完成源于四个不同必需持有者超出度二；fixed-wide 的失败源于本次公开静态策略遗漏必需持有者，属于任务设计与选边策略的后果。度四的必需持有者并集本身可被一个预知 fixture 的静态邻域覆盖，因此不能宣称所有度四静态图都结构上不可解，也不能把这两臂失败写成自适应收益。

## 完成率、功效与效率

完成率用 [Wilson 95% 区间](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)，随每个完成／提交率输出功效声明。在 n=5 下，约 60 个百分点以下的效果不可靠区分。当前设计更严格：五对 seed 的双侧 [精确 McNemar 检验](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html) 即使全部五个差异同向也为 p=2/2⁵=0.0625；alpha=0.05、目标功效 80% 下，[0,100] 个百分点内无可达到的最小可检出效应（JSON 为 null 并注明不可达到，不伪造有限阈值）。十个臂对预先采用 Holm 校正。边际区间重叠不等于等效，分离也不能代替配对检验。

连续指标报告算术均值及双侧 Student t 95% 区间，只计两阶段都正确且正向事实审计通过的运行。零完成时没有效率估计；单次完成不能估计方差／区间。t 区间依赖独立 seed 与均值近似正态，小样本仅作描述，允许数学下界为负，不将其解释为负消耗。成功条件造成选择偏差，不能把成功样本均值直接写成全任务速度收益。

数值核对：3/5 的 Wilson 95% 区间为 [23.07%,88.24%]，4/5 为 [37.55%,96.38%]；两者重叠。构造性参考对每个脚本动作调用 admitStep，真实模型一步可执行多个工具；入口步倍数只比较这一既定计量口径，不证明某个执行者最优。

| 臂 | 完成率及 Wilson 95% 区间 | 完成运行模型调用均值 [95% CI] | ATN 交互均值 [95% CI] | 传输字节均值 [95% CI] | 入口步均值 [95% CI] |
|---|---|---|---|---|---|
| adaptive | 3/5 (60.00%) [23.07%, 88.24%] | 82.00 [77.70, 86.30] | 42.33 [40.90, 43.77] | 17593.33 [16190.20, 18996.47] | 25.67 [22.80, 28.54] |
| fixed | 0/5 (0.00%) [0.00%, 43.45%] | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） |
| fixed-wide | 0/5 (0.00%) [0.00%, 43.45%] | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） |
| no-feedback | 5/5 (100.00%) [56.55%, 100.00%] | 82.00 [79.52, 84.48] | 41.80 [38.97, 44.63] | 19774.60 [16362.64, 23186.56] | 25.20 [23.58, 26.82] |
| no-board | 3/5 (60.00%) [23.07%, 88.24%] | 73.33 [67.60, 79.07] | 26.00 [26.00, 26.00] | 11287.33 [11284.46, 11290.20] | 24.67 [19.50, 29.84] |

## 失败消耗与协议诊断

| 臂 | 失败数 | 失败调用总计／均值 [95% CI] | 失败交互总计 | 失败字节总计 | accepted / rejected | 换边尝试 / 成功 / 拦截 / 同列表 / 未结算 | 最大节点步数占比 |
|---|---|---|---|---|---|---|---|
| adaptive | 2 | 114.00 / 57.00 [-260.66, 374.66] | 67.00 | 28991.00 | 17 / 8 | 18 / 18 / 0 / 0 / 0 | 56.25% |
| fixed | 5 | 180.00 / 36.00 [33.68, 38.32] | 124.00 | 70559.00 | 6 / 2 | 5 / 0 / 5 / 0 / 0 | 20.83% |
| fixed-wide | 5 | 211.00 / 42.20 [23.50, 60.90] | 137.00 | 71237.00 | 6 / 3 | 4 / 0 / 4 / 0 / 0 | 29.17% |
| no-feedback | 0 | — / —（无完成／已知观测） | — | — | 0 / 0 | 22 / 22 / 0 / 0 / 0 | 56.25% |
| no-board | 2 | 98.00 / 49.00 [-179.71, 277.71] | 38.00 | 19655.00 | 18 / 5 | 18 / 18 / 0 / 0 / 0 | 56.25% |

accepted/rejected 是所有实际已评价 task 的请求者本地计数，初始化回执也可能被评价；它们不等于取得的必需事实数、宿主正确率或人类授权。

调用计数来自实际全网准入，不依赖 token usage。未知 token／cache／费用不记为零；knownTotal 只是有覆盖部分，knownCalls、unknownCalls、缺失运行计数分列。宿主启动／阶段通知另计；ATN 字节包括实际邮件及白板操作，不代表全部模型上下文字节。费用是目录参考价估计，不能写成订阅账单。

| 臂 | 成功／失败 total-token usage 未知调用 | 成功／失败 input usage 未知调用 | 成功／失败 cache-read usage 未知调用 | 成功／失败费用未知调用 |
|---|---|---|---|---|
| adaptive | 0 / 0 | 0 / 0 | 1 / 4 | 1 / 4 |
| fixed | 0 / 0 | 0 / 0 | 0 / 1 | 0 / 1 |
| fixed-wide | 0 / 0 | 0 / 0 | 0 / 3 | 0 / 3 |
| no-feedback | 0 / 0 | 0 / 0 | 1 / 0 | 1 / 0 |
| no-board | 0 / 0 | 0 / 0 | 1 / 0 | 1 / 0 |

cacheWriteTokens：已知调用 0；未知调用 1479。缺失部分保持未知。
reasoningTokens：已知调用 0；未知调用 1479。缺失部分保持未知。

## 相对同拓扑构造性参考的连续指标倍数

模型调用基线为 0，所有模型调用倍数均为未定义；报告实际调用均值，不写成 Infinity。以下倍数以每个完成样本对应的同 seed、同拓扑参考计算，再报告均值和区间。没有完整参考的静态臂不能当作完整任务效率基线。

| 臂 | 完成样本数 | ATN 交互倍数 [95% CI] | 传输字节倍数 [95% CI] | 入口步倍数 [95% CI] | 模型调用倍数 |
|---|---|---|---|---|---|
| adaptive | 3 | 2.23 [2.15, 2.30] | 1.66 [1.53, 1.79] | 0.95 [0.84, 1.06] | 未定义（参考为 0） |
| fixed | 0 | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） | 未定义（参考为 0） |
| fixed-wide | 0 | —（无完成／已知观测） | —（无完成／已知观测） | —（无完成／已知观测） | 未定义（参考为 0） |
| no-feedback | 5 | 2.20 [2.05, 2.35] | 1.86 [1.54, 2.18] | 0.93 [0.87, 0.99] | 未定义（参考为 0） |
| no-board | 3 | 1.37 [1.37, 1.37] | 1.06 [1.06, 1.06] | 0.91 [0.72, 1.11] | 未定义（参考为 0） |

## 哪些差异不可区分

| 臂对 | 配对 n | A 独有成功 / B 独有成功 | 双侧精确 p / Holm p | 完成率差异 | 共同完成数 | 共同完成的调用差 A−B [95% CI] |
|---|---|---|---|---|---|---|
| adaptive vs fixed | 5 | 3 / 0 | 0.2500 / 1.0000 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| adaptive vs fixed-wide | 5 | 3 / 0 | 0.2500 / 1.0000 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| adaptive vs no-feedback | 5 | 0 / 2 | 0.5000 / 1.0000 | 本样本量不可区分 | 3 | 0.00 [-2.48, 2.48] |
| adaptive vs no-board | 5 | 2 / 2 | 1.0000 / 1.0000 | 本样本量不可区分 | 1 | 12.00 （单次，无可估计区间） |
| fixed vs fixed-wide | 5 | 0 / 0 | 1.0000 / 1.0000 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| fixed vs no-feedback | 5 | 0 / 5 | 0.0625 / 0.6250 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| fixed vs no-board | 5 | 0 / 3 | 0.2500 / 1.0000 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| fixed-wide vs no-feedback | 5 | 0 / 5 | 0.0625 / 0.6250 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| fixed-wide vs no-board | 5 | 0 / 3 | 0.2500 / 1.0000 | 本样本量不可区分 | 0 | —（无完成／已知观测） |
| no-feedback vs no-board | 5 | 2 / 0 | 0.5000 / 1.0000 | 本样本量不可区分 | 3 | 9.67 [2.08, 17.26] |

完成率不可区分项：adaptive vs fixed；adaptive vs fixed-wide；adaptive vs no-feedback；adaptive vs no-board；fixed vs fixed-wide；fixed vs no-feedback；fixed vs no-board；fixed-wide vs no-feedback；fixed-wide vs no-board；no-feedback vs no-board。共同完成样本不足或调用差区间包含零时，连续效率差异也不可区分；没有共同完成的臂对没有可比较的效率信号。即使条件效率区间不包含零，也只描述共同完成样本，不是总体收益或因果结论。

连续调用差区间含零，不可区分：adaptive vs no-feedback。
无法估计配对效率区间：adaptive vs fixed；adaptive vs fixed-wide；adaptive vs no-board；fixed vs fixed-wide；fixed vs no-feedback；fixed vs no-board；fixed-wide vs no-feedback；fixed-wide vs no-board。
共同完成样本中的名义连续区间不含零：no-feedback vs no-board（no-board 调用较少）。

连续臂对区间是未作多重校正的名义 95% Student t 区间，仅描述共同完成样本；完成率检验的 Holm 校正不能借给这些连续区间，也不据此提出总体收益。

允许的结论：在拓扑绑定的任务上，可换边臂能够完成，其余臂结果见报告；本样本量不足以区分上列完成率臂对。 adaptive 必须相对 fixed-wide、no-feedback、no-board 全部具备一致且超出区间／配对检验的优势才可提出收益；本轮收益主张 不成立，全部 causalClaim=false。

## 逐次运行与保留的异常

| Seed | 臂 | Phase 1 提交／正确 | Phase 2 提交／正确 | 调用 | 入口步 | 终止原因／失败类型 | LLM finish-error 记录数 | 原始工具错误条数 |
|---|---|---|---|---|---|---|---|---|
| 17 | adaptive | false / false | false / false | 32 | 5 | phase-1-quiescence / submission-discipline | 0 | 1 |
| 17 | fixed | false / false | false / false | 37 | 10 | phase-1-quiescence / submission-discipline | 0 | 3 |
| 17 | fixed-wide | false / false | false / false | 35 | 7 | phase-1-quiescence / submission-discipline | 0 | 2 |
| 17 | no-feedback | true / true | true / true | 81 | 25 | phase-2-submitted / none | 0 | 1 |
| 17 | no-board | true / true | true / true | 72 | 24 | phase-2-submitted / none | 0 | 0 |
| 31 | adaptive | true / true | true / true | 84 | 25 | phase-2-submitted / none | 0 | 0 |
| 31 | fixed | false / false | false / false | 34 | 6 | phase-1-quiescence / submission-discipline | 0 | 1 |
| 31 | fixed-wide | false / false | false / false | 34 | 9 | phase-1-quiescence / submission-discipline | 0 | 4 |
| 31 | no-feedback | true / true | true / true | 85 | 27 | phase-2-submitted / none | 0 | 1 |
| 31 | no-board | true / true | true / true | 72 | 23 | phase-2-submitted / none | 0 | 1 |
| 45 | adaptive | true / true | false / false | 82 | 21 | phase-2-quiescence / phase-2-not-submitted | 0 | 1 |
| 45 | fixed | false / false | false / false | 34 | 7 | phase-1-quiescence / submission-discipline | 0 | 2 |
| 45 | fixed-wide | false / false | false / false | 38 | 10 | phase-1-quiescence / submission-discipline | 0 | 2 |
| 45 | no-feedback | true / true | true / true | 83 | 26 | phase-2-submitted / none | 0 | 0 |
| 45 | no-board | true / true | true / true | 76 | 27 | phase-2-submitted / none | 0 | 0 |
| 59 | adaptive | true / true | true / true | 81 | 25 | phase-2-submitted / none | 0 | 1 |
| 59 | fixed | false / false | false / false | 38 | 9 | phase-1-quiescence / submission-discipline | 0 | 2 |
| 59 | fixed-wide | false / false | false / false | 35 | 4 | phase-1-quiescence / submission-discipline | 0 | 0 |
| 59 | no-feedback | true / true | true / true | 81 | 24 | phase-2-submitted / none | 0 | 0 |
| 59 | no-board | false / false | false / false | 31 | 4 | phase-1-quiescence / submission-discipline | 0 | 0 |
| 73 | adaptive | true / true | true / true | 81 | 27 | phase-2-submitted / none | 0 | 1 |
| 73 | fixed | false / false | false / false | 37 | 6 | phase-1-quiescence / submission-discipline | 0 | 3 |
| 73 | fixed-wide | true / true | false / false | 69 | 14 | phase-2-quiescence / phase-2-not-submitted | 0 | 4 |
| 73 | no-feedback | true / true | true / true | 80 | 24 | phase-2-submitted / none | 0 | 1 |
| 73 | no-board | true / true | false / false | 67 | 17 | phase-2-quiescence / phase-2-not-submitted | 0 | 0 |

LLM finish-error 记录 0；遥测 errors / aborted / incomplete 为 0 / 0 / 0；导入适配器 thrown 事件 0（可能包含宿主取消，不能全部当作 provider 连接失败）。详细原始计数均保留。

正向事实流审计覆盖全部 25 次真实运行、50 条实际提交事实；未提交样本无 asserted facts，仍是失败完成。另独立核对实际 live 身份、单向请求时直连边、精确所有者、实际 task/result、提交前交付、本地读取 ACL、所有节点模型／工具 schema／权限、持久化换边与计数、源码和节点步数。原始工具错误分类、未知 usage、失败／超时／收尾状态都在 JSON 保留。

## 完成标准与边界

| 命令 | 本轮实际结果 | 保留输出 |
|---|---|---|
| npm test | 通过（exit 0）；439 runtime/integration + 8 UI; 0 failures, 0 skipped | .artifacts/five-arm/npm-test.txt |
| npm run typecheck | 通过（exit 0） | .artifacts/five-arm/typecheck.txt |
| npm run build | 通过（exit 0） | .artifacts/five-arm/build.txt |
| npm run pack:tarball | 通过（exit 0）；dsh-atn-0.4.0.tgz; 98 files; package 300.1 kB / unpacked 1.4 MB | .artifacts/five-arm/pack.txt |
| npm run smoke:profile | 通过（exit 0）；8 profile checks passed; 183 existing rows unchanged; preset/child tools verified; partial PROFILE-03 | .artifacts/five-arm/smoke-profile.txt |

旧测试没有删除；与旧成功率／违规计数准入矛盾的断言按修订方案改为区间及诊断，并新增同源码比较身份、缺失遥测、不可达到功效、成功／失败分离、纯公开选边输入和 fixed-wide 实际 runtime／ACL 对照断言。入口宿主所有权、原子网络 mutation、单向边、真实工具身份、授权边界、白板作者／版本／分页／计量及同能力语义未改。

已完成：删除小样本点估计准入；fixed-wide 零模型参考及公开策略证明；成功条件连续主指标和失败消耗分离；25 次五臂比较及全体正向审计；完成率区间／设计功效／十对不可区分项；README 和本报告更新。未完成或未获支持：总体速度收益、独立自适应收益、因果估计与更大样本确认，本轮均不宣称成立。

复核命令（后两条只重算，不发起模型调用）：

```text
npm run experiment:five-arm-reference
node --import tsx/esm scripts/summarize-topology-binding.mjs --comparison .artifacts/experiments/five-arm-deepseek-comparison-20261006 --comparison-bootstrap .artifacts/five-arm/desktop-comparison-20261006 --out experiments/results/five-arm-comparison-20261006.json
npm run experiment:five-arm-report
```

数据：[五臂原始独立核对与区间](../experiments/results/five-arm-comparison-20261006.json)、[三拓扑构造性参考](../experiments/results/five-arm-reference-20261006.json)。本地真实启动使用已有 Electron Node carrier 与冻结配置；重新启动会创建新样本，不能把额外成功替换本轮失败。
