# 探针门分位修正与静默定位实施报告（2026-10-15）

**3 个 incorrect-proof（提交了错误答案）+ 2 个 submission-discipline（未提交）；5 个 seed 全部是义务仍未完成的活性静默。** 本轮模型调用 **0**，不读账号、不联网、不加载 provider、不重跑真实探针。

**若门在上批运行前使用本批可得的上偏延迟统计量，该配置会被拒绝。** p90 为 **23406 ms**，期限要求 **1621608 ms**；600000 ms 和 120000 ms 均只因期限不足拒绝。步数 **12 ≥9**、调用 **96 ≥68** 仍充足，这是规划判断而非完成保证。没有据此放宽任何运行预算。

## 无删失样本与独立分位原则

延迟从 [本批 provider-calls.jsonl](execution-evidence/live-probe-resumed-20261015/provider-calls.jsonl) 逐 call 配对 dispatch.at→finish.at；文件 SHA-256：`b4a531cc601f1a83c4087ad054a5713ba3a4d474c1c32b8e027e336235dfd731`。224 次 dispatch、224 个配对 finish、metrics attempts 合计 224、aborted 合计 0，无未配对或排除样本，删失状态 **uncensored**。finish 包含 221 stop、2 max-tokens、1 error，**无删失不等于全部成功**。每个来源报告的哈希和逐 seed 计数见 [重算 JSON](execution-evidence/probe-gate-quiescence-20261015/recomputation.json)。

原则（事先固定的服务覆盖政策，不按某配置的放行结果选分位）：**Service-level planning policy: cover 90% of observed individual service times using empirical nearest-rank p90, without fitting the policy to a desired admission outcome.** 分位算法为 nearest rank，即升序第 ceil(q×n) 个观测。p90 覆盖观测的单次服务时间分布；不是 68 次总运行的 90% 成功概率，也不是未来延迟上界。30 秒宿主预留与满并发利用假设继续明示。

上一批 SHA-256：`b87f69d308e437dd2717e2eee5dff049c89a939511d40584a01cef0316d0e781`，76 次中仅 71 个成功存活样本，5 个取消样本右删失；本批与上批**未合池**。

| 来源 | 样本/dispatch | 删失 | p50 | p75 | p90 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 本批 | 224/224 | uncensored | 5976 | 10838 | 23406 | 27584 |
| 上批（单列，未合池） | 71/76 | right-censored | 5214 | 12866 | 18488 | 20351 |

## 敏感性曲线与双向准入

固定公式 ceil(68L/1 +30000)，固定 12/96；表中每个放行都只覆盖该行标出的观测服务时间分位。所需期限边界是**纯计算正向对照，不是建议真实重跑条件**。

| 覆盖分位 | 延迟 ms | requiredDeadlineMs | 600000 ms | 120000 ms | 所需期限边界纯计算对照 |
| --- | --- | --- | --- | --- | --- |
| p50 | 5976 | 436368 | 放行 | 拒绝（仅期限不足） | 放行；少 1 ms 拒绝 |
| p75 | 10838 | 766984 | 拒绝（仅期限不足） | 拒绝（仅期限不足） | 放行；少 1 ms 拒绝 |
| p90 | 23406 | 1621608 | 拒绝（仅期限不足） | 拒绝（仅期限不足） | 放行；少 1 ms 拒绝 |
| p95 | 27584 | 1905712 | 拒绝（仅期限不足） | 拒绝（仅期限不足） | 放行；少 1 ms 拒绝 |

p50 会放行 600 秒，p75/p90/p95 会拒绝；并非把门改成一律拒绝。所有档位在自身期限边界放行，少 1 ms 时拒绝，沿用必要下界 10/最大单节点 ≥2 的条件性、无条件 ≥1，以及参考 60/8 与 12.5% 规划余量的区别。

## 原准入为什么偏松

brief 第 2.1 节四个展示值（按其整数口径）代回原门：

| 延迟输入 ms | 68L +30000 ms | 600000 ms |
| --- | --- | --- |
| 8144 | 583792 | 放行 |
| 8660 | 618880 | 拒绝 |
| 9504 | 676272 | 拒绝 |
| 10282 | 729176 | 拒绝 |
| 11133 | 787044 | 拒绝 |

