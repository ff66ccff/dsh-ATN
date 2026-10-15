# dsh-ATN Harness 0.2.1-alpha.2 适配实施说明

这份文档交给实现代理执行。dsh-ATN 当前把全部 `@deepseek-ai/*` 依赖锚定在 `0.2.0-rc.2`；本轮把它适配到 **`0.2.1-alpha.2`**。适配的性质是**依赖与契约对齐**，不是功能变更：除第 4 节明确列出的必要改动外，**不得改变任何运行时行为**。

实现代理在动手前必须先完整阅读本文件，并按第 8 节完成标准交付。

## 1. 当前基线（已独立核实）

- 工作区：`D:\dsh-ATN`，分支 `codex/release-ready`，工作树干净。
- `npm test` 为 **542 项 runtime／集成 + 8 项 UI，全部通过，0 跳过**（本轮开工前实测，退出码 0）。
- 版本锚定：`package.json` 的 `peerDependencies` 与 `devDependencies` 中全部 `@deepseek-ai/dsh-*` 均为 `0.2.0-rc.2`；`@deepseek-ai/cordis` 为 `4.0.4`。
- npm dist-tags（实测）：`latest` → `0.1.0-rc.6`（陈旧，**不是**目标）、`next` → `0.2.0-rc.2`（当前锚定）、`alpha` → `0.2.1-alpha.2`（**本轮目标**）。
- upstream 仓库 HEAD 为 `d743267388`（`release-0.2.1-alpha.2` 的合并提交），与 `alpha` 标签一致。
- 客户端入口：`src/client/index.tsx` 的 `inject = ['slots', 'locale', ...transportInject]`（`:16`），`apply(ctx)` 注册 locale、注入 `<style data-plugin="dsh-atn">`、并 `ctx.slots.inject('conversation.session.header.actions', …)`（`:32-35`）。
- 客户端 bundle 由 `scripts/build-client.mjs` 用 esbuild 打成懒加载 CJS，模块 id 为 `"dsh-atn"`，`external` 为 `react` / `react/jsx-runtime` / `react-dom` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-ui-primitives`。

## 2. 目标版本与已确证的契约稳定性

**0.2.1-alpha.2 是目标版本。** 以下三项经逐文件比对**已确认在 `0.2.0-rc.2` → `0.2.1-alpha.2` 之间未变**，因此本插件现有的槽位注册方式无需重写：

1. `dsh.client` 清单契约（`packages/client/modules/src/client/manifest.ts`、`scripts/verify-client-packages.ts`）——**逐字节相同**。
2. `@deepseek-ai/dsh-client-ui-slots` 的注册表 API（`packages/client/ui-slots/src/index.ts`）——**逐字节相同**；`slots.register({name, id, order}, Component)` 选项未变。
3. `dsh-client-ui-conversation` 的 `SlotMap`（`packages/client/ui-conversation/src/client/contract/slots.ts`）——**键完全相同**；`conversation.session.header.actions` 仍然存在。

**因此本轮的默认预期是「改依赖版本 + 移除已删除的包 + 逐条核对破坏性变更」，而不是重写客户端。** 若实现过程中发现任何一项需要重写，必须停下来在报告中说明，不得静默扩大改动面。

## 3. 必须理解的清单语义（防止误改）

Harness 自身的 `packages/client/AGENTS.md` 明确规定，以下三条**不是**可互换的依赖边，实现代理不得混淆：

| 机制 | 单位 | 时机 | 不满足时 |
|---|---|---|---|
| Cordis 服务 `inject` | 服务名 | 运行时；fiber 等待 | 保持 PENDING |
| 模块图 `external` | 模块说明符 | 物化；`require` 同步且不能等待 | 当场抛错 |
| `dsh.client.inject` | 包名 | **仅信息性**（预检展示、HMR diff） | 不影响激活顺序 |

关键推论：

- **`dsh.client.inject` 不决定激活顺序。** 激活顺序只由 Cordis fiber 对**服务**的 inject 等待决定。不得为了让插件先于某物加载而往 `inject` 里加包名。
- **基线模块是隐式的，不得重复声明。** React、Cordis、`client/store`、`ui-primitives`、`ui-slots`、`ui-dockkit` 由平台供给；清单中不应重复列举它们。
- **`dsh.client.external` 不是特性插件的依赖机制。** 只有基础设施、传输或生成装配才可以申请非基线模块身份。
- **特性插件不得运行时 import 另一个特性插件的值**，也不得用 `dsh.client.external` 获取它们。共享声明用 `import type`；行为跨包走注入的 Cordis 服务；UI 跨包走槽位。

## 4. 必须实施的项目

### 4.1 版本对齐

要求：

- 把 `package.json` 中**全部** `@deepseek-ai/dsh-*` 的 `peerDependencies` 与 `devDependencies` 从 `0.2.0-rc.2` 提升到 `0.2.1-alpha.2`。
- `@deepseek-ai/cordis` 保持 `4.0.4`（除非 upstream 在该版本要求变更——若要求变更，必须在报告中给出依据）。
- `package.json` 的 `overrides.dsh-opencode-go` 段落中列出的全部 `@deepseek-ai/dsh-*` 版本同步提升，不得遗漏。
- `engines.node` 与 `dsh` 相关声明保持不变。

验收测试：

- 静态断言：`package.json` 中不再出现 `0.2.0-rc.2`。
- `npm ci`（或 `npm install`）在全新 `node_modules` 上成功。
- `npm run typecheck` 通过。

### 4.2 移除已删除的包

要求：

- **`@deepseek-ai/dsh-invariants` 在 0.2.1-alpha.2 中已被彻底删除**（对应的 upgrade guide 为 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants`）：包不存在，`InvariantRegistry`、`InvariantInstaller`、`InvariantFailure`、`InvariantError`、`ctx.invariants` 及所有 `<pkg>/invariant` 子路径导出全部移除。
- 实测：本仓库 `src/`、`tests/`、`examples/`、`experiments/`、`scripts/` 中**没有任何一处引用它**。因此改动只是从 `package.json` 的 `devDependencies` 中删除该行。
- 不得为了「保持兼容」而保留该依赖或加 shim。

