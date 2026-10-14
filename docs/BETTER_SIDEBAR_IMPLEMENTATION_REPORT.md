# 阶段 C：外部依赖阻塞记录

日期：2026-10-14。代码基线：阶段 B `f47eec0`。**C 未实施，D 未开始，最终整轮验收未完成。**

## 停在哪一阶段、哪一条

停在 C 的依赖契约核实/安装阶段。实际 blocker 是 better-sidebar 0.26.0 没有适配目标 Harness，而不是总纲停止条件 C-5 所述的“找不到可选注入写法”；**未实测 C-5，不能把当前 blocker 冒称 C-5**。
继续需要改 better-sidebar 的 host 注入与依赖声明，超出 C brief §7 的“只做 UI 承载面与呈现方式”边界；也无法满足干净 npm ci 闸门。因阶段间硬闸门，本轮未开始声明审计与 D。

## 实测命令与输出

1. 查询当前实际发布包：

```powershell
npm view dsh-better-sidebar@0.26.0 version peerDependencies peerDependenciesMeta --json
```

[原始清单](execution-evidence/C-sidebar-manifest.json)显示 Cordis peer 为 `^4.0.4`、Harness peers 为 `^0.2.0-rc.2`，还声明已删除的 `@deepseek-ai/dsh-invariants`。latest=0.26.0；本地上游同为 0.26.0。

2. 在独立目录做普通 npm 解析，未改根依赖：

```powershell
npm install --prefix .scratch/sidebar-compat --package-lock-only --no-audit --no-fund @deepseek-ai/cordis@4.0.5-alpha.1 dsh-better-sidebar@0.26.0
```

实际退出码 **1**，`ERESOLVE`，`peer @deepseek-ai/cordis@"^4.0.4" from dsh-better-sidebar@0.26.0` 与实际 4.0.5-alpha.1 冲突。
完整输出：[C-install-compat.txt](execution-evidence/C-install-compat.txt)。这是依赖解析失败，不是 UI 修复前断言失败。

3. 使用隔离的目标 CLI，在独立 DSH_HOME 安装真实发布包：

```powershell
$env:DSH_HOME = 'D:\dsh-ATN\.scratch\sidebar-profile-compat'
D:\dsh-ATN\.scratch\harness-alpha\node_modules\.bin\dsh.cmd --profile sidebar-check --from-default-profile web --dump-config
D:\dsh-ATN\.scratch\harness-alpha\node_modules\.bin\dsh.cmd plugin --profile sidebar-check add dsh-better-sidebar@0.26.0
```

安装 **退出码 0**。不能仅凭 npm 错误宣称 Harness 拒绝安装；目标 CLI 的实际结果不同。完整输出：[C-profile-compat.txt](execution-evidence/C-profile-compat.txt)。它只能证明安装/选中 bundle，不能证明插件激活。

4. 启动真实 profile，用只读测试 observer 在 appReady 检查状态并退出：

```powershell
D:\dsh-ATN\.scratch\harness-alpha\node_modules\.bin\dsh.cmd --profile sidebar-check --patch D:\dsh-ATN\.scratch\sidebar-compat.overlay.yml --no-open --port 0
```

实际退出码 **1**。完整输出：[C-sidebar-boot.txt](execution-evidence/C-sidebar-boot.txt)，launch token 已脱敏：

```text
dsh: warning: 1 entry did not activate
better-sidebar (dsh-better-sidebar): pending (waiting for service: webRuntime)
SIDEBAR_COMPAT {"version":"0.2.1-alpha.2","webRuntime":false,"webStartup":true,"betterSidebarHostState":0,...}
```

上游 `DSH-better-sidebar/src/index.ts:114` 仍 `inject=['webServer','sessions','webRuntime','tools']`；`:1322` 读取 `ctx.webRuntime.trustedHosts`。
Harness 的 `v0.2.1-alpha.1/web-listener-trust-config` guide 明确移除了 webRuntime，改为 webStartup。这是 A 核对的额外 guide，也正是当前运行日志中的 pending 原因。

## 已尝试的方案与边界

- 普通 npm dependency resolution：确实失败。
- 目标 Harness 自己的安装路径：确实安装成功，但真实启动不能激活 provider host。
- 阅读真实 TabDescriptor/TabComponentProps 和官方指南 §4：契约可以承载 ATN 面板；问题不在字段猜测。
- 未使用 force/legacy-peer-deps，未开启版本风险豁免，未补回 invariants/shim，未回退已完成 A。
- 未改用户的 Desktop/真实 profiles；隔离数据仅在 `.scratch`。未调用付费模型。
- 未创建 C 的产品实现、未注册新 peer、未删 SVG/layout/locale/截图。双路径、可见性轮询、HMR disposer 与视觉验收均**未完成**，不能记作通过。

## 建议的下一步

先让 better-sidebar 发布支持 Harness 0.2.1-alpha.2 的版本：迁移 host `webRuntime` 到 `webStartup` 的 trustedHosts 契约，移除已删除的 invariants 声明，并同步预发布 peer 范围。对该版本验证正常 npm 解析和真实 profile 激活，再继续 ATN 的 C。不要只改 metadata 而保留已经实测失效的 host 注入。
该 upstream 适配不属于当前 C 的 client-only 范围。本轮停在这里，没有擅自扩展成第二个插件的实现任务。

## 已完成部分

A 与 B 均独立完成、提交并通过全部闸门；最新为 **550 runtime/集成 + 8 UI 全通过、0 skipped**，typecheck/build/pack/目标 profile smoke 全绿。N=8→4、N=32→6，五 seed 两种既有实验配置无翻转；工具 schema/fixed context=4749/5910 bytes。
原有生产客户端尚在，因此当前 README 的图形功能仍是真实描述；本轮没有提前删图/宣称结构化面板已上线。声明统一审计、D 决策记录和全阶段最终验收尚未完成。
