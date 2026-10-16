# 探针唤醒条件：前置核验

本定义用于 `PROBE_LIVENESS_AUDIT_BRIEF.md` 第 4.1 节的前置核验。核验发现第 4.4 节指定的正向对照与现行投递语义不相容，已按第 7.3 条停止；本文不是已验收的完整二值分类器。

## 已从代码确立的条件

| 条件 | 推送／拉取 | 实际行为与代码位置 |
| --- | --- | --- |
| 入口首次任务输入 | 推送 | `src/runtime.ts:905` 同步目标，`:907` 记录任务输入；`:2254` 的 `recordModelInput` 在允许 wake 且非 running 时调用 followup，否则 inject。 |
| 新节点任务、atn_send 的 task/note/result 邮件、提案通知 | 推送 | 初始任务 `src/runtime.ts:1068`、`:1122`；发送 `:1291`、`:1306`；提案 `:1788`、`:1805`。均进入持久 outbox。`:1388–1447` 的 deliverMail 只处理 queued。idle、尚未记录输入且步数允许时，`:1440` 用 send(..., true) 启动 driver；运行中的节点注入 next-step。 |
| 定时器／显式 tick 重放未确认邮件 | 推送 | `src/runtime.ts:2335` 串行排队 tick；`:2372` drainMailbox；`:2421–2423` 仅重放 pendingMails。`src/mailbox.ts:218–221` 只选 queued，delivered 不再重放。 |
| 孤儿任务发现和认领 | 拉取；认领成功后的通知走推送 | `src/runtime.ts:1647` 的 claimTaskId 必须由调用者传入；`:1674–1704` 创建恢复任务并投递邮件。仅存在孤儿任务不会自动发起认领，不构成漏唤醒。 |
| 目标版本广播、知识／评级／拓扑反馈 | 随后实际输入时附带；不独立推送唤醒 | 目标广播 `src/runtime.ts:1893–1894` 显式 wake=false；拓扑反馈 `:618–625` 只附加到真实收件箱输入。不能把这些变化单独视作应当再次调用模型的工作。 |
| 恢复流程同步目标／恢复已有节点 | 推送，但受恢复路径和准入条件限制 | `src/runtime.ts:2482`、`:2527` 调用默认允许 wake 的 syncGoalIfNeeded；这不是普通 tick 对所有 active 节点的轮询唤醒。 |
| 单独存在 open task／预置角色义务／交付义务账目 | 不独立推送；需已有执行或主动查询推进 | task 记录不等于 inbox 输入。`src/runtime.ts:2364–2372` 可更新生命周期和 materializeDeliveryTask，随后只重放 queued mail；不遍历 open task 来启动模型。预置任务的初次任务输入有其独立推送路径，输入已处理后的残留角色账目不能再次算作待推送邮件。 |

准入还要求网络 open、接收者已 published、生命周期允许且有剩余步数；见 `src/runtime.ts:646–658`、`:675–686`、`:1409`、`:1431`。active、有余步本身不产生新的输入。

Harness 实际行为见本地 `node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:800–814`：send 的 wakeup=true 启动 driver；followup 放入 next-turn 并唤醒，inject 放入 next-step 且不独立唤醒。`:956–973` 先完成 preStep 和准入，再发出 step/start。`:1067–1084` 把本步 user/message 写入历史后才构造并派发模型请求。源码哈希见本轮 precondition.json，避免把行号当作版本固定标识。

## 机械判据及其边界

对**正常代码保证成立**的停止快照，普通邮件路径的待重放工作判据为：

```text
network.open && !runtime.closing
&& mail.status == queued
&& recipient.published && recipient.active
&& recipient.loaded && !recipient.running && recipient.remainingSteps > 0
&& !recipient.historyContains(mail.marker)
```

这是 queued 邮件需要重放／尝试唤醒的判据；不把它直接命名为缺陷。还须检查 tick 是否获得执行机会、输入准入是否被拒绝和最终是否完成确认。停止快照缺少 loaded、closing、历史 marker 等字段时，不应伪造这些字段；可从已有持久 session 补证的部分必须注明来源。

已经 delivered 的邮件不满足该判据。`src/mailbox.ts:7–8` 明确给出：queued 等待持久输入收据，delivered 表示接收者 user-message 历史已持久持有该邮件。`src/runtime.ts:1471–1481` 要求 marker 已记录且被 flush 覆盖，`:1445–1446` 才 markDelivered；`:1404` 对已 delivered 立即返回，不再次唤醒。

因此事件顺序允许是：

```text
queued → 唤醒／注入 → step/start → user/message → model.start
       → flush 确认 → mail.state delivered → model.end → step/end
```

“delivered 之后没有新的 step/start”只能机械判定**之后没有新的步**，不能判定**该邮件没有进入此前刚开始的那一步**，更不能推出应当再启动一步。历史记录也不代表模型已完成任务、正确使用了邮件或保证回答成功。

预置角色义务与纯拉取义务被排除，是因为没有尚欠的推送输入；仅凭账目、可查询内容或剩余步数无法建立新的运行时唤醒义务。反过来，一封初始任务邮件若确实仍 queued 且未记录输入，仍应按邮件路径检查，不能因任务预置而忽略。

## 对指定对照的影响

brief 第 4.4 节要求用“已 delivered，active、非 running、有余步，之后无 step/start”建立机制缺陷正向对照。上述条件不包含**尚未履行的推送义务**，同一步已收到输入的合法轨迹也满足它们。本轮 seed 59 就提供了真实反例。

任意伪造“delivered 但没有历史收据”的事件可以模拟违反持久化不变量的故障，但不能冒充上述正常语义下的必然再唤醒义务。那需要另行定义收据不一致分类与故障注入验证。本轮没有放宽定义或把这样的伪造轨迹写成通过的对照，按第 7.3 条停止。
