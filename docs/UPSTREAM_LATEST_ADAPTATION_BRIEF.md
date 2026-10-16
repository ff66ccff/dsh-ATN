# dsh-ATN 上游最新版适配实施说明

> 目标 A：DeepSeek Harness **`dsh-v0.2.1-alpha.4`**（当前锚定 `0.2.1-alpha.2`）。
> 目标 B：`dsh-better-sidebar` **`0.26.1`**（当前精确锚定 `0.26.0`）。
> 上游源码已在工作区：`upstream/deepseek-harness`（tag `dsh-v0.2.1-alpha.4`，commit `86a402200d95fecef4529d969836f1fe13c6cb0d`，2026-10-15）与 `upstream/DSh-better-sidebar`（`0.26.1`，commit `05e64855ed636e6eb68a53b48398fa4b62403248`，2026-10-16）。

这份文档交给实现代理执行。本轮性质是**依赖与契约对齐**，不是功能变更：除第 4 节明确列出的必要改动外，**不得改变任何运行时行为**。

**轮次顺序闸门（强制）**：本轮必须在 substrate 机制引入（[`SUBSTRATE_COORDINATION_INTEGRATION_BRIEF.md`](SUBSTRATE_COORDINATION_INTEGRATION_BRIEF.md)）**之前**完成并全绿。理由与上一轮 A→B→C 相同：依赖基线是所有后续工作的前提，且 substrate 会把模型工具面由 5 个改为 8 个——若两者混做，固定上下文基线的失败信号无法归因。**两份 brief 不得在同一次提交里混做。**

## 1. 当前基线（已独立核实）

- `package.json`：全部 `@deepseek-ai/dsh-*` 的 `peerDependencies` 与 `devDependencies` 锚定 `0.2.1-alpha.2`；`@deepseek-ai/schemastery` 为 `3.18.5-alpha.1`（**dependencies**）；`@deepseek-ai/cordis` 为 `4.0.5-alpha.1`（peer）；`cordis-plugin-include` `1.0.10-alpha.1`、`cordis-plugin-loader` `1.0.6-alpha.1`（devDeps）；`overrides.dsh-opencode-go` 段落把 `dsh-opencode-go@0.1.20` 的十余个传递 dsh 依赖钉在 `0.2.1-alpha.2`。
- `engines`：`{ node: ">=24", dsh: ">=0.2.1-alpha.2" }`。
- optional peer：`dsh-better-sidebar: "0.26.0"`（精确，`peerDependenciesMeta` 标记 optional）。
- 客户端清单：`dsh.client.inject` 为 `@deepseek-ai/dsh-client-ui-conversation`、`-ui-primitives`、`-locale`、`-connection`（`package.json:71-76`）。
- CI：`.github/workflows/ci.yml` 的 `verify` job 跑 `npm ci → typecheck → test → build → pack:tarball`；`sidebar-contract` job 在 `${{ runner.temp }}/atn-sidebar-provider` 隔离安装 `dsh-better-sidebar@0.26.0` 并跑 `npm run verify:sidebar`。
- 测试基线：以本轮**开工前实测**为准（README 与最终验收记录记 551 项 runtime/集成 + 14 项 UI；早期 brief 记 542 + 8。开工前必须重新实测并写下真实数字，不得沿用文档里的旧数字）。

## 2. 目标版本与已确证的契约稳定性

### 2.1 版本对齐面

| 包 | 当前位置 | 目标（alpha.4 实测） |
|---|---|---|
| 全部 `@deepseek-ai/dsh-*` | `0.2.1-alpha.2` | **`0.2.1-alpha.4`** |
| `@deepseek-ai/cordis` | `4.0.5-alpha.1` | **`4.0.5-alpha.2`** |
| `@deepseek-ai/schemastery` | `3.18.5-alpha.1` | **`3.18.5-alpha.2`** |
| `@deepseek-ai/cordis-plugin-include` | `1.0.10-alpha.1` | **`1.0.10-alpha.2`** |
| `@deepseek-ai/cordis-plugin-loader` | `1.0.6-alpha.1` | **`1.0.6-alpha.2`** |
| `dsh-better-sidebar`（optional peer） | `0.26.0` | **`0.26.1`** |