原门以排除取消样本的**幸存调用均值** 8144 ms 放行，仅余 16208 ms；四个展示的实测值方向一致地翻转该判断。其偏松是**方向一致的选择偏差（幸存调用均值 + 排除取消样本）**的风险，不应当作无方向的随机误差忽略。均值本身也不表达尾部覆盖；分位政策解决覆盖含义，无法反推已取消调用的完整时长。本次跨批比较不能量化删失偏差，亦不能排除负载变化。

完整逐 seed dispatch→finish 均值如下，避免继续遗漏 seed 73：

| seed | dispatch→finish 均值 ms | 仅成功均值 ms |
| --- | --- | --- |
| 17 | 8659.826 | 8659.826 |
| 31 | 10281.471 | 10281.471 |
| 45 | 9504.293 | 9504.293 |
| 59 | 11516.000 | 11132.452 |
| 73 | 8130.722 | 8130.722 |

**纠正 brief 的范围**：四个展示值均拒绝成立；“五个实测值全部高于 8144”不成立，seed 73 的均值略低于 8144。provider finish 时间与 timing service settlement 边界的毫秒差异保留，不改写历史值。

## 静默与义务分开记录

| seed | 失败类别 | open / unresolved / queued | 入口已用/剩余步 | 入口终止 | 停止分类 |
| --- | --- | --- | --- | --- | --- |
| 17 | incorrect-proof | 7 / 9 / 0 | 12/0 | retired; blocked | quiescence-with-obligations-open |
| 31 | submission-discipline | 8 / 8 / 0 | 11/1 | active; max-tokens | quiescence-with-obligations-open |
| 45 | incorrect-proof | 5 / 7 / 0 | 12/0 | retired; completed | quiescence-with-obligations-open |
| 59 | submission-discipline | 7 / 7 / 0 | 9/3 | active; error | quiescence-with-obligations-open |
| 73 | incorrect-proof | 6 / 8 / 0 | 12/0 | retired; blocked | quiescence-with-obligations-open |

每条新停止记录同时包含原 stopReason、activity、obligations、checkpoint 的 submitted/passed 状态、checkpoint 时快照以及停止时任务状态。活性原因是 unchanged runner 在 tick 后复查无 running 持续 ≥200 ms；逐 turn/end 流佐证最后无运行，**没有把该流伪称为独立采集的 tick 日志**。原 quiescence 字符串不表示协议完成。分类计数：quiescence-with-obligations-open **5**，quiescence-with-obligations-complete **0**。确定性负向对照构造 open/unresolved/mail 均 0、两 checkpoint 已完成，分类为 complete；四种单独未完成条件仍归 open。

**停止时 open 数分别为 7/8/5/7/6**；brief 的 6–8 来自 checkpoint 时刻，不能替代最终停止快照。另记录 unreachable 等未完成任务，避免把持有者退休后的任务漏掉。任务表逐行给 holder、requester、status、holderStepsAtCreation、停止时 active/retired/failed、stepsUsed、剩余步和证据 seq，见 [完整表](execution-evidence/probe-gate-quiescence-20261015/analysis-tables.md)。所有 holder 可判定，无未知状态，无需补采集或改 src/。

进一步定位：五 seed 合计 **33 个 open 任务的最后 task.state 全部早于首个 step/start**，且 holderStepsAtCreation=0；它们来自预置 start/spawn 的初始角色分配，不是 33 个尚未返回的新增事实请求。重算 JSON taskOriginAudit 逐条留存 sequence，冻结 provisionShifting 源码给出预置任务的创建依据。新发出的事实请求另有 completed 任务与 result mail。因而“open 多、邮件空”包含了长期角色义务未收口；它不能单独证明证据请求的持有者失联或都在等待资源。真正未完成的两阶段 proof 仍由 checkpoint 状态独立判定。