验收测试：

- `package.json` 中不再出现 `dsh-invariants`。
- 全仓库 grep `invariants` 无命中（除文档历史记录外）。

### 4.3 逐条核对破坏性变更

必须阅读 **`docs/upgrade-guide/v0.2.0-rc.2/`（5 篇）与 `docs/upgrade-guide/v0.2.1-alpha.1/`（17 篇）**，并对每一篇给出「影响 / 不影响 + 依据」。已知与本插件相关的条目如下，**其余条目也必须逐篇核对，不得跳过**：

**(a) `agent-preset-registry` 导出破坏性变更 —— 必须实测确认。**
upstream `packages/preset/agent-preset-registry/src/index.ts` 中 `serviceForAgent` 改名为 `serviceForMount`，`standingMountFor` 与 `livePresetMounts` 被移除，新增 `inspectCompositions()` 与类型 `AgentPresetInspection`。本插件的使用点是：

- `src/client/NetworkAction.tsx:7` —— `import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'`（纯类型）
- `src/runtime.ts:25` —— `import type {} from '@deepseek-ai/dsh-agent-preset-registry'`（纯类型）
- `tests/fixtures/kernel.ts:16` —— `import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'`（**运行时默认导入**）
- `tests/integration/preset.test.ts:9` —— `import type { PresetDefinition }`（纯类型）

要求：**必须实测确认默认导出 `AgentPresets` 与类型 `PresetDefinition` 在 0.2.1-alpha.2 中仍然存在。** 上述被移除的三个导出名在本仓库中未出现，但默认导出未经验证——不得假定其存在。

验收测试：`tests/fixtures/kernel.ts` 与 `tests/integration/preset.test.ts` 在提升版本后编译并通过。

**(b) `ToolPresentationMode` 收紧。** `'both'` 在 `dsh-tools`、`dsh-agent-tool-presentation`、`DSH_TOOLS_MODE` 与 `ctx.tools.presentAs()` 中被拒绝，只接受 `'native' | 'ptc'`。实测本仓库 `src/` 中无 `presentAs` / `PresentationMode` / `'both'` 命中。核对后若确认无影响，在报告中写明依据。

**(c) `{{cwd}}` 与 `config.cwd` 移除。** 实测本仓库 `src/` 中无 `{{cwd}}` / `config.cwd` 命中。

**(d) 未标记 `<style>` 的归属规则变化。** upstream `packages/client/modules/src/client/system.ts:66-86` 的 `claimStyles` 现在只把**在该 factory 自身运行期间新增**的未标记 `<style>` 归属给该插件。本插件注入的样式在 `src/client/index.tsx:24-30` 显式设置 `sheet.dataset.plugin = 'dsh-atn'`，且模块 id 为 `dsh-atn`（`scripts/build-client.mjs` 的 banner），**属于「预标记」路径**，与 `claimStyles` 的 `style[data-plugin="dsh-atn"]` 选择器一致。

要求：核对后确认行为不变；并在报告中记录该结论与依据（源码行号）。

**(e) profile 不再自动安装 peer（`experimental-package-composition`）。** 「安装一个包不会挂载它」「只启用已被移除行的 patch 不会插入其插件」。本插件的 `cordis.patch.yml` 与 `package.json` 的 `dsh.bundle.patch` 必须核对：patch 插入的行名与 id 是否仍然有效。

验收测试：`npm run smoke:profile` 通过，且输出确认 ATN 工具确实注册（不只是安装成功）。

**(f) `run_code` 在 Agent 下需要 `workingDirectory` 服务。** 本插件不提供 `run_code`；核对确认无影响。

