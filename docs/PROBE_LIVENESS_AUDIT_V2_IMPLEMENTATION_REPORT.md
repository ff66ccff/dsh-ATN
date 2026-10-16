# 探针静默活性审计 V2 实施报告

本轮保持历史实验路由 **dsh-agy / gemini-3.8-flash-tiered / medium**，离线重审 seed 17/31/45/59/73。**真实模型调用 0、账号读取 0、联网 0、未加载已安装的 AGY/provider 插件。** 故障对照只使用现有 scripted adapter 与真实 Harness 内核。

**完整历史审计不能仅凭干净 CI 检出重放，采用 brief 4.6(b)。** 需要原实验未跟踪的 **40 个 session.v4.jsonl + 5 个 storage/atn_networks.json**；完整路径、哈希来源、获取方式和仓库输入列在 [audit.json 的 replay](execution-evidence/probe-liveness-audit-v2-20261015/audit.json)。这些文件应从原批次保留/恢复，不能用新模型调用生成另一批记录代替。新 checkout 可运行语义表和故障对照测试，并验证已归档审计输出；这不等于重算原始历史。

## 结果

五个 seed 均为 **no-wake-eligible-work**。60 封 delivered 邮件全部唯一关联到包含它的具体输入步及模型请求；另外 1 封邮件（seed 45 / mail-15）发往已经 retired 的入口，真实经历 queued→undeliverable，计为不可达，未计缺陷。五个静默快照均无飞行中 step、model 或 turn。该结论只说明当前证据没有尚欠的输入/请求/收据链条，**不表示任务完成，也不证明模型正确利用了输入**。

| seed | normal-receipt | unreachable | 缺陷 | attempts（逐节点之和） | open | 全部未完成 | 飞行中 | 二值判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 17 | 11 | 0 | 0 | 46 | 7 | 9 | 无 | no-wake-eligible-work |
| 31 | 11 | 0 | 0 | 34 | 8 | 8 | 无 | no-wake-eligible-work |
| 45 | 14 | 1 | 0 | 58 | 5 | 7 | 无 | no-wake-eligible-work |
| 59 | 12 | 0 | 0 | 32 | 7 | 7 | 无 | no-wake-eligible-work |
| 73 | 12 | 0 | 0 | 54 | 6 | 8 | 无 | no-wake-eligible-work |

逐邮件生命周期、每个判定的支撑 sequence、40 个节点末次动作、39 个未完成任务见 [完整明细表](execution-evidence/probe-liveness-audit-v2-20261015/analysis-tables.md) 与 [机器证据](execution-evidence/probe-liveness-audit-v2-20261015/audit.json)。各 seed model.start/model.end 数量与 metrics.attempts 相等；逐节点 model.end 计数之和分别为 46/34/58/32/54，共 224。

## 语义闸门与可达性

先完成 [事件语义表](PROBE_LIVENESS_EVENT_SEMANTICS_V2.md)，覆盖 queued/delivered、step/start/end、model.start/end、turn/start/end、task.state、node.state、tool.start/end，逐条列明类别、相对时序、sequence 可靠性、替代锚点、代码位置及来源可信边界。脚本先建立语义 gate，保存代码哈希，再运行真实故障对照，最后才连接历史并输出 seed 判定。[semantics-gate.json](execution-evidence/probe-liveness-audit-v2-20261015/semantics-gate.json) 和测试固定这一顺序；未完成语义表时分类器拒绝执行。

queued 是持久推送义务的起点，真正 wake 是 `send(..., true)`；运行中则 inject。step/start 在 preStep 接受输入之后、user/message 之前。delivered 是 flush 覆盖输入之后的收据，**其 sequence 不是输入发生时间的可靠代理**。model.start 是观察到的 llm/stream attempt 开始，不能冒充 HTTP 派发；model.end.status 与 finishReason 分列，completed/max-tokens 不能被丢失。

缺陷类别先通过故障注入证明可达，未伪造遥测序列。实现见 [对照内核](../tests/fixtures/probe-liveness-controls.ts)，实测见 [controls.json](execution-evidence/probe-liveness-audit-v2-20261015/controls.json)：