cordis / schemastery / include / loader 的版本依据是上游的 vendored release 提交 `7c8cbea696`（release(vendor): cordis 4.0.5-alpha.2、cosmokit 1.8.6-alpha.2、group 1.0.5-alpha.2、hmr 1.0.20-alpha.2、include 1.0.10-alpha.2、loader 1.0.6-alpha.2、logger-console 1.0.5-alpha.2、schemastery 3.18.5-alpha.2、timer 1.1.7-alpha.2），实测文件 `upstream/deepseek-harness/vendor/cordis/package.json` 与 `vendor/schemastery/package.json`。**这些不是可选升级**：cordis 与 schemastery 是本插件的运行期依赖。

### 2.2 本插件接触面在 alpha.4 仍然成立（已逐条核对，附证据）

| 接触面 | 结论 | 证据 |
|---|---|---|
| 客户端槽位 `conversation.session.header.actions` | **仍存在** | `upstream/…/packages/client/ui-conversation/src/client/contract/slots.ts:229`（键定义）与 `:579`（联合类型成员） |
| `ConnectionHandle` 与 `@deepseek-ai/dsh-client-connection/client` 子路径 | **仍存在** | `packages/client/connection/src/client/index.ts:143`；该包 `exports["./client"]` 仍在 |
| `defineTool` / `ToolDefinition`（`src/tools.ts` 的工具注册） | **签名未变** | `packages/core/tools/src/index.ts` 在 alpha.2→alpha.3 只有 6 行变化（`ptcTransport` 内部上下文传递）；alpha.3→alpha.4 **零改动** |
| `ctx.systemPrompt.section({ order })` | **语义未变**（仅新增保留位） | `packages/core/system-prompt/src/index.ts` 新增 `TEAM_IDENTITY: 125`、`HARNESS_SOURCE: 200`、`WEB_SURFACE: 210`；本插件用 `order: 40`，不受影响 |
| `dsh.client` 清单契约（`packages/client/modules`） | **仅新增可选字段** | alpha.3→alpha.4 的 `client/manifest.ts` 只新增可选 `release?: { version, commit? }`；且 `release` **存在但格式非法时解析会抛错**——本插件不生产该字段，核对确认无影响 |
| `InvocationDescriptor` / typert 协议与注册表 | **零 src 变更** | `packages/typert/protocol/src` 与 `packages/typert/registry/src` 在 alpha.3→alpha.4 无改动 |
| `networkRecordSchema` 无关的 session 事件类型 | 仅新增 `job/registered`、`job/settled` | `packages/core/session/src/known-event-types.ts`（alpha.2→alpha.3），纯增量 |

### 2.3 better-sidebar `0.26.0 → 0.26.1`：**无公开接入 API 变化**

- `git diff v0.26.0..v0.26.1 -- src/client/service.ts` 只有**一行**：`SIDEBAR_SERVICE_VERSION` 由 `'0.26.0'` 改为 `'0.26.1'`。`TabDescriptor`、`TabComponentProps`、`BetterSidebarService`、`SIDEBAR_FEATURES` 源码逐字节相同。
- 上游 CHANGELOG 明确写「无公开接入 API 变化（`ctx.betterSidebar` / TabDescriptor / FileViewerDescriptor / localStorage 格式均未动）」，0.26.1 是性能发布（可见性门控轮询、有界缓存、git `--numstat` pathspec、WSS 关闭）。
- 上游 `package.json` 的 `dsh` 字段、exports、`engines`、18 条 peer 在 0.26.0 与 0.26.1 之间**逐字节相同**。
- **约定**：能力探测按服务的 `features`（`SIDEBAR_FEATURES`）判定，**不得按版本号比较**（0.26.1 未新增 feature）。

## 3. 本轮最重要的语义变更：`engines.dsh` 单独决定兼容性

上游 `docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md` 规定，并在 alpha.4 源码中已实现：

