# 探针静默活性审计：前置核验与停止报告

2026-10-15，工作区 `D:\dsh-ATN`，分支 `codex/release-ready`。按 `PROBE_LIVENESS_AUDIT_BRIEF.md` **第 7.3 条停止**，未宣称整轮实施完成，未交付通过双向对照的二值分类器。

用户指定的实验路由保持 **dsh-agy / gemini-3.8-flash-tiered（Gemini 3.8 Flash）/ medium**，与本轮读取的恢复批归档一致。遵守 brief 的离线范围：本轮真实模型调用 0、账号读取 0、网络访问 0、provider 加载 0。未重新运行真实实验。

## 已确立的观察

**delivered 是持久输入收据，不是先投递、再等待唤醒的前置事件。** 唤醒／输入注入在 queued 阶段发生，只有已记录 user/message 并 flush 后，运行时才提交 delivered。普通 tick 只重放 queued，deliverMail 对 delivered 直接返回，不要求此后再启动一步。代码位置、推送／拉取及预置义务排除理由见[唤醒条件定义](PROBE_WAKE_ELIGIBILITY_DEFINITION.md)。

对五个 seed 按 brief 第 4.2 节的“delivered 之后是否还有 step/start 或 model.start”进行**时间分类**，得到以下前置扫描。这里保留“候选”称呼，不把它直接算作机制缺陷；没有签发五个 seed 的最终二值判定。

| seed | delivered | (i) 此后有输入事件 | (ii) 此后无输入，停止时 active、有余步 | (iii) 此后无输入，停止时 retired/failed |
| --- | ---: | ---: | ---: | ---: |
| 17 | 11 | 11 | 0 | 0 |
| 31 | 11 | 11 | 0 | 0 |
| 45 | 14 | 14 | 0 | 0 |
| 59 | 12 | 11 | 1 | 0 |
| 73 | 12 | 12 | 0 | 0 |

各行三分类之和等于 delivered 数，seed 17 的 11 封与基线相符。(i) 优先：接收者后来退休但退休前已经获得输入的邮件仍属 (i)。没有将退休接收者计入候选。节点和 session 按 node.state 连接，既有身份投影的 event SHA-256 逐个核验；没有将遥测别名直接当作原始节点 ID。

唯一候选为 **seed 59 / mail-10 / task-3 / node-2 / session-2**。停止时 active、剩余 7 步，但已有如下事件链：

| 事件 | 遥测 sequence | 已有持久 session 的证据 |
| --- | ---: | --- |
| 邮件 queued | 274 | 发给该接收者的 result 邮件 |
| 最后一步 step/start | 285 | 原 session seq=36，turn=2、step=3，time=1792052620524 |
| 本步 user/message 收到该 result | 无独立遥测事件 | 原 session seq=37，time=1792052620525 |
| 本步 model.start | 286 | 时间不早于上述 user/message，代码在写入输入后构造请求 |
| 邮件 delivered | 287 | 持久化收据确认晚于 step/start、model.start |
| model.end | 305 | completed |
| step/end | 306 | turn=2、step=3 |
| turn/end | 307 | completed |

因此“投递后没有新步”在这里确实成立，但邮件已在**投递确认之前启动的同一步**进入输入。原 session SHA-256 为 `66bb0ba3aa17ea0fb87f79d60c29f9dea3a96e735e5b45abe465b48e9e5d59d2`，与上一轮身份投影一致。复核只提取收据类型、时间、seq 和步号，不保存提示词、回复正文或工具参数值。

收据关联先限定既有 session 映射，再限定该邮件 queued→delivered 时间区间和 result 类型，断言只有一个输入收据、且反向只有一封可能对应的邮件；再以 time/turn/step 唯一连接原 session step/start。不存在默默按“任务与邮件 1:1”连接的步骤。一项任务允许多封邮件；这里用邮件的生命周期窗口核对，task-3 仅作为遥测标签保留。

## 由观察支撑的判定

**时间候选不等于未履行的唤醒义务。** 唯一候选 mail-10 已进入最后一次模型输入；无法据此认定漏唤醒。对其要求“delivered 后必须再启动一步”会给合法终止轨迹制造额外义务。

