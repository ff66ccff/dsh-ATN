# 0.6.1 适配与发布记录

日期：2026-10-17（Asia/Shanghai）。本次按用户要求发布 GitHub / npm；在 0.6.0 上增加一个补丁版本。

## 版本与源码核对

| 对象 | 本次版本 | 验证来源 |
|---|---|---|
| DeepSeek Harness | 0.2.1-rc.1 | upstream `1600d8a1e140dcde43a1a0941940a0480712c011` 与同版本 npm 包 |
| Cordis / schemastery | 4.0.5 / 3.18.5 | 目标 Harness vendor 清单与 npm 包 |
| include / loader | 1.0.10 / 1.0.6 | 目标 Harness vendor 清单与 npm 包 |
| Better Sidebar | 0.28.0 | npm 发布包及 upstream `83faf70940160e5cd4c5332f5400aa8f4dbbb6d6` |

Harness 从上一版本目标 `1517a4dbca` 到此次目标的完整差异仅含 355 个 `package.json`，无运行源码变化。全部直接 `@deepseek-ai/dsh-*` 依赖及 `dsh-opencode-go` overrides 同步 rc.1，`engines.dsh` 精确限定此宿主；Node.js 仍要求 24 及以上。锁文件在独立空目录正常解析，再以 `npm ci` 安装 ATN，不使用 legacy peer 选项。

Better Sidebar 0.27.0 → 0.28.0 的 `service.ts` 仅更新服务版本；ATN 消费的 TabDescriptor 无需改写。0.28.0 host 通过 `connection.requestRejection` 复用宿主请求准入，替换旧版 `webRuntime` / 自建信任检查。现行 optional peer 仅声明此次目标 `0.28.0`；旧宿主 alpha.5 保留使用 ATN 0.6.0。

CI 在 Ubuntu / Windows 分别检查 0.28.0 npm 产物与固定 upstream 源码。发布包检查实际声明图；源码检查编译真实传递声明图；两者均运行实际 service/state 的注册、重复拒绝、卸载和重挂载。独立 registry 夹具安装使用 `--legacy-peer-deps` 隔离侧栏整套开发依赖；该夹具不充当真实宿主运行图。联合启动 smoke 通过正常 `dsh plugin add` 安装双方。

差异留档见 [Harness 版本变动清单](execution-evidence/release-0.6.1/harness-version-only-diff.txt)与[侧栏接口差异](execution-evidence/release-0.6.1/sidebar-api-diff.txt)。

## 验证与发布

本地普通依赖解析与 `npm ci --ignore-scripts`、typecheck、607 项 runtime/集成与 17 项 UI（合计 624，零失败、零跳过）、build、pack 均通过。八工具固定上下文保持启用 7,956 / 关闭 5,910 字节。

发布包与 upstream 源码的 TabDescriptor 声明 SHA-256 一致：`e49c026e599e38d4f47a78418dc1edd6977979d4b68bdfc13ca61b74b99099cf`。两者的真实注册、重复拒绝、卸载和重挂载均通过；负例继续拒绝键漂移、源码编译失败和未审查版本。

使用独立安装的真实 Harness `0.2.1-rc.1` CLI，在临时 profile 安装 tarball：八工具继承、节点创建、substrate 读写与既有 profile 配置保持等 smoke 断言全通过。扩展的 Web 观察 smoke 通过 `ATN_SIDEBAR_SPEC=dsh-better-sidebar@0.28.0` 正常安装侧栏并联合启动，断言双方客户端模块真实下发、侧栏认证请求返回 200、未认证请求返回 403；六节点协作、严格观察 RPC、独立授权舰队读取继续通过。因此 0.6.0 记录的 `webRuntime` 联合启动阻塞已在本次目标组合中消除。

上述联合启动证明 host 挂载、HTTP/RPC 和客户端产物下发；本轮未执行真实浏览器内的整套侧栏交互巡检。客户端可见性、取消、卸载和顶栏回退由 17 项 UI 测试及实际 registry 检查覆盖。

验证输出见 [证据目录](execution-evidence/release-0.6.1/validation.json)。托管 CI 在推送后检查 Ubuntu / Windows 的完整测试与两套侧栏目标；实际发布结果见 [GitHub v0.6.1](https://github.com/ff66ccff/dsh-ATN/releases/tag/v0.6.1) 与 [npm 0.6.1](https://www.npmjs.com/package/dsh-atn/v/0.6.1)。远端结果和 tarball 完整性在完成发布后另行归档。

八工具、宿主保管策略、读侧授权及 domain=1 的行为保持；本轮不调用外部模型，不重跑历史性能实验。历史报告保留其原始基线、结果与限制。