| | 旧规则（alpha.3 及以前） | 新规则（alpha.4） |
|---|---|---|
| 判定依据 | 只看 `peerDependencies` 中的 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，忽略 `engines.dsh` | 有 `engines.dsh` 时**它单独决定**，这些 peer **被忽略**；缺失时才回退到 peer 规则 |
| `workspace:` 值 | peer 中特殊处理 | 在 `engines.dsh` 中**视为不兼容** |
| 非法清单 | — | `engines` 非对象、或 `engines.dsh` 非字符串 ⇒ 清单不可读，**拒绝该包** |
| 拒绝记录字段 | `peers` | **`requirements`**（键为 `engines.dsh` 或回退时的 peer 包名） |

源码证据：`upstream/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts:57-60`（`Object.hasOwn(engines,'dsh')` 分支）与 `:77-80` 的文档注释（「An own `engines.dsh` range decides alone and peerDependencies are ignored」）。判定用 `semver.satisfies(version, range, { includePrerelease: true })`（同文件 `:51-53`）。

**对本插件的直接后果（必须处理，不得忽略）：**

1. 本插件同时声明了 `engines.dsh` 和十几个 `@deepseek-ai/dsh-*` peer。自 alpha.4 起，**兼容性只由 `engines.dsh` 决定**，peer 范围不再放宽或收窄它。
2. 因此 `engines.dsh` 的取值必须**覆盖本插件真正支持的所有 DSH 版本**，且必须与本仓库「说的每句话都有测试背书」的规范一致：写进去的范围只能是**实际验证过**的范围，不能凭推测放宽。
3. 要求：把 `engines.dsh` 收窄为与本轮验证集合一致的区间（建议 `>=0.2.1-alpha.4 <0.3.0`，并在 README/实施报告中写明「仅 `0.2.1-alpha.4` 实测通过」）。**不得**保留会顺带承认未验证版本的开放区间而不加说明；也**不得**在文档里继续把 peer 范围当作兼容性证据。
   - 注意该区间的**真实准入集合**（因为判定带 `includePrerelease: true`）：`>=0.2.1-alpha.4 <0.3.0` 会同时接受 `0.2.1-beta.1`、`0.2.2-alpha.1`，甚至 `0.3.0-alpha.1`。若要与验证集合严格一致，必须要么接受这一已知宽度并在文档写明，要么改成更窄的写法（例如精确到已测版本），并在报告中给出所选写法的准入集合实测。
   - 该 guide 的提交时间（2026-10-15）**晚于 alpha.3 tag**，却归档在 `docs/upgrade-guide/v0.2.1-alpha.3/` 下——归档位置不能作为「从哪个版本开始生效」的证据，行为以 `plugin-compatibility.ts` 的实现为准。
4. 必须 grep 确认本仓库没有读取 `IncompatiblePlugin.peers` / `PluginCompatibility.peers`（预期零命中）；若有，改读 `requirements`。
5. 上游 AGENTS.md 对本轮**不构成权威**：本地 `upstream/deepseek-harness/AGENTS.md` 未提及 `engines.dsh`。以 guide + `plugin-compatibility.ts` 源码为准；若实现代理在其他文档里看到相反说法（例如「manifestVersion / engines.dsh 无读者」），必须以上面的源码行为为准并在报告中留档该冲突。

## 4. 必须实施的项目

### 4.1 版本对齐

要求：

- 把 `package.json` 中**全部** `@deepseek-ai/dsh-*` 的 `peerDependencies` 与 `devDependencies` 提升到 `0.2.1-alpha.4`。
- `@deepseek-ai/cordis` → `4.0.5-alpha.2`；`@deepseek-ai/schemastery` → `3.18.5-alpha.2`；`cordis-plugin-include` → `1.0.10-alpha.2`；`cordis-plugin-loader` → `1.0.6-alpha.2`。
- `overrides.dsh-opencode-go` 段落的全部 dsh 条目同步提升，**不得遗漏**；`dsh-opencode-go` 自身的版本（`0.1.20`）是否需要提升由实现代理核对（它不是 peer，只是被 overrides 约束的第三方插件；不改则必须在报告中说明为什么仍可用）。
- 锁文件（`package-lock.json`）同步更新；`npm ci` 必须能干净通过。
- **解决一处既有的声明缺口**：`src/tools.ts:16`、`experiments/run.ts:25`、`experiments/shifting-evidence-run.ts:20` 都在 `import type { JsonValue } from '@deepseek-ai/dsh-util-values'`，但该包**未出现在 `package.json` 的任何依赖段**。要求：要么把它声明为 peer/开发依赖并接受 typecheck，要么改从已声明的包导入等价类型；并在报告中写明处置方式与依据。（该包在 alpha.4 存在，`packages/util/values`，版本 `0.2.1-alpha.4`。）