多数未完成任务持有者仍 active、已发布且不 running；三个退休入口留下不可达任务。seed 31 入口仍 active、11/12 步，turn/end=max-tokens；seed 59 入口仍 active、9/12 步，turn/end=error，保留 UPSTREAM 失败。只有 17/45/73 入口退休并用满 12 步。因而“全部入口步数耗尽导致静默”不成立。现有证据定位到任务未完成但没有下一次推进的协议停滞，并保留输出截断/上游失败两种停止机制；观察共现不证明预算、发现查询与静默之间的单一因果关系。

## 工具映射与发现假设检验

每个 seed 的别名独立验证：tool-1=read_evidence、tool-2=atn_status、tool-3=atn_send；有 checkpoint 的 seed 中 tool-4=submit_checkpoint。工具 1/4 是实验工具，工具 2/3 是 ATN 工具；没有把所有工具都误称为 ATN 原生工具。

依据为**既有持久化 session.v4.jsonl 的具名 tool/call**：先按首个 turn/start 的精确 time/turn 唯一连接 session 别名，再按 session/time/turn/step 唯一连接 tool.start。全部 170 个工具调用逐次吻合，无猜测。已归档 [脱敏身份投影](execution-evidence/probe-gate-quiescence-20261015/tool-identities.json)，含 40 个来源 session 文件 SHA-256、原 seq、工具名、参数键名和事件 seq；无参数值、提示词或回答正文。复提取脚本 scripts/extract-probe-tool-evidence.ts 仅读已有 sessions。CI 使用归档投影，无需被忽略的 .artifacts 目录。

独立互证：status 的 review/rewire 区间内有 task.requester-feedback/topology.rewire；send 区间内有 task.state 与 queued mail。read_evidence 与 submit_checkpoint 使用具名 session 调用及冻结 runner 中各自 schema/执行入口核对。每条映射及每次调用来源见完整表/JSON。别名与原节点 ID 不直接混用。

| seed | 只读发现 | 协议（含 review/checkpoint） | 换边 | 其余（本地读取/无工具） | 步数合计 | atn_status 工具调用 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | 4 | 5 | 1 | 2 | 12 | 7 |
| 31 | 5 | 4 | 1 | 1 | 11 | 8 |
| 45 | 4 | 5 | 0 | 3 | 12 | 7 |
| 59 | 2 | 4 | 0 | 3 | 9 | 5 |
| 73 | 4 | 5 | 1 | 2 | 12 | 7 |

逐步表保留批量工具；独占步数归类优先级 protocol > rewire > discovery > other，避免一模型步有多个工具时重复计费。review/checkpoint 算协议，本地 read_evidence 和无工具步算其余。seed 45/59 的 rewire 与协议工具同一步，因此独占换边步为 0，但逐工具列表明确保留换边，不能读成没有换边调用。

**第 2.3 节假设：不成立。** tool-2 确为 atn_status，但不全是只读发现。seed 17 的 7 次 status = 4 次只读查询 +2 次 review +1 次 rewire；入口发现只占 4/12（33.3%）。其只读查询数高于每个其它节点的 1–2 次，但发现步占比并非一致更高（node-6 为 2/4=50%）；完整表给逐节点和步数归一化对照。不能据此称发现抖动显著主导预算或证明其造成静默。

## Token 阈值选择 (b)：从有效预算维度去列

本轮实际落地 **b-remove-from-effective-budget**：门和 driver 输出显式列出 nodeSteps/callCap/deadline 三个有效预算维度，totalTokens 标记 unavailable/active=false。4096 每请求输出上限单列，不是整批 token/费用上限。历史 400000 字段留在冻结 runner 和归档条件内用于复核，但**不计为有效预算约束**；没有改写历史判定或归档源码。由于 totalTokens 在 224 次调用中全部未知，该阈值始终没有保护作用。选择 (b) 保留 37 个哈希并避免把不含推理 token 的部分观测误称精确总量。

| seed | 已知 input | 已知 output | 已知 cacheRead | total 未知调用 | input >400000 |
| --- | --- | --- | --- | --- | --- |
| 17 | 341388 | 2064 | 64327 | 46 | 否 |
| 31 | 248837 | 1491 | 33800 | 34 | 否 |
| 45 | 436495 | 2917 | 199421 | 58 | 是 |
| 59 | 218009 | 1749 | 38445 | 32 | 否 |
| 73 | 401066 | 2555 | 112673 | 54 | 是 |

