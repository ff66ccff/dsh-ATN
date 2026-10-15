# dsh-ATN 接入 better-sidebar 实施说明

这份文档交给实现代理执行。本轮做两件事：**彻底移除本插件自绘的拓扑图**（内联 SVG、环形布局、缩放/平移），把 ATN 网络状态改为**结构化面板**；并把该面板**接入 better-sidebar 的 `registerTab`**，成为原生右侧栏的一个 tab。better-sidebar 是**可选依赖**，未安装时必须保留现有入口作为回退。

实现代理在动手前必须先完整阅读本文件，并按第 8 节完成标准交付。

## 1. 当前基线（已独立核实）

- 工作区：`D:\dsh-ATN`，分支 `codex/release-ready`，工作树干净。
- `npm test` 为 **542 项 runtime／集成 + 8 项 UI，全部通过，0 跳过**（本轮开工前实测，退出码 0）。
- **注册点**：`src/client/index.tsx:32-35` 通过 `ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'atn-network', order: 10, locale: NS, inject: (): NetworkActionInjected => ({ readSnapshot }) }, NetworkAction))` 注册。
- 模块 `inject`：`src/client/index.tsx:16` 的 `export const inject = ['slots', 'locale', ...transportInject]`。
- 样式注入：`src/client/index.tsx:24-30` 向 `document.head` 追加 `<style data-plugin="dsh-atn">`。模块 id 为 `dsh-atn`（`scripts/build-client.mjs` 的 banner）。
- **自绘图形**：`src/client/NetworkAction.tsx:145-193` 的 `Topology` 组件渲染内联 `<svg className="atn-canvas">`，每个边一条 `<path data-atn-edge data-atn-edge-kind>`，每个节点一个 `<g role="button">`。容器是 `Modal`。
- **布局算法**：`src/client/layout.ts` —— 入口节点在 (420, 280)，其余节点按每环 10 个排布，半径 `170 + ring * 130`；`edgeLine` 端点内缩 28 / 34。
- **数据通道**：`src/client/transport.ts:14` 的 `connection.rpc.call('/api', 'atnObserver/snapshot', { args: { sessionId } }, signal)`，由 `atnObserverSnapshotSchema` 解析。**轮询**：`src/client/NetworkAction.tsx:83` 在面板打开时每 1000 ms 拉一次。
- **预设门控**：`src/client/NetworkAction.tsx:46` 仅当会话预设为 `atn` 时显示入口。
- **locale**：命名空间 `NS = 'atn-network'`（`src/client/locales.ts`）。图形相关键位于 `zh:6-29` / `en:37-60`。
- **本插件 host 半不需要新增 HTTP 路由**：观察数据已由本插件自己的 RPC（`atnObserver/snapshot`）提供，因此 better-sidebar 的 `/sidebar/api/*`、`/sidebar/file`、`/sidebar/ws/*` 与 `hostRouteUrl()` 规则**本轮不适用**。

## 2. better-sidebar 侧的对接契约（已独立核实）

- **服务名**：`ctx.betterSidebar`。由 better-sidebar 的 client half 在 `apply()` 开头执行 `ctx.provide('betterSidebar', service)`（其 `src/client/index.tsx:171`）。
- **仅存在于浏览器侧**：host 半没有该服务。
- **注册 API**：`registerTab(descriptor: TabDescriptor): () => void`。`TabDescriptor` 定义于其 `src/client/service.ts:168-292`。
- **组件契约**：`TabComponentProps`（其 `src/client/service.ts:149-165`）含 `ctx`、`store`、`scope: SessionScope { sessionId, cwd? }`、`tab: SidebarTab { id, type, title, path?, line?, diff?, meta? }`、`visible: boolean`。**没有 URL 路由、没有渲染回调、没有序列化载荷**——组件是 React 组件，自己取数。
- **重复 id 抛错**：`tab type "X" already registered`（其 `src/client/service.ts:912-924`）。注册必须放在 `ctx.effect(() => …)` 里，由 fiber 在卸载/HMR 时自动释放。
- **落地位置**：`registerTab` 的描述符会被自动注册进 DSH **原生右侧栏**，`kind = descriptor.id`，实现 id 为 `dsh-better-sidebar:${descriptorId}`（其 `src/client/native/index.ts:104-106`）。
- **`bottomOnly: true`**（其 `src/client/service.ts:203-226`）只活在插件自己的底部工作台，且**不占原生 guide 行**。本插件要的是右侧栏 tab，**因此不得设 `bottomOnly`**。
- **能力探测**：服务暴露 `readonly version`（`SIDEBAR_SERVICE_VERSION = '0.26.0'`，其 `service.ts:822`）与 `readonly features: readonly string[]`（`SIDEBAR_FEATURES`，其 `service.ts:850-865`）。需要新能力时按 `features` 探测，**不要按版本号比较**。
- **类型合并**：`ctx.betterSidebar` 的类型由 better-sidebar 通过 `declare module '@deepseek-ai/cordis'` 提供（其 `src/context-types.ts:894-898`）。用 `import type {} from 'dsh-better-sidebar'` 触发。**该 type-only import 编译时被擦除，不产生运行时依赖。**
- **无画布/iframe/自定义视图扩展点**：better-sidebar 不提供。最接近的就是 `registerTab` 里自己渲染组件。若将来需要图形，先例是 better-sidebar 自己的 Tasks 图（其 `src/client/tasks-graph-layout.ts`）与第三方 `dsh-flowglass` / `dsh-dev-git-graph`。
- **正文高度契约**：tab 根元素需要 `flex: 1; height: 100%; min-height: 0`（其 `docs/external-plugin-guide.md` §10）。
- **权威文档**：better-sidebar 仓库 `docs/external-plugin-guide.md`（§1 机制、§2 类型合并与依赖声明、§3 最小示例、§4 Tab API、§7 服务清单、§10 高度契约、§13 完整示例）。实现代理必须完整阅读该指南。