验收测试：静态断言 `package.json` 与锁文件中不再出现 `0.2.1-alpha.2` / `4.0.5-alpha.1` / `3.18.5-alpha.1`；全新 `npm ci` + `npm run typecheck` 通过。

### 4.2 逐篇核对 upgrade guide（**11 篇，不得跳过**）

必须阅读并对**每一篇**给出「影响 / 不影响 + 依据」：

- `upstream/deepseek-harness/docs/upgrade-guide/v0.2.1-alpha.2/`（**10 篇**，实测目录名）：`deepseek-account-identity-watch`、`deepseek-account-model-catalog`、`desktop-font-size-shortcuts`、`from-default-profile-replaces-target`、`operator-connect`、`pi-ai-azure-provider`、`pi-ai-model-discovery`、`plugin-install-over-installed`、`sdk-minimal-image-compaction`、`stored-credentials-precedence`。
- `upstream/deepseek-harness/docs/upgrade-guide/v0.2.1-alpha.3/`（**1 篇**）：`plugin-engines-dsh`（第 3 节，**必须实施**）。
- **`v0.2.1-alpha.4` 目录不存在**。alpha.4 的变更没有 guide，必须按 4.3 用 tag diff 审计。

说明：保留 alpha.2 目录的逐篇核对是因为本插件的 `engines.dsh` 声明范围覆盖 alpha.2；这 10 篇多与账户/桌面/Provider 有关，预期「不影响」，但**预期不是结论**，逐篇依据必须写出来。

### 4.3 alpha.4 的 diff 审计（无 guide，必须留档）

上游 `alpha.3 → alpha.4` 在 `packages/**` 下的源码变更**全部**落在下列目录，本插件依赖的包**不在其中**：

- 变更所在：`api/remotes`、`boot/app-boot`、`boot/plugin-manager`、`boot/plugin-market`、`client/hmr`、`client/modules`、`client/product-analytics`、`client/ui-commands`、`client/ui-conversation`（仅 `input/editor`、`draft`）、`client/ui-input-trigger`、`client/ui-plugin-manager`、`client/ui-plugin-market`、`client/ui-settings-general`、`client/ui-settings-models`、`client/ui-tool`、`experimental/*`（inspector、webworker-runtime、webworker-packer、plugin-market-bundle、speech-to-text、tool-agent-team）、`extensions/tool-cordis`、`ssh`、`subagent/subagent-codex`（`wire.ts`）、`subprocess/subprocess-local`、`util/plugin-market-index`。
- **零源码变更**（本插件直接依赖）：`core/tools`、`core/system-prompt`、`core/agent`、`core/session`、`preset/agent-preset*`、`storage/*`、`typert/protocol`、`typert/registry`、`session/session-persistence-jsonl`、`subagent/subagent`。

要求：实现代理必须**自行复算**这份清单（命令：`git diff --name-only dsh-v0.2.1-alpha.3 dsh-v0.2.1-alpha.4 -- packages | grep '/src/'`），并逐条给出「是否影响本插件 + 依据」；上述清单是我方的核对结果，不替代实现代理的核对。

### 4.4 alpha.2 → alpha.3 的接触面复核（有真实变更）

以下包在 `alpha.2 → alpha.3` 有源码变更，且属于本插件的接触面，**必须逐条给出结论**：