| 对照 | 注入位置/真实进入的状态 | 分类 | 判定 |
| --- | --- | --- | --- |
| 正常同一步延迟 | 用流屏障保持输入步运行；断言该步期间收据提交，之后释放屏障并等待 idle | normal-receipt (a)，非缺陷 | no-wake-eligible-work |
| 请求缺失 | 在真实 buildRequest 调用的 session.deriveMessages 投影处抛错；输入已写入并持久 flush，step/end/turn/end 已结束，同一步没有 model.start，delivered 已提交；再 tick 也不创建该步请求 | input-without-model (b) | mechanism-gap |
| 收据缺失 | 对真实 sessions.flush 注入 false；已有唯一输入和模型尝试，driver idle，tick 重试后仍 queued；撤销注入后独立 flush 历史，outbox 仍 queued | receipt-missing (c) | mechanism-gap |
| retired 接收者 | 真实终止状态、真实 enqueue 和 deliverMail；无输入，返回 undeliverable | unreachable，非缺陷 | no-wake-eligible-work |
| failed 接收者 | failNode 后真实 enqueue 和 deliverMail；无输入，返回 undeliverable | unreachable，非缺陷 | no-wake-eligible-work |

收据故障撤销后，额外 tick 将 queued 修复为 delivered，**新增模型请求数为 0**。因此 (c) 是尚欠确认，并不意味着应再唤醒模型。两个 mechanism-gap 对照表示注入故障下链条缺失，不据此宣称生产调度器有 bug。故障快照中“从未开始/未提交”只针对该已结束的步及截至观察终点的历史，不宣称永远不会恢复。

类别按优先序互斥：terminal 且无输入→不可达；有输入无同一步 model.start→(b)；有输入、有 model.start、无 delivered→(c)；三者齐全→(a)。若请求与收据同时缺失，主类为 (b)，原 facts 仍保留二者缺失。delivered 无唯一输入、queued 无输入但准入/重试证据不明等情况停止，不硬给二值结论。真实批次每封邮件恰属一类，所有 delivered 都经过双向唯一性断言。两个缺陷类都有真实注入用例；三类对照均存在，分类器可产出两种结论。

## 连接与固定反例

先核验 tool-identities.json 的事件和持久 session SHA-256，以及首个 turn 的 time/turn/session 映射；限定接收 session、queued→delivered 闭区间和 messageKind，要求输入与邮件正反向均唯一；再以持久 seq 的 step/start→step/end 包围输入，按 time/turn/step 唯一连接遥测。**没有假定一项 task 仅对应一封 mail。** 原始信封正文只在本地内存匹配，不导出提示词、回复或参数值。

seed 59 / mail-10 固定回归链：queued **274** → session-2 **turn 2 / step 3**（step/start **285**；持久 seq **36**）→ user/message（持久 seq **37**）→ model.start **286** → delivered **287** → model.end **305** completed/stop → step/end **306** → turn/end **307**。判为 **normal-receipt，非缺陷**。旧规则唯一候选已消除。

seed 45 / mail-15 则为 queued **585** → undeliverable **586**，接收入口此前已退休；未进入任何输入步。它不属于此前统计的 60 封 delivered，扩展到全部 61 封邮件时必须单列。

## 末次动作和任务语义

| seed | 入口最后 step/start | model.end outcome | turn/end | 步数/剩余 | lifecycle |
| --- | ---: | --- | --- | --- | --- |
| 17 | 372 | 404 completed | 412 blocked | 12/0 | retired |
| 31 | 363 | 365 max-tokens（status=completed） | 367 max-tokens | 11/1 | active |
| 45 | 534 | 569 completed | 571 completed | 12/0 | retired |
| 59 | 356 | 358 error | 360 error | 9/3 | active |
| 73 | 407 | 439 completed | 451 blocked | 12/0 | retired |

明细对每个节点列最后一步工具名、当时未处理邮件、随后关联事件；JSON 分别保留 session 事件与涉及该节点的 mail/task/node 事件。工具映射沿用并逐调用核验：tool-1=read_evidence、tool-2=atn_status、tool-3=atn_send；存在 checkpoint 时 tool-4=submit_checkpoint。不是所有工具都是 ATN 原生工具。

33 个 open 任务全部创建于首个 step 之前，holderStepsAtCreation=0，均为预置角色义务，**残留账目不产生新的推送输入**。另外 3 个初始入口角色任务已经 unreachable，仍保留在完整未完成表中。三项运行期未完成任务（17/task-11、45/task-12、73/task-11）由持久 network 的 kind=delivery 独立确认，来自 `src/tasks.ts:278` 的 materializeDeliveryTask：入口退休时物化为不可达交付义务，不发送邮件；必须有节点主动查询并显式 claimTaskId，成功认领后才推送。它们需要节点行动，但属于**纯拉取式义务**，未主动认领不构成漏唤醒。合计未完成 **39 = 33 open 预置 + 3 unreachable 预置 + 3 unreachable delivery**。

