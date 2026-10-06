# 四臂比较实施报告（2026-10-06）

执行依据：[FOUR_ARM_COMPARISON_BRIEF.md](FOUR_ARM_COMPARISON_BRIEF.md)。本轮绑定确证完成：零模型参考 adaptive **5/5**、fixed **0/5**；违规计数准入已删除，正向事实审计完成。新同源码 DeepSeek 独立探针两阶段正确 **3/5**，低于 ≥4/5，故未执行四臂比较，也未补跑或替换失败样本。没有拓扑收益或因果结论。

最终结果：[参考对照](../experiments/results/four-arm-reference-20261006.json)、[新探针独立核对](../experiments/results/four-arm-probe-20261006.json)、[本轮事实审计](../experiments/results/four-arm-fact-flow-20261006.json)、[准入与成本](../experiments/results/four-arm-admission-and-cost-20261006.json)。

## 绑定确证

[两种拓扑参考对照](../experiments/results/four-arm-reference-20261006.json)与[结构证明](../experiments/results/four-arm-proof-20261006.json)覆盖 seed 17、31、45、59、73。参考使用真实 Harness、同一 revision 3 fixture、相同所有者 ACL、单向边和预算：8 节点、出度 2、链长 2、每节点 48 步、全网 384 次动作准入、600 秒期限。参考策略根据公开 discovery 元数据找持有者，只用实际 task/result 构造答案；隐藏 fixture 仅在执行结束后的评分、证明和取得事实核验中使用。

| 拓扑 | 两阶段正确 | 每 seed 取得的必需事实 | 入口步数 | 模型调用 |
|---|---:|---:|---:|---:|
| adaptive | 5/5 | 4/4 | 27/48 | 0 |
| fixed | 0/5 | 0/4 | 10/48 | 0 |

五次 adaptive 参考共 95 次通信交互、53,072 字节、135 入口步；fixed 参考共 55 次交互、44,892 字节、50 入口步。各 seed 的消息数、精确取得事实、不可达公开持有者、逐节点动作和两个阶段结果均落盘。adaptive 每次 19 条消息，fixed 每次 11 条消息；两者都没有白板读写，消息均实际 delivered。

fixed 仍能从初始邻居取得旧根副本，但当前根所有者不在其出边集合。没有读取缺失当前事实或伪造答案。参考诊断显式访问第二阶段 fixture，即使第一阶段无法提交；该诊断推进单独记录为 `reference-diagnostic-phase-2`，不算作一次真实任务成功，也不改变真实运行仅由 phase 1 checkpoint 推进的条件。

固定参考缺少必需事实、自适应参考在相同预算下取得全部事实并正确完成，绑定确证成立。固定臂的不可完成由任务设计与直连 ACL 决定，不能表述为拓扑收益。

## 判据与正向审计

删除活动实现中的 `probeRealInterceptions`、`comparisonRealInterceptions` 和以违规出现为前提的强制生效闸门。拒绝记录仅保留作描述性遥测与原始记录一致性核对。强制生效改用逐 seed 构造性参考对照，汇总时重新核验 fixture 证明、参考取得的精确事实、源码与预算。

`topology-binding-audit.ts` 对每条实际提交事实核对：精确 key/proof/document 与终端字段、fixture 所有者、真实请求者／持有者、JSON 请求、实际 result、提交前成功交付。请求时的 entry 出边通过网络原子分配的顺序 ID 重放，不靠可能同毫秒的时间戳猜测换边顺序。所有权和出处审计与答案正确性独立；未提交运行没有声称的事实，审计为空但完成结果仍为失败。

审计失败的真实运行保留并列出，不计入比较臂的重复数或效果统计。独立汇总同时核对实际 Session 中的 checkpoint 调用、节点工具 schema、模型路由、权限、步骤、所有者读取与结果，以及 durable 网络。

[历史正向审计](../experiments/results/four-arm-historical-fact-flow-20261006.json)保留原始报告哈希与旧源码身份：此前 1 次不完整批次、5 次初始完整探针和 5 次最终探针共 11 次，34 条已提交事实全部通过；未提交及失败原样保留，未新增模型调用。历史源码与本轮不同，因此历史 4/5 不用于新比较准入。

新增确定性测试覆盖全部五个 seed 的两种拓扑参考，以及未知来源、错误所有者、非直连、queued、提交后交付、晚发生的换边、伪造事实、缺失参考、参考成功 fixed／失败 adaptive、预算不匹配和零模型调用分母。零拦截且正向审计通过可以通过准入；零拦截且审计失败不能通过。固定失败或与非固定控制臂成绩相同时，收益主张不成立。

## 真实实验条件与状态