| 包 | 变更规模 | 关注点 |
|---|---|---|
| `packages/typert/protocol/src`（index 196、types 267、新增 principal/remote-access/remote-info）与 `typert/registry/src/service.ts`（+56） | 大 | 本插件的 observer 用 `InvocationDescriptor` 注册 `atnObserver` 服务并声明严格 codec。已核实：`InvocationDescriptor` 形状本身未变（`types.ts:389-432`）、`bindTypertRemote`/`ctx.typert.register(TypertContribution)` 签名未变；新增的是 `TypertResource`/`Principal` 模型与 `TypertRegistry.resources` 注册表（纯增量），`TypertCodec` 变为泛型。`@Remote` 装饰器选项由「仅 `{mode:'stream'}`」放宽为 `{name?, mode?, resources?}`——本插件不使用装饰器，必须 grep 确认后写明依据 |
| `packages/client/connection/src`（peer/rpc/rpc-host/browser-auth/index） | 中 | 本插件客户端用 `connection.rpc.call('/api', 'atnObserver/snapshot', …)`；除 typecheck + 客户端测试实测外，注意两条已核实变更：**`HostConnectionHandle.operator` 改名为 `browserPeer`**（本插件不读该字段，需 grep 确认），以及 **`/client` 子路径改为条件导出**（`node` → `lib/client.node.js`，`browser`/`default` → `lib/client.browser.js`）：Node 侧测试若运行时导入 `<pkg>/client` 会拿到与浏览器不同的构建；本插件的该导入是 `import type`（会被擦除），必须确认无运行时请求 |
| `packages/api/gateway` + 新增 `packages/api/remote-access` | 中 | **新增网关访问控制，但只对非 owner 主体生效**（owner／共享浏览器 Peer 的调用跳过判定）。本插件的观察面走已认证的浏览器路径，预期不受影响；但存在一个必须实测的开放问题：`atnObserver/snapshot` 未声明 resource readers（解析为 `global`）时，非 owner 主体是否会被默认策略拒绝 |
| `packages/client/ui-session/src/client/index.ts` | 小 | 客户端半现在 **inject `remoteAccess`**（来自新包 `dsh-api-remote-access`）。任何挂载 `ui-session` 的客户端组合都需要对应的 remote-access 客户端插件；本插件自身不提供该行，必须由 `smoke:profile` / `smoke:visualization` 实测确认组合仍然成立 |
| `packages/subagent/subagent/src` | 中 | `SubagentStartRequest` **移除 `toolFilter` 与 `persona`，新增 `agentPreset?`**；子会话组合改为 preset 驱动，`childSessionMeta` 新增 `selectedPreset?`，`applyChildComposition` 允许异步。本插件调用的是 `captureDelegatedPolicyOverrides` / `appendDelegatedPolicyOverrides`（签名逐字节未变）与 `ctx.agents.create` + `presets.composeFrom`/`composedPreset`（签名未变），且不传被移除的两个字段——必须逐条核对后在报告中写明依据 |
| `packages/core/tools/src`（index、ptc 系列） | 中（PTC 重构 733 行） | `defineTool` 实际定义在 `packages/core/tools/src/schema.ts`（`:554`），该文件与 `json-schema.ts`、`types.ts` **零改动**；本插件的 `{ type: 'string', required: true }` 参数风格与 `assertObjectJsonSchema` 安全。本插件不使用 PTC 模式 |
| `packages/core/system-prompt/src`（+4） | 小 | 见 2.2 |
| `packages/core/agent/src`（+2）、`core/session/src`（index/types/known-event-types） | 小 | `core/agent` 的两行改动是 typert lookup 新增 `resource: 'session'`。session 侧只新增 `job/registered`、`job/settled` 事件类型与 `TypertResourceMap.session` 声明；`tool/call`（`types.ts:362`）与 `tool/result`（`:376`）载荷未变，本插件的观察面事件读取安全 |
| `packages/preset/agent-preset-registry`（index/session） | 小 | `select` 新增"已记录同一 preset generation 则短路、不记录不广播"（`:355-357`）——本插件自身的组合路径用 `composeFrom`/`composedPreset`（`:281,297,317`，签名未变）；fixture 的调用路径须实测 |
| `packages/session/session-persistence-jsonl/src`、`packages/host/webserver/src`、`packages/llm/*` | 中 | 逐条核对；`dsh-llm` 侧为纯增量（`imageRequestTarget()`、`LlmConfigurableProvider` 新增 `defaultBaseURL`/`baseURLEnv`/`nativeAuth` 等），本插件导入的消息/品牌辅助函数未变。若与 `smoke:profile` 相关必须在报告中写明 |
| `packages/experimental/tool-agent-team/src` | 中 | 队友身份由 spawn 用户消息移入必需的 system-prompt context，并新增 `interrupt` 配置。仅影响开发路径（等预算实验脚本），插件本体不受影响；若本轮不跑实验，必须在报告中说明 |

