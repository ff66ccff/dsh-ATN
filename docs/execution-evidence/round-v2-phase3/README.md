# 阶段 3：可携带宿主套件

套件本体、CLI、声明与指南在 `conformance/` 并进入 npm files/exports。套件只用宿主端口，零仓库内部 import。宿主端口必须接真实公开运行 API 与真实 instrumentation，不能返回预置答案。

共享策略来自 examples/information-boundary-policy.ts，原示例也复用它。仓库 adapter 的 kernel 装配留在 tests/fixtures，不是独立 npm 套件依赖。46 个 case 对示例宿主全绿；负例 allowUnowned 与 asynchronous 的原始 CLI 输出各 exit 1，分别含 unheld:start / held:start。`red.tap` 保留套件未实现时的失败。

范围收窄（计划停止条件 4）：通用套件冻结全部 16 码名称，8 个宿主协议专属码没有通用 custody 触发，不能依赖内部 reference-policy 来假装验证任意宿主。对应真实协议语义仍由全量 reference-policy.test.ts 验证；指南已显式说明。没有增加公开测试后门。

完整闸门见 gates.json。发布可得性以真实 tarball 的 conformance 目录与从独立解包目录运行 --list 补证。零真实模型调用；不声称语义保密、IAM 或合规日志。