实际 Desktop 已导入的 `dsh-opencode-go` → `deepseek-v4.1-flash`，通过父 profile 的 `prepareCall` 和 installed agent-loop 身份桥接；原 profile 写回重定向到 scratch。排除 LongCat。

全部真实运行保持：8 节点、链长 2、出度 2、48 步／节点、384 次全网调用准入、4096 输出 token／调用、800 万已观测 token 准入阈值、600 秒期限、自动推进关闭。没有提高预算或修改生产默认值；步骤不等于 token、HTTP 请求或费用上限。新源码 30 个文件归档于 `.artifacts/four-arm/source/`。

先在 `.artifacts/experiments/four-arm-deepseek-probe-20261006/` 运行五次独立 adaptive 探针。须达到两阶段正确 ≥4/5、最大节点步骤 ≤80%、换边至少一次且全部成功、结构证明／参考／正向审计通过。然后才在全新目录执行 adaptive、fixed、no-feedback、no-board 各五次，相同配对 seed。比较自身必须有 rejected，不能借探针的 rejected。

五次新探针在同一 30 文件源码、配置与模型下完成，全部原始 Session 与 durable 网络核对通过，全部 `cleanup=released`。两阶段正确 3/5，phase 1 提交／正确 4/5，phase 2 提交／正确 3/5。

| Seed | Phase 1 | Phase 2 | 最大节点步数 | 换边尝试／成功／拦截 | accepted／rejected | 模型调用 |
|---|---|---|---:|---|---|---:|
| 17 | 正确 | 正确 | 29/48 | 5/5/0 | 4/2 | 86 |
| 31 | 正确 | 未提交 | 16/48 | 2/2/0 | 3/0 | 68 |
| 45 | 正确 | 正确 | 25/48 | 5/5/0 | 6/0 | 82 |
| 59 | 正确 | 正确 | 30/48 | 4/4/0 | 4/2 | 87 |
| 73 | 未提交 | 未提交 | 14/48 | 2/2/0 | 3/1 | 48 |
| 合计 | 4/5 | 3/5 | 最大 **62.50%** | **18/18/0** | **20/5** | **371** |

全部 18 次换边前都有成功只读 status，同列表、未结算均为 0。真实 `evidence-not-owned` 拒绝为 0，未用于准入。seed 31 以 `phase-2-quiescence`、seed 73 以 `phase-1-quiescence` 结束；缺少提交没有改记为已提交错误。保留的工具错误为 seed 31／73 各一次 `other-tool-error`，seed 59 一次 `extra-transport-fields`；原始结果与完整计量均在运行目录和最终 JSON 中。

本轮 14 条已提交事实的正向审计全部通过。加上之前的 11 次历史执行，共 16 次真实运行、48 条已提交事实完成审计；旧样本、失败和未提交全部保留，旧源码成绩未借用于新准入。

第一载体在 seed 17 完成后退出，未留下 observer 完成记录；原因未确定。该样本已提交的完整 report、Session、provider trace 与网络数据独立核对通过。没有重新执行 seed 17。改用隐藏的 `Start-Process -Wait` 及独立 stdout/stderr 文件后，从原计划继续四个未执行 seed；`.artifacts/four-arm/resume-profile.ts` 只核对并继续缺失单元，直接调用相同原始 runner／adapter，不修改实验源码、任务、预算或条件。`resume.json` 保存保留 runId 和四个缺失单元，`samplesReexecuted=0 / extraSeeds=0`。续跑 observer 完整结束，exit 0；前后原 Desktop 的三个配置文件哈希一致。原中断记录、两个 bootstrap 和续跑日志保留于 `.artifacts/four-arm/`。

对实际最终数据调用 `assertTopologyComparisonPreflight` 被能力闸门拒绝。逐条状态如下：

| 前置／最终条件 | 状态 |
|---|---|
| 4.1 构造性绑定确证 | **通过**：五 seed adaptive 5/5、fixed 0/5，取得事实完整／缺失 |
| 每个计划 seed 的结构证明及重算 | **通过**：均需 4 个不同持有者直连边，大于出度 2，固定不可达 |
| 同模型／配置／源码独立 adaptive ≥4/5 且 ≤80% 步 | **未满足能力**：3/5；余量通过，最大 62.50% |
| 可发现性、正向事实流 | **通过**：18/18 成功换边；五次 rawAudit 通过、14 条提交事实可追溯 |
| 四臂各 ≥5、同配对 seed、各节点余量 | **未验证**：准入阻止执行，各臂 0 次 |
| 比较数据自身非零 rejected | **未验证**：无比较数据；探针 5 条 rejected 未借用 |

新探针 `homogeneous=true / eligibleModel=true / liveProvider=true`；能力失败不是模型未授权、来源不匹配或换边被拦截。历史 28 文件源码的 4/5 不能代替本轮 30 文件源码的 3/5。`mayInterpretTopology=false / causalClaim=false / benefitClaim=not-supported`。

