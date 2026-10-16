# 0.6.0 适配与发布记录

日期：2026-10-17（Asia/Shanghai）。本轮由用户授权适配 upstream 并推送 GitHub / npm；旧实施交接中“暂不发布”的限制记录的是历史阶段。

## 基线与版本

上一 npm `latest` 为 0.5.0。本次为 0.6.0，包含其后的功能提交及本轮适配，不覆盖历史版本。主清单、锁文件、README、CHANGELOG 与 smoke 的安装包名称同步更新；prototype 是历史独立工程，保留原始版本。

| 对象 | 本轮目标 | 验证来源 |
|---|---|---|
| DeepSeek Harness | 0.2.1-alpha.5 | upstream `1517a4dbca`，标签 `dsh-v0.2.1-alpha.5`；npm 同版本 |
| Cordis / schemastery | 4.0.5-alpha.2 / 3.18.5-alpha.2 | Harness 目标提交 vendor 清单，版本未变 |
| Better Sidebar | 0.26.1 | npm 发布包 |
| Better Sidebar | 0.27.0 | upstream `9cb0b9c56dfad2fa64b979f3a044e225110a4860`；本轮检查时 npm 尚无该版本 |

`engines.dsh` 从先前宽范围收窄为 `0.2.1-alpha.5`，只声明本轮真实检查的宿主版本。全部直接 `@deepseek-ai/dsh-*` 依赖和 `dsh-opencode-go` 的宿主 overrides 同步 alpha.5；未使用 legacy peer 安装或强制覆盖来构造 ATN 的依赖图。旧锁与已安装 alpha.4 的混合解析失败后，在空隔离目录生成新锁，再以普通 `npm ci` 安装。

## 上游接口核对

Harness alpha.4 → alpha.5 的源码差异涉及终端清单、模型选择器、账号通知、侧栏 CSS、技能更新、PTC SDK、文件读取及 subagent 提示。ATN 所用 agent/session/preset、原生工具、观察 RPC、连接与顶栏槽位接口未发生需要改写消费者的变化。PTC 的 SDK 渲染及 `run_code` 参数顺序变化不改变 ATN 原生八工具；本轮不声称完成 PTC 或远程模型端到端验证。

Better Sidebar 的 `service.ts` 在两个目标间仅修改 `SIDEBAR_SERVICE_VERSION`，Tab API 未变。0.26.1 对真实发布声明检查投影可赋值及键存在性；0.27.0 从真实 `service.ts` 入口编译完整传递声明图，再对其实际生成的声明执行相同检查；编译错误或契约漂移均拒绝通过，不复用旧版本声明。实际注册测试分别运行各目标自身的 service/state 实现，覆盖重复注册拒绝、卸载和重挂载。CI 在 Ubuntu / Windows 分别检查发布包与固定提交源码，不依赖本地 upstream 目录。

## 已知限制

0.26.1 与 0.27.0 host 插件仍注入 `webRuntime` 并读取 `ctx.webRuntime.trustedHosts`，目标 Harness 没有此服务。ATN 未改写上游或伪造该服务，完整 provider host 联合激活仍受阻。客户端接口与实际注册检查不等于完整侧栏浏览器验证。ATN 顶栏入口独立工作；Better Sidebar 仍是可选 peer，不强制安装。源码验证也不代表 0.27.0 的未来 npm 产物已经验证。

宿主 custody 与读侧策略的有效性依赖真实授权映射和提取规则，不保证识别任意自然语言泄漏。舰队拒绝计数为有界易失计数，不是持久合规日志。本轮不调用付费模型，不重跑历史实证实验。

## 验证与发布

本地普通 `npm ci`、typecheck、607 项 runtime/集成与 17 项 UI（合计 624，零失败零跳过）、build、pack、真实 alpha.5 profile 安装和 Web 观察 smoke、两个侧栏目标均通过。新增源码契约负例验证类型键漂移、源码编译错误和未审查版本会被拒绝。固定上下文保持启用 7,956 / 关闭 5,910 字节。验证摘要与命令输出见 [证据目录](execution-evidence/release-0.6.0/validation.json)。

GitHub 托管 CI 在 [Actions](https://github.com/ff66ccff/dsh-ATN/actions) 公开；发布产物见 [v0.6.0](https://github.com/ff66ccff/dsh-ATN/releases/tag/v0.6.0)，npm 安装使用 `dsh-atn@0.6.0`。实际远端发布状态以该 Release 与 npm 注册表为准。
