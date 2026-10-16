# 阶段 2：读侧策略

用户已批准默认关闭。`red.tap` 在公开策略 API 存在前失败（0/2）；`red-task-closure.tap` 在 status 仍返回隐藏 msg 根时失败（3/4）。随后补齐引用投影；`green.tap` 为 unit/integration/fixed-context 八项全绿。完整闸门见 gates.json。

覆盖可见集合、隐藏祖先闭包、citedBy、可见语料重放权重、排序前 k、visit/未知码与文本、publish/result/review 拒绝、未授权主体与 owner 映射、抛错/异步原子性、关闭逐字节对照、同记录/同策略冷重放。宿主 export 与经授权整网观察仍按各自信任前提读取，不声称它们受 node 策略沙箱约束。

发现并修复的路径：status.tasks.result.evidence 可暴露隐藏地址，故扩展同一投影到任务 result/localFeedback/acceptance 的 msg 证据数组及 orphanTasks；review 的声明引用也按同一闭包验证。不是新增发现源。

策略纯函数前提和授予快照责任见 OBSERVER_READ_AUTHORIZATION；不保证任意可变宿主代码可重放，不做自然语言语义保密或历史会话清除。模型工具仍八个、7956/5910 字节；domain 1。