任务表逐行核验持久 network 与遥测的 createdAt、holder/requester、status；节点通过已经核验的 session 来源连接，未直接等同原 ID 与遥测别名。queuedMail=0 的口径是仅统计 queued，不包含 delivered/undeliverable，也不能单独排除输入或确认故障。

## 两种期限口径

使用同批 224 个无删失 dispatch→finish 服务间隔，均值 **9405.098214 ms**，nearest-rank p90 **23406 ms**。68 是参考策略 60 次动作加 12.5% 规划余量后向上取整的动作数，不是因果下界。

| 口径 | 计算 | requiredDeadlineMs | 600 秒准入 |
| --- | --- | ---: | --- |
| 和式 | ceil(68×9405.098214 + 14000.901786 + 30000) | 683548 | 拒绝 |
| 既定 p90 | 68×23406 + 30000 | 1621608 | 拒绝 |

尾部余量选 **单个额外 (p90−mean) 服务间隔**，再加既有 30000 ms 主机余量。这是明确的规划假设，不提供整段运行的概率保证；两口径相差 **938060 ms**。**本轮不改既定 p90 分位政策**。

## 不稳定测试复现

批量复现：`node scripts/reproduce-probe-flakes-v2.mjs 10`。每一次独立子进程的退出码、耗时和原始输出都保存在 [复现记录](execution-evidence/probe-liveness-audit-v2-20261015/flaky-reproduction.json)。

| 原测试 | 单次命令 | 本轮独立重复 | 定位结论 |
| --- | --- | --- | --- |
| result-outcome.test.ts 子进程异常退出 | `node --import tsx/esm --test tests/integration/result-outcome.test.ts` | 10/10 通过，0 次失败 | 无法复现此前“子进程异常退出、无断言详情”；原因未确定，不能将异常归因于模型或 runtime。日志保留进程 signal/errorCode。 |
| knowledge-feedback.test.ts KNOWLEDGE-02 mail-10 queued→delivered 竞态 | `node --import tsx/esm --test tests/integration/knowledge-feedback.test.ts` | 10/10 通过，0 次失败 | 无法复现；测试比较 feedback 前后的完整 mails，settle 仅等待 driver idle，不是 outbox durable receipt 屏障。此为代码层面的候选竞态窗口，未证明是历史失败的实际原因。 |

没有修改这两个文件、既有断言或时序。完整 npm test 的本轮真实结果与输出见验证清单。开发中新增审计输出测试曾错误地要求不可达邮件有输入步，导致一次红灯；已按明确定义的不可达类别修正，保留 npm-test-intermediate.log，不能把该红灯算成上述两个既有间歇性失败的复现。

## 交付与工程验证

审计入口：`node --import tsx/esm scripts/audit-probe-liveness-v2.ts`，可传一个独立输出目录位置参数。脚本不导入 live runner、账号配置或安装的模型 provider；观察通道仍只读，故障注入仅在临时测试内核内。

新增 4 个测试覆盖语义闸门、真实故障可达性/三类对照、seed 59 固定反例、双向唯一连接、类别互斥、任务/attempt 计数、CI 限制声明与两口径算术。工程命令的退出码、通过数、日志和未执行项见 [validation.json](execution-evidence/probe-liveness-audit-v2-20261015/validation.json)。未把早期 565+14 当作本轮结果。

最终 `npm test`：**569 项后端 + 14 项客户端通过，0 失败**；`npm run typecheck`、`npm run build`、`npm run pack:tarball`、离线审计入口均退出 **0**。第 9 节要求的命令已全部执行，**未执行的必需命令：无；未完成的必需交付项：无**。4.6 明确采用不可仅凭仓库重放的选项 (b)，4.8 如实记录未复现；两项限制不被冒充为已解决。

37 个固定源码哈希逐个重算，与两批 plan 和五个 report/manifest 一致；`git diff --exit-code HEAD -- src tests/integration/result-outcome.test.ts tests/integration/knowledge-feedback.test.ts` 通过。src/ 行为、工具名/schema、归档 sourceHashes 均未改。旧 brief 和旧停止报告未改写。

保留边界：条件性严格必要下界为 10 / maxNodeSteps≥2，非紧确最小值、非充足预算；无条件上界仍只有 ≥1。60/8 仍是参考策略记账。stepBudget 不是 token/HTTP 请求/费用上限，totalTokens 仍 active=false。没有实施 NEXT_SCOPE_DECISION_RECORD 的四项新范围，没有修复 runtime，没有替换失败 seed、切换模型/档位或从共现推出因果。