## 3. 必须实施的项目

### 3.1 彻底移除自绘图形

要求：

- 删除 `src/client/NetworkAction.tsx` 中的 `Topology` 组件（`:145-193`）及其内联 SVG。
- 删除 `src/client/layout.ts` 整个文件（环形布局与 `edgeLine` 端点内缩）。
- 删除 `src/client/styles.ts` 中仅供图形使用的样式。实测清单（`styles.ts:18`）：`.atn-canvas`、`.atn-edge`、`.atn-edge-birth`、`.atn-edge-selected`、`.atn-edge-faded`、`.atn-arrow`、`.atn-arrow-birth`。**注意 `.atn-canvas` 还出现在两处媒体查询里（`styles.ts:23` 与 `:24`），必须一并清理，否则会留下悬空规则。**
- 删除 `src/client/locales.ts` 中仅供图形使用的键（实测位置：`zh:15-17`、`en:46-48`）：
  - 图形本体与缩放控件：`graph`、`graphHelp`、`zoomIn`、`zoomOut`、`reset`、`fit`。
  - **`birthEdges` 是图形上的「显示创建关系」开关标签，不是分组标签**——结构化面板若不再提供该开关，一并删除；若保留开关则保留。
  - **必须保留** `collaboration` 与 `birth`：这两个是**边的分组标签**（「协作邻接」/「创建关系」），结构化面板仍需用它们区分两类边。
- **不得**保留图形代码作为「将来可能用到」的死代码，也不得用注释保留。

验收测试：

- 全仓库 grep `atn-canvas`、`atn-edge`、`<svg`、`zoomIn`、`zoomOut` 在 `src/client/` 下无命中。
- `src/client/layout.ts` 已删除，且无残留 import。
- 构建产物 `lib/client.js` 中不再包含 SVG 相关代码路径。

### 3.2 结构化面板（主视图）

要求：

- 用 better-sidebar 的原生语汇（列表 / 分区 / 表格 / 详情）替代图形，至少覆盖：
  - **节点列表**：每个节点的状态、当前负载、正在执行的动作、步数配额余量、历史履约率。
  - **出边分组**：**协作边**（`peerIds`）与**出生谱系**（`creatorId` / `selectedChildId`）分开呈现——现有图形用 `data-atn-edge-kind="birth"` 区分，结构化面板必须保留这一区分。
  - **节点详情**：选中节点的邻居、任务、孤儿任务、局部遥测、剩余预算（对应 `atn_status()` 的只读面）。
  - **活动流**：现有 `Activity` 信息流保留。
- 面板必须是一个**纯 props 展示组件**：不依赖 `ctx.betterSidebar`、不自己订阅数据、不自己拉取。数据与回调由宿主注入（见 3.4）。
- 全部产品可见文案走现有 `atn-network` locale 命名空间，不得硬编码字符串。
- 根元素遵守高度契约 `flex: 1; height: 100%; min-height: 0`。

验收测试：

- 组件测试直接喂 props，断言用户可见行为（节点行、边分组、详情、活动流），**不断言类名或渲染次数**。
- 断言协作边与出生谱系在渲染上可区分。
- 断言文案全部来自 locale 命名空间（无硬编码）。