**(g) `ConversationSessionInjected.bindDraftMirror` → `bindDraftPersistence`（签名同时由 `(text: string)` 改为 `(draft: DraftSnapshot)`）。** 实测本插件未使用该成员；核对确认无影响。

**(h) 子路径插件展示清单来源变化**（标题/描述改从 `./<sub>/locale/*.json` 的 `meta.title`/`meta.description` 读取，图标从 `./<sub>/icon`）。本插件为**顶层插件**（非子路径插件），核对确认无影响。

### 4.4 不得改变运行时行为

要求：

- 本轮**不新增、不删除、不重命名**任何模型工具；不改任何工具 schema；不改 `maxCollaborationPeers` 等配置语义（出度曲线是**另一份 brief** 的工作，见 `docs/DYNAMIC_DEGREE_IMPLEMENTATION_BRIEF.md`，两份不得混做）。
- 不改 `src/client/` 的注册方式（槽位注册在 0.2.1-alpha.2 中仍然有效，见第 2 节）。
- 不改持久化 domain 版本。

验收测试：

- `npm test` 的 542 + 8 项全部继续通过，**且断言强度不降低**。
- `toolSchemaBytes` 与 `fixedContextBytes` 与基线一致（给出实测前后数字）。

## 5. 必须保留的既有语义

- 入口 Agent 由宿主拥有；完成、停止、退休都不 `dispose` 入口。
- 网络记录是唯一原子持久化单元；「检查 + 修改」在同一 mutation 临界区内完成。
- 边是单向的；出生谱系只作追溯。
- 工具身份、发送者、投票者取自真实 live Agent。
- 同伴文本不构成人类授权；请求者评价不构成宿主验收。
- `stepBudget` 不得被宣称成 token、HTTP 请求或费用上限。
- 持久化 domain 版本保持为 1。

## 6. 不要做的事

1. 不重写客户端注册方式——除非第 4.3 节实测发现它确实失效，且必须在报告中说明。
2. 不为已删除的 `dsh-invariants` 加兼容 shim 或保留依赖。
3. 不往 `dsh.client.inject` 里加包名来「修」激活顺序（该字段不控制激活顺序，见第 3 节）。
4. 不重复声明基线模块（React、Cordis、`client/store`、`ui-primitives`、`ui-slots`、`ui-dockkit`）。
5. 不引入对 `@deepseek-ai/dsh-*` 的运行时 import 以获取其他特性插件的值。
6. 不把版本提升与出度曲线改动、better-sidebar 接入混在同一次提交里。
7. 不删除已有测试，不降低断言强度。
8. **不得把未测试内容写成已通过。**

## 7. 无法确定时的处理

第 4.3 节中标注「必须实测确认」的条目（尤其是 (a) 的默认导出 `AgentPresets`）**必须在提升版本后由编译器和测试实际验证**，不得靠阅读源码推断。若某项无法在本轮确认，必须在报告中明确写出「未确认」及其原因，**不得补造证据，也不得写成已通过**。

## 8. 完成标准

实现代理必须完成以下命令并保留输出摘要：

```text
npm ci
npm run typecheck
npm test
npm run build
npm run pack:tarball
npm run smoke:profile
```

并且：

1. 第 4.3 节的 17 + 5 篇 upgrade guide **逐篇**给出「影响 / 不影响 + 依据」结论表，不得只列相关条目。
2. 给出 `AgentPresets` 默认导出与 `PresetDefinition` 类型的实测确认结果。
3. 给出 `toolSchemaBytes` / `fixedContextBytes` 的前后实测数字，确认行为未变。
4. `npm test` 542 + 8 全部通过；因契约变化而必须修改的断言逐条给出理由，**不得直接删除用例**。
5. 在 `package.json` 中记录 `engines.dsh`（或等价声明）指向 0.2.1-alpha.2 的最低兼容版本。
6. README 与本轮报告同步记录实际通过项与未完成项。

交付物：

- `package.json` 与锁文件改动。
- upgrade guide 逐篇核对结论表。
- 字节数前后对比。
- `docs/` 下的一份本轮实施报告。

## 9. 已知未验证项（实现代理必须自行确认，不得当作已确认）

1. `v0.2.1-alpha.1` 的 17 篇 guide 是否逐条适用于本插件——**未验证**，本轮由实现代理逐篇判定。
2. `AgentPresets` 默认导出在 0.2.1-alpha.2 中是否存在——**未验证**。
3. `packages/session/*` 的 domain API 未做穷尽比对——若本插件的存储路径受影响，实现代理必须自行发现并报告。
4. `dsh-tools` 的 `ToolDefinition` 接口只比对了 `packages/core/tools/src/index.ts` 的 220–300 行区间，该文件其他位置可能存在变更——若本插件的工具注册受影响，实现代理必须自行发现并报告。
