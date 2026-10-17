# Changelog

## 0.6.2 — 2026-10-18

- 对齐本地 upstream DeepSeek Harness `0.2.1-rc.2`，全部宿主 peer/dev 依赖、实验 provider overrides 与 `engines.dsh` 同步更新，重新正常解析锁文件。
- 复核 rc.2 的搜索/抓取 API、设置和模型标签变更；ATN 消费的运行接口与 Better Sidebar `0.28.0` Tab API 保持兼容。
- 保留 Better Sidebar `0.28.0` 可选 peer 与固定 upstream CI 目标，重新验证声明、实际注册生命周期和 rc.2 Web Profile 联合启动。
- 更新版本号、安装示例、现行兼容说明与文档索引。八工具协议与保管、观察授权行为保持。
- 修正知识反馈集成测试的收据等待：测量反馈副作用前显式完成既有消息收据，避免 Windows 慢文件系统造成偶发误报。

验证与发布状态见 [0.6.2 发布记录](docs/RELEASE_0_6_2.md)。

## 0.6.1 — 2026-10-17

- 对齐 upstream DeepSeek Harness `0.2.1-rc.1`，全部宿主依赖、实验 provider overrides 与 `engines.dsh` 同步更新。
- 升级 Cordis `4.0.5`、schemastery `3.18.5`、include `1.0.10` 与 loader `1.0.6` 正式版，并重新生成锁文件。
- 可选 Better Sidebar peer 更新为 `0.28.0`；分别检查 npm 包与固定 upstream 提交的声明及真实注册、卸载、重挂载。旧版 `webRuntime` 依赖已由上游改为宿主 `connection` 服务。
- 更新 Ubuntu / Windows 侧栏 CI、版本徽章、安装命令、兼容说明与文档索引；八工具协议与固定上下文不变。

验证与发布状态见 [0.6.1 发布记录](docs/RELEASE_0_6_1.md)。

## 0.6.0 — 2026-10-17

- 将全部 Harness 依赖及实验 provider overrides 对齐 `0.2.1-alpha.5`，`engines.dsh` 精确限定已验证版本；Node.js 要求为 24 及以上。
- 适配 Better Sidebar `0.26.1` npm 包及 `0.27.0` 上游源码，分别检查 Tab 类型契约、实际注册、卸载和重挂载。0.27.0 尚未发布 npm；其 host 仍依赖目标 Harness 已移除的 `webRuntime`，完整侧栏联合启动有限制，ATN 顶栏入口可用。
- 汇总 0.5.0 之后的动态出度上限、结构化网络面板、只追加共享 substrate（`atn_publish` / `atn_search` / `atn_visit`）。默认工具面为八个；关闭 substrate 可恢复五工具。
- 增加观察 RPC 的 principal/resource/action 授权、可选 substrate 读侧策略、跨网络地址与保管边界验证。
- 随包交付 `dsh-atn/conformance` 宿主一致性套件；增加显式授权的舰队观察及有界易失拒绝计数。拒绝日志仍为设计稿。
- 修正版本号、安装包名称、现行兼容说明和历史报告索引；随 npm 包发布本变更记录。

升级及验证范围见 [0.6.0 发布记录](docs/RELEASE_0_6_0.md)。

## 0.5.0

历史 npm 发布版本：宿主强制 artifact 保管边界、宿主派生发现与自由文本白板移除。后续未发版工作从本次 0.6.0 起统一交付；原始分阶段证据保留在 `docs/`。