### 4.4b 已核实但必须留档的其余结论

- **包存活**：本插件导入的包在 alpha.4 **全部存在，无删除、无改名**（上游 `package.json` 由 340 增至 349 个）；`@deepseek-ai/dsh-invariants` 依然缺失（其移除指南在 `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants`）。`cordis.patch.yml` 里引用的 15 个 preset 插件名全部仍然存在。alpha.4 新增 9 个包（`dsh-api-remote-access`、`dsh-plugin-market` 系列、`dsh-client-ui-secret-mask`、`dsh-harness-dev-context`、`dsh-cua` 等）——本插件不依赖它们，但需在报告中列入「已核对、不影响」。
- **插件清单契约无新增必填字段**：`packages/util/package-manifest/src/types.ts` 在 alpha.2→alpha.4 之间是**空 diff**；`dsh.bundle.patch`、`dsh.client.{platform,inject,immediately,external}`、`dsh.manifestVersion?: 1` 完全一致。
- **第二处声明缺口**：`@deepseek-ai/dsh-brand` 被声明在 `devDependencies` 但**从未被任何文件导入**（`@deepseek-ai/dsh-util-values` 则是反过来：被导入却未声明）。两者都必须在本轮处置并在声明审计中留档。
- alpha.2 与 alpha.4 之间相隔 **941 个提交**；本次核对只覆盖本插件实际接触的包，未接触的包不在本轮范围内，报告中必须写明这一覆盖边界。


### 4.5 better-sidebar 0.26.1 对齐（精确锚定必须同步，共 10 处）

| # | 位置 | 动作 |
|---|---|---|
| 1 | `package.json:99`（optional peer，精确 `0.26.0`） | 改为 `0.26.1` |
| 2 | `package-lock.json` 根 `peerDependencies['dsh-better-sidebar']` | 同步为 `0.26.1` |
| 3 | `scripts/sidebar-compatibility.mjs:5` `VERIFIED_SIDEBAR_VERSION` | 改为 `0.26.1`（该脚本会**拒绝任何与常量不等的已安装版本**） |
| 4 | `scripts/verify-sidebar-contract.mjs` | 重新生成赋值 fixture 并跑通；记录 publisher declaration 的新 SHA256 |
| 5 | `scripts/verify-sidebar-registry.mjs` | 针对 0.26.1 重新跑通（依赖 `exports["./src/*"]`，两版都有） |
| 6 | `tests/unit/sidebar-contract.test.ts:12`（断言 `verifiedVersion === '0.26.0'`）与 `:13-17` 清单/锁文件一致性 | 改为 0.26.1；`:24` 的「provider import 必须全部是 `import type`」保持不变 |
| 7 | `src/client/better-sidebar-contract.d.ts:1` 头注释 | 版本号改 0.26.1；顺带修正引用的行号区间（`TabComponentProps` 在 `service.ts:149`、`TabDescriptor` 在 `:168`，原文写作 149–292 不够精确） |
| 8 | `.github/workflows/ci.yml:34,43,44` | `SIDEBAR_PACKAGE_DIR` 与隔离安装命令的版本改为 `dsh-better-sidebar@0.26.1` |
| 9 | `README.md:89`、`README.md:249`、`docs/BETTER_SIDEBAR_IMPLEMENTATION_REPORT.md` 相关段落 | 版本与验证结论同步 |
| 10 | `docs/execution-evidence/residual/check-gate.mjs`（`^0.26.0` 用例）与相关证据 JSON | 更新为 0.26.1，并保留旧证据不篡改 |

### 4.6 不得改变运行时行为

