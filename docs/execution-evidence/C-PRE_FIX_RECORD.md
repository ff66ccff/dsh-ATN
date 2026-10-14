# 阶段 C 修复前记录

基线 `60924fe`，尚未改任何 client 实现。`npm run test:client` 退出码 1，10 tests / 8 pass / 2 fail / 0 skipped，完整输出 `C-pre-fix.txt`。

SIDEBAR-ABSENT：真实 Cordis apply 已运行且 header 已注册，但打开后没有结构化节点 table；SIDEBAR-PRESENT：真实 Cordis 中注入服务，预期 tab 注册数组为 [atn-network]，实际为空。
两条均为断言失败，非编译/导入失败。disposer 子断言未运行到，不能宣称其修复前已失败。
图形阶段 bundle 为 485539 bytes（C-bundle-before.txt）。

用户随后授权代理自行权衡、尽可能达成目标，因此 C 继续实现可选客户端注册和完整结构化回退；旧 provider 的 host 缺陷仍单独记录，不伪造已兼容。