### 3.3 可选依赖与**回退必须真的可用**（本轮的实现陷阱）

要求：

- `package.json`：`dsh-better-sidebar` 声明为 **`peerDependencies`** 且 `peerDependenciesMeta` 中 `optional: true`。**不得**放进 `dependencies`（会产生两份实例）。
- 用 `import type {} from 'dsh-better-sidebar'` 触发类型合并，**不得**运行时 import 该包的任何值。

> ⚠️ **陷阱，必须正确处理。** better-sidebar 官方指南的写法是把 `'betterSidebar'` 放进模块 `inject` 数组。**本插件不能照抄**：本插件的 `apply()` 还负责注册回退入口与 locale/样式，若 `inject` 声明的服务永不出现而 Cordis 让 fiber 保持 PENDING，则 `apply()` 根本不运行，**回退入口也不会注册**——「保留回退」这一要求会静默失效。
>
> 正确做法：**模块 `inject` 保持 `['slots', 'locale', ...transportInject]` 不变**，让 `apply()` 无条件运行；在 `apply()` 内部对 `ctx.betterSidebar` 做可用性处理（Cordis 作用域注入，或读取时判 `undefined`）。实现形态由实现代理选择，但**两条路径都必须有测试证明**。

- **服务存在时**：注册 better-sidebar tab（id 需命名空间化，例如 `atn-network`，避免与其他插件冲突——重复 id 会抛错）。
- **服务不存在时**：不得抛错；注册现有 header 入口作为回退，回退里渲染**同一个结构化面板组件**（不再是 Modal 里的图形）。
- **回退不得是空实现**：必须能真正看到网络状态。

验收测试（两条路径都必须覆盖，这是本轮最重要的测试）：

- 桩掉 `ctx.betterSidebar` 为 `undefined`：断言 `apply()` 不抛错、回退入口已注册、面板可渲染并显示快照数据。
- 提供桩服务：断言 `registerTab` 被调用一次、id 正确、`ctx.effect` 的 disposer 在卸载时被调用。
- 断言 `package.json` 中 `dsh-better-sidebar` 在 `peerDependencies` 且 `optional: true`，不在 `dependencies`。
- 断言 `src/client/` 下不存在对 `dsh-better-sidebar` 的运行时 import（只有 `import type`）。

### 3.4 数据通道与轮询

要求：

- 保留现有 RPC 数据通道（`connection.rpc.call('/api', 'atnObserver/snapshot', …)`）与 schema 校验，**不新增 host 路由**。
- 轮询必须由 **`visible`** 驱动：tab 不可见时停止轮询，可见时恢复。这比现状（Modal 打开即轮询）更省，也是接入 tab 之后自然可得的改进。
- 轮询必须**串行**且可取消：不得并发叠加请求；关闭/切会话/卸载时必须 abort。**现有实现已满足这两点（见基线第 1 节的既有测试），不得回退。**
- 切会话时取消旧请求并忽略其迟到响应。

验收测试：

- 断言 `visible === false` 时不发起请求；变为 `true` 后才开始。
- 保留并继续通过现有 8 项 UI 测试中关于串行轮询、abort、切会话、卸载的四项行为断言。

### 3.5 预设门控保持

要求：

- 仅当会话预设为 `atn` 时提供入口/tab（现状 `src/client/NetworkAction.tsx:46`）。非 ATN 会话不得取数。
- 从 ATN 会话切到非 ATN 会话时，入口消失、轮询中止、状态重置。

验收测试：

- 保留并继续通过现有关于预设门控、切换会话隐藏入口、不取数的行为断言。

## 4. 必须同步的文档与资产

- **`README.md:73-86`**（「📊 原生 Web GUI 实时拓扑看板」整节）：改写为结构化面板的描述。**必须删除对「动态有向连通图」的描述**，因为图形已不存在。
- **`docs/assets/atn-web-gui.png`**：该截图是已删除图形的画面。必须替换为结构化面板的新截图，或在该图未更新前**删除图片引用**。**不得**留下描述已不存在功能的截图。
- `README.md` 的安装与配置说明中补充 better-sidebar 为可选依赖及其回退行为。
- 若 `docs/README.md`（文档索引）列出了受影响的文档，同步更新。

## 5. 必须保留的既有语义

- 入口 Agent 由宿主拥有；完成、停止、退休都不 `dispose` 入口。
- 网络记录是唯一原子持久化单元；「检查 + 修改」在同一 mutation 临界区内完成。
- 边是单向的；出生谱系只作追溯。
- 工具身份、发送者、投票者取自真实 live Agent。
- 同伴文本不构成人类授权；请求者评价不构成宿主验收。
- `stepBudget` 不得被宣称成 token、HTTP 请求或费用上限。
- 观察通道必须保持**纯只读**：绝不主动唤醒模型、不增加 token 费用、不写网络状态。
- 持久化 domain 版本保持为 1。

