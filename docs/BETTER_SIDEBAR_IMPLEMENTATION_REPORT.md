# 阶段 C：结构化观察面与可选侧栏实施报告

日期：2026-10-14。代码基线 `f47eec0`；修复前测试提交 `4554c42`。用户在外部 provider 阻塞报告后授权自行权衡、尽可能达成目标。本阶段完成 ATN 客户端改造及有/无服务路径；**better-sidebar 0.26.0 在目标 Harness 上的完整 host 激活仍未完成**。

## 已实现的行为

`NetworkView.tsx` 是纯 props 展示组件。节点表显示生命周期/运行态、待处理任务、当前工具、剩余步数、B 的有效连接额度余量；协作邻接与出生关系分区展示有向 source→target；选中节点显示邻居、相关任务、结果、预算和待审议数，保留活动流。所有说明走 `atn-network` 中英文 locale；根容器满足 flex/height/min-height 契约。

历史指标明确为观察快照窗口内的「已提交 / 已结算」，不是全生命周期履约率或宿主验收率。遗留任务区只列失败/退休节点的失败或不可达尝试；observer 没有完整 retryOf/保管授权判定，故明确要求用 atn_status 确认可认领性，不假装与模型 status 全字段等价。补齐这类只读聚合列入 D 的后续缺口，本阶段不扩大 host 契约。

模块 inject 保持 `['slots','locale',...transportInject]`，父 scope 无条件注册 header、locale、style。`ctx.inject(['betterSidebar','sessions'], …)` 子作用域在服务可用时通过 `ctx.effect` 注册 `atn-network` tab，丢失服务/卸载自动释放。未设 bottomOnly。Header 始终保留，两个载体渲染同一个组件；缺少或不能激活 provider 时仍可点击「ATN 网络状态」查看真实状态。

注册描述符的 available 只允许 ATN；真实 provider API 在非 ATN guide 中会**禁用条目**，并非删除全局描述符。组件自身独立订阅当前 preset，非 ATN 返回空且停止请求/清空状态。不能将菜单禁用声称为条目完全隐藏。

`ObserverHost` 统一按 visible 串行轮询：请求完成后 1000ms 再读；关闭、隐藏、切会话、切 preset、卸载 abort，忽略旧响应。transport/RPC/schema 原样复用，无新路由、模型工具或写入口。

## 依赖与类型处理的权衡

`dsh-better-sidebar:^0.26.0` 只声明 optional peer，没有运行时值 import，也没有装进 devDependencies。该版 publisher 的 Cordis peer `^4.0.4` 与 `4.0.5-alpha.1` 普通 npm 解析冲突，且其 host 仍依赖已删除的 webRuntime。保留隔离安装/启动事实：[清单](execution-evidence/C-sidebar-manifest.json)、[npm ERESOLVE](execution-evidence/C-install-compat.txt)、[CLI 安装成功](execution-evidence/C-profile-compat.txt)、[启动 pending](execution-evidence/C-sidebar-boot.txt)。安装成功不代表激活成功。

后续修订（2026-10-15）：上述范围是本阶段的历史基线，当前声明已收窄为精确的可选 peer `dsh-better-sidebar:0.26.0`，并接入独立 CI 双检查。仅此版本在验证集合内，见[残余验证缺口实施报告](RESIDUAL_VERIFICATION_GAPS_IMPLEMENTATION_REPORT.md)。

因此使用 consumer-owned 的窄 type-only Tab API 投影及 client tsconfig paths；`import type {} from 'dsh-better-sidebar'` 触发 Context 合并，编译擦除。这是对 brief 依赖接入方式的明确调整，不是模拟运行时 provider。NOTICE 保留投影来源的 MIT attribution。实际阅读 published service/官方 external-plugin-guide，并用两项补充检查限定风险：

- `SIDEBAR_PACKAGE_DIR=<隔离安装的0.26.0目录> node scripts/verify-sidebar-contract.mjs`：生成 descriptor→published TabDescriptor 赋值 fixture，strict 类型检查通过；publisher declaration SHA256 `404cbe44621280ad3109b8849ab01fd9284ed306260d78bc341c51a906025ac9`。[输出](execution-evidence/C-published-contract.txt)。skipLibCheck 跳过 publisher 旧依赖声明，**只证明所用接口形状兼容**。
- 同环境 `node scripts/verify-sidebar-registry.mjs`：使用真实已发布 createBetterSidebarService/createSidebarStore，真实 Cordis 注册 ATN，验证唯一 id、重复抛错、卸载释放、重挂载成功，零模型调用。[输出](execution-evidence/C-real-registry.txt)。这是实际注册服务验证，**不是完整 sidebar host/browser 运行证明**。

未改上游插件、未补 webRuntime shim、未 force/legacy-peer-deps、未使用风险豁免、未改真实用户 profile。完整右侧栏联合启动仍需 provider 上游迁移 webRuntime→webStartup 及预发布 peer 元数据，并再次运行安装/激活/browser 验收。

## 双路径与既有测试