- 不改模型工具面（仍是 5 个）、不改任何工具 schema、不改 `SHARED_RULES` 行数。
- 不改 `maxCollaborationPeers` 等配置语义、不改出度曲线、不改持久化 domain 版本（保持 1）。
- 不改 `src/client/` 的注册方式（槽位与 `registerTab` 在 alpha.4 / 0.26.1 下均仍然有效，见 2.2/2.3）。
- 不新增、不删除、不重命名任何出站通道与拒绝码。

验收测试：全部既有测试继续通过且**断言强度不降低**；`toolSchemaBytes` 与 `fixedContextBytes` 与开工前基线一致（给出前后实测数字）。

## 5. 外部 provider 阻塞的现状（**不得夸大，不得自行打补丁**）

- `dsh-better-sidebar@0.26.1` 的 **host 行**仍为 `inject = ['webServer', 'sessions', 'webRuntime', 'tools']`（其 `src/index.ts:114`，0.26.0/0.26.1/HEAD 完全相同），并在 `:1327` 使用 `ctx.webRuntime.trustedHosts`。
- **alpha.4 仍然没有名为 `webRuntime` 的 Cordis 服务**：在 `upstream/deepseek-harness/packages` 下全量检索 `webRuntime` 只命中一个无关的 bundle 贡献名（`packages/bundle/web-app/tests/web-app.spec.ts:139` 的 `'web-runtime'`）。`trustedHosts` 概念在 alpha.4 存在于 `packages/client/connection/src/api-request-trust.ts` 与 `packages/bundle/web-app/src/startup.ts:39,120`，**不是**一个可注入的服务。
- 上游自己的 issue 记录表明该修复 PR 未落地（在 `upstream/DSh-better-sidebar` 历史中检索不到）。
- 因此本轮的结论只能是：**client 半的 Tab API 与真实注册服务可在 0.26.1 上验证；完整 provider host 激活与联合 host/browser 验收仍不可验证**。必须保留顶栏回退路径，并在 README/报告中沿用上一轮的措辞，不得写「已联合验证」。
- **不得**为本插件给第三方 provider 打补丁、加 shim 或代改其 `inject`（仓库既有决定）。
- semver 事实（便于报告写清）：`^0.2.0-rc.2` 在**默认**选项下不匹配 `0.2.1-alpha.*`（caret 作用于 `0.x` 会钉住次版本，且默认不接受 prerelease）；DSH 启动预检用 `includePrerelease: true`，因此**接受** provider 在 `0.2.1-alpha.4` 上加载。普通 npm 联合安装仍会 ERESOLVE——这正是本插件把 provider 声明为**精确 optional peer 且从不安装它**的原因，该策略不变。

## 6. 必须保留的既有语义

1. 入口 Agent 由宿主拥有；完成、停止、退休都不 `dispose` 入口。
2. 网络记录是唯一原子持久化单元；检查与修改在同一 mutation 临界区。
3. 边是单向的；出生谱系只作追溯。
4. 工具身份/发送者/投票者取自真实 live Agent。
5. 同伴文本不构成人类授权；请求者评价不构成宿主验收。
6. `stepBudget` 不得被说成 token、HTTP 请求或费用上限。
7. 持久化 domain 版本保持 1。
8. provider 为精确 optional peer，未安装时可用的顶栏回退必须保持可用。

## 7. 不要做的事

1. 不重写客户端注册方式（槽位与 Tab API 在两版下都成立）。
2. 不把 `engines.dsh` 当成可有可无的元数据；也不为了「看起来宽松」保留未经证实的开放区间。
3. 不改动或补丁第三方 provider；不为已删除的 `webRuntime` 造 shim。
4. 不往 `dsh.client.inject` 里加包名来「修」激活顺序（该字段是信息性的）。
5. 不重复声明平台基线模块（React、Cordis、`client/store`、`ui-primitives`、`ui-slots`、`ui-dockkit`）。
6. 不把本轮与 substrate 引入混在同一次提交。
7. 不删除已有测试、不降低断言强度；因契约变化必须修改的断言逐条给出理由。
8. 不把未测试内容写成已通过；不宣称完整 provider 联合激活。

## 8. 无法确定时的处理