seed 45/73 **已知输入单独超过 400000**；若按已知用量提供有效的准入阈值，两次运行会在后续准入处被截断。现有阈值未阻止此事，故不能声称这两次匹配 400000 token 预算。stepBudget 仍只限制单节点步数，既不是 token、HTTP 请求也不是费用上限。

## 工程验证与边界

37 个固定源码哈希逐个重新计算，与前后两批 plan 及五个 seed report/manifest 均一致；原 sourceHashes 未重写。完整清单见重算 JSON hashes。src/ 未修改、工具 schema 未修改、观察通道仍只读，参考运行语义未变。本轮仅改变新增规划门的延迟输入/覆盖输出并增加离线分析；旧 driver 的当前 600 秒配置现在被 p90 门拒绝，不会派发。

新增 7 个测试覆盖配对防删失、样本独立、敏感性双向对照、义务完成负向对照、持有者、具名映射、离线依赖边界；既有测试未删改、未降低断言。测试与命令最终结果见 [验证清单](execution-evidence/probe-gate-quiescence-20261015/validation.json)，没有把未执行项算作通过。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| npm test | 0 | 565 runtime/integration +14 UI passed; zero failures/skips; unchanged baseline assertions |
| npm run typecheck | 0 | Main and client test TypeScript checks passed |
| tsc --noEmit --strict (4 changed/new scripts) | 0 | recompute-probe-gate, extract-probe-tool-evidence, live-probe-feasibility, run-live-probe-agy passed |
| npm run build | 0 | Runtime types and client bundle built |
| npm run pack:tarball | 0 | dsh-atn-0.5.0.tgz generated; no publish |
| node --import tsx/esm scripts/recompute-probe-gate.ts | 0 | Offline zero-model; 224 samples, p90=23406 ms; 600000/120000 both rejected for deadline alone; 37 source hashes unchanged |
| node --import tsx/esm scripts/live-probe-feasibility.ts | 0 | Updated history input; exact deadline and concurrency arithmetic controls generated offline |
| node --import tsx/esm scripts/run-live-probe-agy.ts | 0 | execute=false; all five 600-second gates refuse; only three effective budget dimensions |
| node --import tsx/esm scripts/extract-probe-tool-evidence.ts | 0 | 170 tool calls uniquely joined to 40 existing persisted sessions; no new collection or model calls |
| node --import tsx/esm --test --test-reporter=tap tests/integration/result-outcome.test.ts | 0 | All five unchanged existing cases pass in isolation after first full-suite subprocess failure |
| git diff --exit-code -- src | 0 | No src modifications |
| git diff --check | 0 | No whitespace errors in tracked changes |
| node --import tsx/esm --test tests/unit/probe-gate-quiescence.test.ts | 0 | All 7 final analysis, token-dimension and report-content checks passed |
| node --import tsx/esm --test --test-reporter=tap tests/integration/knowledge-feedback.test.ts | 0 | All 8 unchanged knowledge-feedback tests passed in isolation |

回归过程保留两个既有不稳定结果：result-outcome.test.ts 子进程异常退出、无断言详情（first-test-process-failure.txt，原因未确定），独立 5 项通过；另一次全量 KNOWLEDGE-02 在前后快照间 mail-10 从 queued 变 delivered（knowledge-mail-race-full-suite.txt），独立文件 8 项通过。完整回归曾通过，最终命令结果按上表及原始日志记录；不据重跑消除对时序不稳定的记录。未删除测试或修改既有断言来绕过失败，src/ 保持不变。

复算：`node --import tsx/esm scripts/recompute-probe-gate.ts`；独立新输出目录可作为位置参数传入。脚本只读仓库证据和固定源码，生成 JSON 与表，零账号、零网络、零 provider。额外命令 npm test、npm run typecheck、npm run build、npm run pack:tarball 的输出均留在本轮证据目录。README 与 docs/README 同步链接本报告。

本轮未进入 NEXT_SCOPE_DECISION_RECORD 四项新范围，也未提高预算或运行真实模型；未提交、推送或发布。