按代码定义，普通邮件路径真正待重放的是尚 queued、尚未在历史中记录输入的邮件。brief 指定的正向对照却要求邮件已经 delivered；它列出的状态不足以建立一项尚未履行的推送义务。本轮无法在不放宽第 4.1 节定义的前提下，把该指定场景作为必然的 `mechanism-gap` 对照，故依第 7.3 条停止。

这不是声称任何机制故障都不可构造。可以设计 queued 输入丢失、收据状态与持久历史不一致、输入被记录后请求未派发等故障；但它们需要各自的定义与证据，不能用“delivered 后无新步”替代。

## 未确立的推断

没有确立五个 seed 的最终 `mechanism-gap`／`no-wake-eligible-work` 判定，也没有证明预算、发现、延迟或模型行为造成静默。输入已记录不等于回答正确、义务完成或模型采用了这封邮件。

本轮不能按第 4.6 节宣布整个机制路径没有缺陷；当前只排除了上述一条候选作为漏唤醒的证据。协议是否缺少后续推进机制仍待审计。不能把“任务仍 open”或“节点还有余步”补作唤醒证据。

## 命令与可重复证据

```text
node --import tsx/esm scripts/audit-probe-liveness-precondition.ts
```

退出码 0。输出 `status=stopped`、`briefStopCondition=7.3`、五行时间分类、上述唯一反例的完整 seq 投影和 37 个源码哈希复核。**退出 0 只表示停止依据成功复核，不表示整轮审计或双向对照通过。** 完整输出见 [execution.txt](execution-evidence/probe-liveness-audit-20261015/execution.txt)，机器证据见 [precondition.json](execution-evidence/probe-liveness-audit-20261015/precondition.json)。脚本可将另一个 JSON 输出路径作为位置参数传入。

脚本需要现有 `.artifacts/live-probe-resumed/20261015/batch` 下的一个持久 session 文件，路径来自上轮 tool-identities.json；它不是账号文件。缺失或哈希不符会拒绝复核，不回退为猜测。JSON 脱敏投影便于查看，独立重提取仍需要原持久 session；没有宣称脚本只依赖已跟踪文件即可在 CI 重放。

两批 plan 的 sourceHashes 相同，37 个固定源码重新计算一致，恢复批五个 report/manifest 的 sourceHashes 亦逐个相同，未重写归档哈希。本轮 `src/` 与两个既有不稳定测试文件未改，验证原始结果见 [validation.json](execution-evidence/probe-liveness-audit-20261015/validation.json)。已有工作区改动保留。

## 已尝试方案与下一步

已完成源码读入→邮件时间分类→原 session 收据复核。若只用第 4.2 节时间阈值，seed 59 会产生一个已处理邮件的假阳性；若加入代码规定的持久收据语义，则指定 delivered-only 正向对照不能仅凭那些条件建立应当再唤醒的义务。未通过伪造相反源码语义或强行标为缺陷来凑对照。

建议先修订 brief 的对照与判据：从 queued 开始连接到**包含该邮件的具体输入步**，再追踪模型请求、准入拒绝与请求结束；将收据晚于输入、输入已记录但模型请求未开始、缺少持久收据分别定义。正向对照应故障注入一个按实际代码确实欠下推送的状态，并明确排除正常同一步收据延迟。只有在这项前置条件解决后，再恢复完整义务审计与末次动作归因。

## 未完成项

遵守“遇到即停下报告，不得自行绕过”，以下不计为完成：第 4.4 节双向构造对照和五 seed 二值判定、第 4.3 节完整任务语义表、第 4.5 节完整末次动作／全五 seed 飞行状态核对、第 4.7 节和式门对照、第 4.8 节不稳定测试复现。既有两次红灯记录保留；本轮没有重跑它们，也没有把历史独立通过当作本轮已定位。

`npm test`、`npm run typecheck`、`npm run build`、`npm run pack:tarball` **在触发停止条件后未执行**，不引用上轮 565+14 作为本轮通过。新增诊断脚本仅作单独静态检查与上述实测复核，结果按 validation.json 记录。README 和 docs/README 已同步新增定义与停止报告。
