# V2 事件语义闸门

本表先于分类器完成。sequence 是观察器发出事件的全局顺序；不是跨存储、输入队列、请求派发的统一事实时钟。下列代码位置对应本工作区安装版本，审计另存文件 SHA-256；行号本身不是版本标识。

| 事件 | 类别 | 相对事实的时序 | sequence 可靠性与正确锚点 | 代码位置 |
| --- | --- | --- | --- | --- |
| mail.state queued | 状态变更的观察收据 | outbox 提交后、尝试投递前；不代表已唤醒 | 不是实际 wake 时间代理。作为持久推送义务起点；实际 wake 是 send(..., true)，running 时 inject 进入下一步 | src/mailbox.ts:5；src/runtime.ts:552、:1388、:1440；experiments/telemetry.ts:460 |
| mail.state delivered | 持久输入收据的观察收据 | user/message 已记录且 flush 覆盖之后 | sequence 不是可靠代理；替代锚点为 queued + 持久 user/message 所属具体 step。seed 59/mail-10：274 queued、285 step、286 model、287 delivered | src/runtime.ts:1404、:1445、:1471；src/mailbox.ts:7；experiments/telemetry.ts:460 |
| step/start | 状态变更 | preStep 接受且领取输入之后，prepareRequest 与 user/message 记录之前 | 可靠表示步已获准开始，不表示已记录输入或请求已开始；以同 session 的持久 seq 包围 user/message | node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:953、:973、:1036、:1067；experiments/telemetry.ts:323 |
| step/end | 收据 | step 返回/抛错后 finally 中；可能没有 model.start | 可靠表示步栈退出，不表示执行成功；连接同 session/turn/step | node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:1001 |
| model.start | 状态变更 | user/message 后，llm/stream 观察迭代器开始，next() 之前 | 可靠表示可观察请求 attempt 开始；不是 HTTP/provider 派发时刻。必须连接包含输入的步，不检查 delivered 后是否还有请求 | experiments/telemetry.ts:207、:233；node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:1084 |
| model.end | 收据 | attempt 迭代结束或异常的 finally | 可靠表示 attempt 已结束；status=completed 可伴随 finishReason=max-tokens，不能合并这两个维度 | experiments/telemetry.ts:242、:262 |
| turn/start | 状态变更 | driver 预留后、preStep 前 | 可靠表示打开 turn；不能证明存在获准的 step | node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:943；experiments/telemetry.ts:323 |
| turn/end | 收据 | turn 的 finally | 可靠表示 turn 栈退出，reason 不是模型请求结果；可能没有 step | node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:1020；experiments/telemetry.ts:326 |
| task.state | 状态变更的观察收据 | NetworkStore.update 提交后 | 可靠表示已观察到的提交状态，不表示推送命令；创建时间用 createdAt，预置义务用首次 step 前且 holderStepsAtCreation=0 | src/runtime.ts:552；experiments/telemetry.ts:373 |
| node.state | 状态变更的观察收据 | NetworkStore.update 提交后 | 可靠表示已观察生命周期；不含 agent.running/loaded。仅用投递边界前最后一次状态判断 terminal，不用最终状态倒推历史 | src/runtime.ts:552、:763；experiments/telemetry.ts:351 |
| tool.start | 命令记录的观察收据 | tool/call 历史记录后，工具返回前 | 可靠表示请求工具调用，不证明副作用已完成；call/session 连接 tool.end | experiments/telemetry.ts:305；node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:682 |
| tool.end | 收据 | tool/result 历史记录后 | 可靠表示结果已记录，error 必须单独保留，不推断业务成功 | experiments/telemetry.ts:312 |

## 来源可信边界与连接

session.v4.jsonl 是持久事件历史，session 内 seq 确定记录顺序；user/message 证明输入已进入该步的历史，不证明模型使用了它、理解它或执行正确。遥测只导出无正文别名，且异步写文件；sequence 是 emit 顺序，at 对 session 事件取 event.time，对网络事件取提交后的观察时间。重放可能产生多次 mail.state 变化，不能假定 queued/delivered 恒为 1:1。观察器关闭或缺失会使负面证据无效，审计必须检查 coverage。

先校验既有 tool-identities 的事件哈希和原始 session 哈希，核对 session 别名与 first turn 的 time/turn。对每封邮件限定接收 session、queued→delivered 的闭区间、messageKind，从 ATN user/message 的信封提取类型（不导出正文）；必须正反向各唯一匹配。再用持久 seq 的 step/start→step/end 包围该输入，以 time/turn/step 唯一连接遥测 step。不以 task 和 mail 一对一为假设。若任何连接不唯一，按 7.4 停止，不能择最近项猜测。

queued 是普通邮件持久推送义务的锚点，不是唯一唤醒来源。入口 recordModelInput、spawn 初始 task 邮件、send、提案通知、成功 claim 的通知、恢复 syncGoal 均可推送；tick 只重放 queued；裸 task 创建/孤儿发现/反馈/目标广播不独立唤醒。详见 src/runtime.ts:905、:1068、:1291、:1647、:1788、:1893、:2254、:2335、:2421、:2482。纯拉取内容和已处理输入后的预置角色义务不构成新的应推送输入。queuedMail 只计 queued（src/mailbox.ts:218），零不能证明不存在历史收据故障。

## 故障分类边界

封闭、观察完备的快照按优先序分类，保证互斥：投递时 terminal 且无输入→unreachable；有输入无同一步 model.start→input-without-model (b)；有输入且 model.start 但无 delivered→receipt-missing (c)；有输入、model.start、delivered→normal-receipt (a，非缺陷)。无输入的 queued 必须另查准入和重试机会，不能凭静默判缺陷；delivered 无输入违反收据不变量，立即停止。正常收据可在同一步或更晚提交，细分 delayedInSameStep。

(b)/(c) 是注入故障下未履行的请求/确认链条，不等同于生产调度器 bug；(c) 本身不欠第二次模型唤醒，只欠持久收据。两者同时缺失时优先 (b)，并保留缺失收据事实。故障对照在施加故障并给予 tick 重试机会后的静止快照分类；不能声称未来永远不会恢复。driver 尚在飞行或观察不完备时不能输出生产快照的静默结论。