[修复前记录](execution-evidence/C-PRE_FIX_RECORD.md)：10 UI tests，8 pass / 2 assertion fail，非导入失败。ABSENT 没有节点 table；PRESENT 未注册 tab。disposer 断言未运行到，不补造修复前失败。

修复后 14 UI 全通过：ABSENT 真实 Cordis apply+结构化回退取数；PRESENT 注册与卸载；PENDING 证实 required inject 缺失确会阻止 apply，而可选子 scope 不阻止 header，服务晚到/移除/重挂载均正确；VISIBLE 暂停、串行、abort、切 preset/reset/切 session；VIEW-PROPS 配额/有界统计/候选/分组/locale；MENU ATN 门控+描述符真实渲染取数。原 8 项全部保留。

第 8 项从 SVG path/g/创建关系 checkbox 改为有向分区精确断言：协作 root→child 与 child→root，出生 root→child，节点选择 aria-pressed；保留任务、结果、失败状态、步数、指标、文本转义与选择不额外请求的断言。无 checkbox 因创建关系始终展示；不删关系信息。原 7 项门控、串行、abort、晚响应、卸载、断线重试逻辑继续原义通过。Modal fixture 仅加 FileTypeIcon 空组件用于真实注册服务源码打包，不削弱 Modal 测试。既有 smoke 的 /api/atnObserver 断言未改。

## 删除与资产清单

- 文件：删除 `src/client/layout.ts`；移除 Topology、环形布局、SVG、平移/缩放/fit/reset；共享详情/活动实现迁到 NetworkView。
- 删除样式类（与 B 基线逐项比较）：`.atn-arrow`、`.atn-arrow-birth`、`.atn-canvas`、`.atn-dot`、`.atn-edge`、`.atn-edge-birth`、`.atn-edge-faded`、`.atn-edge-selected`、`.atn-foot-status`、`.atn-graph-area`、`.atn-graph-help`、`.atn-heading`、`.atn-legend`、`.atn-legend-birth`、`.atn-legend-line`、`.atn-main`、`.atn-node`、`.atn-node-dot`、`.atn-node-failed`、`.atn-node-icon`、`.atn-node-retired`、`.atn-node-ring`、`.atn-node-running`、`.atn-node-selected`、`.atn-node-status`、`.atn-toolbar`、`.atn-tools`、`.atn-trigger-label`、`.atn-warning`。媒体查询同步替换，无悬空画布规则。
- 删除 locale 键：两种语言的 `graph`、`graphHelp`、`birthEdges`、`zoomIn`、`zoomOut`、`reset`、`fit`。保留 collaboration/birth。
- client.js：**485539→479789 bytes**，减少 **5750（1.18%）**；未以 gzip 或删除第三方库冒充变化。SIDEBAR-PACKAGE 与源代码/构建 grep 确认旧 SVG/layout 路径消失。
- 替换 `docs/assets/atn-web-gui.png`；`render:screenshot` 直接渲染真实 NetworkView，以确定性 mockSnapshot 生成并人工查看。这是组件示例截图，不是已安装 provider 的联合浏览器截图。README 的旧图描述/入口名、安装可选性在紧接 C 的独立声明审计提交更新。

## 闸门与限制

`typecheck/test/build/pack:tarball/smoke:profile` 全部退出码 0，日志 `execution-evidence/C-{typecheck,test,build,pack-tarball,smoke-profile}.txt`；**551 runtime/集成 + 14 UI，0 fail / 0 skip**。目标隔离 CLI=0.2.1-alpha.2，未用 Desktop 旧 rc.2 CLI 冒充。额外真实 Web profile `smoke:visualization` 通过：6节点、单向跨分支/出生关系、失败结果、live 更新、严格 RPC、只读、client served，[输出](execution-evidence/C-smoke-visualization.txt)。不含已阻塞 provider host 的全链路。

guide 展示限制源码确认：Harness `packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx:45,96` 仅 entries≤4 显示说明；新增 ATN 行可能使 4→5，全部行说明隐藏。未修改宿主阈值或设 bottomOnly 绕过，关键说明在面板内部重复。完整 provider 联合页面未启动，因此具体 profile 下是否跨阈值、视觉是否挤压尚未实测。

十二项不变式：1入口归属不变，lifecycle/stop/retire；2原子网络记录不变，domain/concurrency；3有向边/谱系保留，UI 与 topology；4live 身份不变，agent/preset；5授权与验收不变，information-boundary；6步数不称费用，budget 与 locale；7模型/工具/权限不变，preset/smoke；8观察只读，observer/真实 Web smoke；9domain v1，domain；10五工具/schema 不变，fixed-context；11既有用例无删除/弱化且全通过，改写见上表述；12仅声明实测通过，完整 provider 激活及大网络/付费模型未列入通过。

本阶段客户端验收完成，完整外部插件兼容项保留为明确限制。统一声明审计与 D 分别独立提交，最终整轮矩阵见 [最终验收记录](FINAL_EXECUTION_VALIDATION.md)。
