# Changelog

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
