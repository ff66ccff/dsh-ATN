# Changelog

## 0.7.0 — 2026-11-13

- 适配 Harness `0.2.2-rc.2`，同步 Cordis `4.1.0`、schemastery `3.19.0`、Zod `4.6.6` 和 include/loader `1.1.0`；直接使用宿主保证存在的 `Agent.model.current()`，手动装配内核使用官方 native tool executor。
- 可选 Better Sidebar 基线更新到 `0.32.0`；发布声明与固定上游源码分别验证，CI 不跳过 peer 检查，并拒绝缺失的传递声明或组件 props 漂移。
- 增加宿主 `peerDisclosure=full|coarse|minimal`，默认完整响应不变，创建网络时固化；限制仅作用于协作者卡片及拓扑反馈，自己的工作、显式证据读取与授权观察不受影响。
- 粗粒度视图只采用真实 custody 对应的宿主 catalog topics 和来源区分的定性结果，不回退到资产 ID 分词或任务正文；最小视图只显示身份/生命周期。隐藏数值变化不新增反馈唤醒，保留有界且可重放的反馈确认。
- 原生 Team 实验迁移到公开 subagent/控制工具与共享任务板，更新真实收据和成本口径，记录新基线并拒绝混合旧/新原生 Team 样本；旧实验结果不改写。
- OpenCode Go 开发依赖更新到 `0.4.0`，私有 SDK 回归改为公开 adapter 的本地 HTTP/SSE 测试，未知价格不能被当作免费价格。
- 增加实际模型请求/日志的三档配对控制、冻结策略恢复、白名单裁剪、独立 custody/read ACL 及反馈字节上限测试。论文 `arXiv:2611.07667` 仅作为经济博弈启发，不宣称编码效果提升或论文复现。
- 修复省略宿主 `config` 时默认插件加载失败，保留非法披露模式拒绝，并增加 schema 默认值与真实 Cordis 加载回归；两个实验源码哈希清单补入披露模块。
- 修复可视化烟测 CLI 参数向观察器的传递，实际验证新版 Sidebar 挂载、未认证拒绝、只读观察与舰队授权；浏览器登录仍受本地权限策略限制。

从 `0.6.3` 升级需同步更新宿主依赖；默认 `peerDisclosure=full`、八工具协议及独立 custody/read ACL 保持。旧版 `0.6.3` 的适配与发布证据保留在历史记录中。

发布验证：干净源码副本的锁文件安装、类型检查、629 项内核/单元测试、17 项客户端测试及构建通过，1 项可选历史归档审计跳过；发布包真实 Profile 安装、八工具与子节点 preset 继承、substrate 读写、原配置保持，以及 Sidebar 发布声明/源码和注册生命周期检查通过。Web Profile 联合接口烟测通过；浏览器登录受本地权限策略限制，不宣称交互式界面已验证。

## 0.6.3 — 2026-10-26

- 对齐本地 upstream DeepSeek Harness `0.2.1-rc.3`；`engines.dsh` 与全部 Harness peer 依赖改为 `>=0.2.1-rc.3`，开发依赖及实验 provider overrides 固定 rc.3。Node.js 最低版本与上游对齐为 24.9.0。
- 适配 upstream `Agent.model.current()`：启动与创建子节点读取当前模型选择，避免使用过时 options，并允许显式省略 reasoning effort；npm rc.3 使用既有 options 路径。
- 复核 Better Sidebar `0.28.0` 的声明与注册生命周期，保留可选 peer 和顶栏入口。
- 更新锁文件、最低版本契约、安装说明、兼容范围和文档索引。

验证与发布状态见 [0.6.3 发布记录](docs/RELEASE_0_6_3.md)。

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