## 成本口径

每次报告记录模型调用、ATN 消息／白板交互与传输字节、入口步数，并与同 seed、同拓扑构造性参考对照。fixed 用 fixed 参考；三个允许换边的臂用 adaptive 参考。构造性参考是一个可执行策略，不宣称最优。

参考模型调用为 0，真实调用／0 的倍数未定义，记录 `multiple=null`、`status=undefined-zero-reference`，同时给出真实调用数和 0 次参考调用。交互、字节与入口步骤给出正常倍数。fixed 参考本身未完成，两种策略执行的工作量不同，其成本倍数须与该限制一起读。ATN 计量不含宿主 kickoff／phase 通知，这些在运行报告中单列；未知 token usage、失败和异常不能记为零。

完整新探针的五次总成本（包含两次失败）相对五次 adaptive 参考：

| 项目 | 真实探针 | 同拓扑参考 | 倍数 |
|---|---:|---:|---:|
| 模型调用 | 371 | 0 | **未定义**，分母 0 |
| ATN 协议交互 | 191 | 95 | 2.0105× |
| ATN 传输字节 | 89,459 | 53,072 | 1.6856× |
| 入口步数 | 114 | 135 | 0.8444× |

入口步数小于参考包含两个提前停止的失败执行，不能解释为完成任务所需步骤减少。参考五次均完整完成，真实探针只完成三次。逐 seed 成本也保留于运行报告和[准入与成本结果](../experiments/results/four-arm-admission-and-cost-20261006.json)。

| 比较臂 | 实际次数 | 同拓扑参考 | 调用／交互／字节／入口步数倍数 |
|---|---:|---|---|
| adaptive | 0 | adaptive | 未测：能力准入未通过 |
| fixed | 0 | fixed | 未测：能力准入未通过 |
| no-feedback | 0 | adaptive | 未测：能力准入未通过 |
| no-board | 0 | adaptive | 未测：能力准入未通过 |

这些比较字段在 JSON 中为 `execution=not-executed / metrics=null / costMultiples=null`，没有用探针替代 adaptive 比较臂。已知输入和总 token usage 没有未知调用，但 cache read 有 2 次、cache write 有 371 次未知；参考资费估计有 2 次未知调用。全部未知保留，不能记为零或实际账单。成本倍数只表示相对构造性参考的模型协调开销，不能充当拓扑收益。

## 验证与交付记录

| 命令 | 实际结果 | 输出 |
|---|---|---|
| npm test | 434 runtime／集成 + 8 UI，通过，0 跳过 | `.artifacts/four-arm/npm-test.txt` |
| npm run typecheck | exit 0 | `.artifacts/four-arm/typecheck.txt` |
| npm run build | exit 0 | `.artifacts/four-arm/build.txt` |
| npm run pack:tarball | exit 0；98 文件 | `.artifacts/four-arm/pack.txt` |
| npm run smoke:profile | exit 0，真实临时 profile | `.artifacts/four-arm/smoke-profile.txt` |

首次完整回归为 433/434，既有 TELEMETRY-08 在拒绝校验快照间遇到后台邮件从 queued 变为 delivered。失败输出保留于 `.artifacts/four-arm/npm-test-delivery-race.txt`。测试在取无副作用基线前显式 `tick()` 并等待节点空闲；完整记录相等与事件数相等断言保留，未删测试或降低强度。该文件单独 10/10 后，完整 `npm test` 434+8 全通过。

最终 README 已纳入重新打包和 profile smoke 验证；旧输出保留为 `pack-initial.txt / smoke-profile-initial.txt`。相关源码、代码和测试、上述结果 JSON 与本报告构成本轮交付。四臂成绩、比较 rejected、比较余量和各臂成本未测，原因均是新同源码 adaptive 能力准入不足；没有通过补跑、提高预算或使用旧探针跳过该条件。

离线复核（不调用模型）：

```text
npm run experiment:binding-reference
npm run experiment:topology-proof -- --out experiments/results/four-arm-proof-20261006.json
node --import tsx/esm scripts/summarize-topology-binding.mjs --probe .artifacts/experiments/four-arm-deepseek-probe-20261006 --bootstrap .artifacts/four-arm/desktop-probe-resume-20261006 --out experiments/results/four-arm-probe-20261006.json
node --import tsx/esm scripts/audit-fact-flow.mjs --batches .artifacts/experiments/four-arm-deepseek-probe-20261006 --out experiments/results/four-arm-fact-flow-20261006.json
node --import tsx/esm scripts/report-four-arm.mjs --probe .artifacts/experiments/four-arm-deepseek-probe-20261006 --audit experiments/results/four-arm-probe-20261006.json --reference experiments/results/four-arm-reference-20261006.json
```