## 6. 不要做的事

1. 不照抄 better-sidebar 指南把 `'betterSidebar'` 放进模块 `inject`（见 3.3 陷阱）。
2. 不把 `dsh-better-sidebar` 放进 `dependencies`，不运行时 import 它的值。
3. 不设 `bottomOnly`（要的是右侧栏 tab）。
4. 不新增 host HTTP/WS 路由——数据通道已够用。
5. 不为已删除的图形代码留死代码或注释。
6. 不新增模型工具，不改任何工具 schema，不改出度/配置语义。
7. 不删除已有测试，不降低断言强度。
8. **不得把未测试内容写成已通过。**

## 7. 与另外两份 brief 的边界

本轮**只做 UI 承载面与呈现方式的替换**。以下两件事属于别的 brief，**不得混做**：

- 出度曲线与配置语义：见 `docs/DYNAMIC_DEGREE_IMPLEMENTATION_BRIEF.md`。
- harness 版本提升：见 `docs/HARNESS_0_2_1_ADAPTATION_BRIEF.md`。

若实现过程中发现必须先做其中之一才能继续，**停下来在报告中说明**，不要顺手做掉。

## 8. 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm test
npm run typecheck
npm run build
npm run pack:tarball
npm run smoke:profile
```

并且：

1. 全部原有测试继续通过；因图形移除而必须修改的断言逐条给出理由，**不得直接删除用例**。
2. 3.3 的**两条路径**（服务存在 / 服务不存在）各有可核对的修复前失败记录（无法重放的必须逐项列出，不得补造证据）。
3. 给出删除清单：删除的文件、删除的样式类、删除的 locale 键，逐项列出。
4. 给出 `lib/client.js` 的体积前后对比（图形移除应带来可见下降）。
5. 完成第 4 节的 README 与截图处理，逐条列出改了什么。
6. README 与本轮报告同步记录实际通过项与未完成项。

交付物：

- 代码与测试改动。
- 删除清单与 bundle 体积对比。
- 双路径（有/无 better-sidebar）的验证记录。
- `docs/` 下的一份本轮实施报告。

## 9. 预期需要修改的既有测试（实现前逐条确认）

这些用例断言了图形结构或 Modal 容器，图形移除后必然需要重写为结构化面板断言；**逐条确认其覆盖的行为不丢失**：

- `tests/client/observer-ui.test.tsx:181-205` —— 断言 `[data-atn-edge]`、`[data-atn-edge-kind="birth"]`、`aside`、`.atn-goal`、`.atn-metrics`、`.atn-trigger`、`[role="dialog"]`。其中 `.atn-trigger`（入口存在）与 `[role="dialog"]`（Modal 容器）随承载面变化；`[data-atn-edge*]`（协作边 vs 出生边可区分）**必须保留等价断言**。
- `tests/client/modal-fixture.tsx` —— 夹具随容器形态调整。
- `tests/smoke/visualization-smoke.ts`
- `tests/smoke/visualization-observer.mjs:61, 65-67, 130` —— 断言 bundle 内含 `atnObserver` 与 `/api` RPC；数据通道未变，应继续通过。

## 10. 已知未验证项（实现代理必须自行确认）

1. `TabDescriptor` 的**完整字段清单**（其 `src/client/service.ts:168-292`）与 `TabComponentProps` 的完整形状，未在本文件中逐字段展开——实现代理必须直接阅读该文件与官方指南 §4，**不得只依据本文件推断字段名**。
2. `ctx.betterSidebar.features` 的具体成员名未逐一核对——需要探测能力时按实际源码为准。
3. Cordis 对「`inject` 声明了永不出现的服务」的确切语义未在本仓库验证。3.3 的陷阱分析基于官方指南文本与其自相矛盾之处（既称「保证服务就绪后才激活」，又称「未安装时照常加载且 `ctx.betterSidebar` 为 undefined」）。实现代理**必须用实际测试确定该语义**，而不是接受本文件的推断。
4. better-sidebar 的 tab 会新增一行「新建标签页列表」条目，而宿主只在 guide 条目 ≤ 4 条时渲染说明（其指南记载 `MAX_DESCRIBED_ENTRIES = 4`）。本插件的加入是否会挤掉其他条目的说明，**未验证**；若会产生可见回归，在报告中说明。