- 第 4.4 节各条必须由**编译器与测试**实测确认，不得靠读 diff 推断；无法在本轮确认的条目，必须在报告中写「未确认 + 原因」。
- 若发现 `engines.dsh` 收窄后 `dsh plugin --profile web add` 在目标 CLI 上被拒，必须停下并在报告中给出拒绝记录（`requirements` 字段内容），不得直接放宽范围绕过。
- 若上游在 `alpha.4` 之后又发布新 patch，**不在本轮范围内**；不得顺带提升。

## 9. 完成标准

必须完成并保留输出摘要：

```text
npm ci
npm run typecheck
npm test
npm run build
npm run pack:tarball
npm run smoke:profile
npm run verify:sidebar      # 需 SIDEBAR_PACKAGE_DIR 指向独立安装的 dsh-better-sidebar@0.26.1
npm run smoke:visualization
```

并且：

1. 第 4.2 节 **11 篇 guide 逐篇**给出「影响 / 不影响 + 依据」，不得只列相关条目。
2. 第 4.3 节复算的 alpha.4 变更清单与逐条结论。
3. 第 4.4 节各包的逐条结论；`ConnectionHandle` / `rpc.call` 路径以实测为准。
4. `engines.dsh` 的最终取值、依据、以及真实安装命令的接受/拒绝输出。
5. `toolSchemaBytes` / `fixedContextBytes` 前后实测数字，确认行为未变。
6. `verify:sidebar` 的 0.26.1 输出与新的 declaration SHA256。
7. 完整 provider 联合激活的**未完成**状态如实留档（沿用 5 节的措辞）。
8. README 与 `docs/` 声明同步（版本号、"已验证版本"表述、`DECLARATION_AUDIT.md` 新增本轮行）。

交付物：

- `package.json` 与锁文件改动。
- 11 篇 guide 核对结论表 + alpha.4 变更清单复算结果。
- 字节数前后对比、侧栏契约与注册服务在 0.26.1 上的输出。
- `docs/UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT.md`。

## 10. 已知未验证项（实现代理必须自行确认，不得当作已确认）

1. `papers/` 与实验脚本是否在 alpha.4 下仍可运行（`experiments/*` 使用了被 overrides 约束的 `dsh-opencode-go`；本轮不要求跑实验，但若要跑必须单独说明）。
2. `alpha.4` 对 `packages/host/webserver`、`packages/llm/*`、`packages/session/session-persistence-jsonl` 的 alpha.2→alpha.3 变更是否影响 `smoke:profile` 的真实路径——必须以 smoke 实测为准。
3. `dsh-opencode-go@0.1.20` 在 alpha.4 下是否仍可挂载（仅影响实验/探针脚本，不影响插件本体）。
4. alpha.4 的 `client/connection`（alpha.2→alpha.3 有改动）与 `client/ui-conversation`（alpha.3→alpha.4 改了 input/editor/draft）在**真实浏览器**中的行为——必须由 `smoke:visualization` 与截图脚本实测，不得只依赖类型检查。
5. 上游是否会把 `webRuntime` 的移除修回（issue #906 / PR #905 在本 checkout 中查不到落地记录）——**未验证**，不得据此规划。
6. **网关访问控制对非 owner 主体的默认策略**：`atnObserver/snapshot` 未声明 resource readers（解析为 `global`）。owner／共享浏览器 Peer 的调用跳过判定，但非 owner 主体是否会被新策略拒绝**未验证**；若本插件要宣称「任何已认证客户端」可用，必须先实测。
7. 发布到 npm 的 `cordis@4.0.5-alpha.2` / `schemastery@3.18.5-alpha.2` tarball 是否与上游 checkout 一致——本地只验证了源码侧。
8. `/client` 条件导出对 **Node 侧测试**的影响：本插件的相关导入是 `import type`（会被擦除），因此预期不产生运行时请求；但任何新增的运行时 `import` 都必须重新核对，不得凭「类型导入」的历史结论放行。
9. alpha.2→alpha.4 相隔 941 个提交，本次只核对本插件实际接触的包；**未接触的包不在核对范围内**，报告中必须写明覆盖边界，不得表述为"全仓库已审"。
