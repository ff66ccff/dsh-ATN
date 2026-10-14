# 阶段 A：Harness 0.2.1-alpha.2 实施记录

日期：2026-10-14。实施基线：`260a82b`。本报告只覆盖阶段 A；B/C/D 尚未开始。

## 输入核实

本地上游 `upstream/deepseek-harness` 为 `d743267388641bc76f17c45ce8b4c231aed1d32c`。
guide 目录实际为 **5+19=24 篇**，与 brief 的 22 篇不符；额外两篇是 `native-subagent-bundle-tools` 和 `web-listener-trust-config`。本轮全部阅读。

`git diff dsh-v0.2.0-rc.2 HEAD -- packages/client/modules/src/client/manifest.ts scripts/verify-client-packages.ts packages/client/ui-slots/src/index.ts` 无差异。
`ui-conversation/src/client/contract/slots.ts` 有两行接口改名，不是逐字节不变；header action 键及本插件使用的 props 未变。
客户端 `slots.inject/register` 注册方式不需要重写。

## 逐篇核对

路径均相对于上游 `docs/upgrade-guide/`。下表“无直接影响”指本插件没有使用改变的契约，不能扩大为上游行为没有变化。

| 目录 | 判定 | 本仓库依据 |
|---|---|---|
| v0.2.0-rc.2/subpath-plugin-display-manifest | 无直接影响 | 顶层有 package.json；tools 子路径未导出子路径 package.json 或图标展示清单 |
| v0.2.0-rc.2/account-sign-in-errors | 无直接影响 | 未调用 account API 或解析 SignInErrorCode |
| v0.2.0-rc.2/remove-runtime-invariants | 影响 | 删除开发依赖；src/tests/scripts/examples 无 registry 或 /invariant 使用 |
| v0.2.0-rc.2/bundled-python-tests | 无直接影响 | 构建和测试为 Node/TS，不依赖 NumPy/pandas 测试包 |
| v0.2.0-rc.2/schedule-bundle-retired | 无直接影响 | ATN patch 未选择或覆盖旧 schedule bundle/row |
| v0.2.1-alpha.1/working-directory | 影响 | cordis.patch.yml persona suffix 使用 {{cwd}}，按 guide 删除目录子句；工具没有 presentationMeta 投影 |
| v0.2.1-alpha.1/session-title-provider-strategy | 无直接影响 | 未注册 title provider |
| v0.2.1-alpha.1/subagent-activations | 影响实验组装，生产 ATN 无直接影响 | ATN 直接由 ctx.agents.create 管理节点；native-team 的 SubagentRuntime 新增 workingDirectory 注入，实验与其测试需组装真实 FsLocal/WorkingDirectory 服务 |
| v0.2.1-alpha.1/python-optional-resources | 无直接影响 | 未调用 Python runtime/Office API |
| v0.2.1-alpha.1/terminal-command-labels | 无直接影响 | 未渲染 TerminalBlock |
| v0.2.1-alpha.1/ssh-helper-launch | 无直接影响 | 未配置 SSH/PTC launch |
| v0.2.1-alpha.1/team-direct-inbox | 影响实验组装，生产 ATN 无直接影响 | experiments/run.ts 的 native-team 比较配置仍含已移除 maxPendingMessagesPerMember；该项需删除；服务返回 messageId 契约仍保留 |
| v0.2.1-alpha.1/instruction-home-override | 无直接影响 | preset 的 agent-instructions 仅设置 maxBytes，无 dshHome |
| v0.2.1-alpha.1/tool-presentation-mode | 无直接影响 | 无 both/presentAs，夹具使用默认 native |
| v0.2.1-alpha.1/experimental-package-composition | 影响验收 | patch 使用完整 insert，id=atn/preset-atn，不依赖启用已移除行；需要实际安装和工具注册 smoke |
| v0.2.1-alpha.1/deepseek-model-discovery | 无直接影响 | 插件不读取 provider catalog；keyless 夹具注册独立适配器 |
| v0.2.1-alpha.1/mock-messages-events | 无直接影响 | 夹具继承 LlmAdapter，不解析 mock SSE |
| v0.2.1-alpha.1/new-session-generations | 无直接影响 | 不调用 uiWorkspace.startSession，读取已绑定会话 |
| v0.2.1-alpha.1/plugin-option-placement | 无改动需求 | profile smoke 已使用 plugin --profile NAME add SPEC；README 安装命令需一并核对 |
| v0.2.1-alpha.1/desktop-test-auth-popup | 无直接影响 | 不读取 Desktop 更新设置 |
| v0.2.1-alpha.1/python-ptc-sandbox | 无直接影响 | 不组装 Python PTC |
| v0.2.1-alpha.1/native-subagent-bundle-tools | 无直接影响 | ATN bundle 不选 Codex/Claude bundle；现有能力比较由 preset 测试覆盖 |
| v0.2.1-alpha.1/web-listener-trust-config | 无直接影响 | 未 inject webRuntime，也未设置 wildcard host，profile smoke 仍需验证真实启动 |
| v0.2.1-alpha.1/session-title-adapters | 无改动需求 | ScriptedModel 的 reasoning efforts 已按 low/medium/high 排序；插件不实现 title 策略 |

补充契约：agent-preset-registry 默认导出与 PresetDefinition 在目标源码仍存在，但只有安装后的 typecheck/preset 测试才算实测。被删除的 serviceForAgent/standingMountFor/livePresetMounts 未使用。
bindDraftMirror 改为 bindDraftPersistence，插件没有使用该成员。
`src/client/index.tsx:24-30` 样式显式标记 data-plugin=dsh-atn，与 `system.ts:66-86` 的预标记样式选择器一致；不受未标记样式 claim 规则变化影响。

## 安装偏差与修复前证据

见 [修复前记录](execution-evidence/A-PRE_FIX_RECORD.md)。基线 `npm test` 实测为 542 tests / 541 pass / 1 fail，未执行后续 UI，因为 runtime 链返回 1；原始输出保留于 `execution-evidence/A-baseline-tests.txt`。
失败为 KNOWLEDGE-02 的 queued→delivered 异步投递竞争，发生在升级之前，不能归因于新版本。

目标 npm 包要求 `@deepseek-ai/cordis ~4.0.5-alpha.1`，与 brief 所称 4.0.4 不符。首次安装 ERESOLVE；同步升级 Cordis 及 include/loader/Schemastery 至目标上游同一套版本。
`dsh-opencode-go@0.1.20` 的 `cordis >=4.0.2` 不接受预发布版本，需给已有 overrides 增加 `$@deepseek-ai/cordis`，不使用 force/legacy-peer-deps。

## 验收状态

所有阶段 A 闸门已通过，完整输出位于 `execution-evidence/A-*.txt`：

| 命令 | 结果 |
|---|---|
| npm ci | 退出码 0，全新 node_modules 成功安装 |
| npm run typecheck | 退出码 0；真实默认导出 AgentPresets 与 PresetDefinition 类型编译成功 |
| npm test | 退出码 0；544 runtime/集成 + 8 UI，全部通过、0 skipped；原有 542 项保留 |
| npm run build | 退出码 0；client.js 485475 bytes |
| npm run pack:tarball | 退出码 0；102 files |
| npm run smoke:profile | 退出码 0；DSH_CLI 指向隔离安装的 @deepseek-ai/dsh@0.2.1-alpha.2 |

smoke 证实 ATN 五工具注册、Standard 隔离、子节点继承同一工具集和 preset，185 条宿主既有配置行完整不变。
隔离 CLI 位于 `.scratch/harness-alpha/node_modules/.bin/dsh.cmd`；系统 Desktop CLI 仍为 0.2.0-rc.2，不能直接运行目标版本 smoke；其拒绝证据保留于 `A-smoke-old-cli.txt`。

`A-context-before.json` 与 `A-context-after.json` 实测完全一致：systemPromptBytes=1161、toolSchemaBytes=4749、fixedContextBytes=5910。

既有断言改写仅 TELEMETRY-05：旧 Team 队列/状态已被上游删除，改为核对真实返回的 messageId 与目标日志里相同 relay，遥测恰好一条 delivered、无伪造 queued，并保留所有脱敏/任务修订/依赖断言。前置失败既有编译错误，也有缺少 workingDirectory 导致 agentTeams 未激活的实际运行错误；没有伪称 status 断言已执行失败。
实验 native-team 组装补入必需目录服务、移除废弃配置；遥测读取新 relay 日志，保留旧 Team 历史事件读取。其余既有测试断言未改写。
基线 KNOWLEDGE-02 竞争在聚焦与完整目标版本测试中均通过，未削弱断言、未改生产代码；这次通过不能证明它今后绝不会竞争。

十二项不变式在 A 成立：入口所有权（lifecycle/stop/retire）、原子网络持久化（concurrency/domain）、单向边与谱系（topology）、live 身份（agent/preset）、授权与验收（information-boundary/reference-policy）、stepBudget 含义（budget）、同能力（preset/smoke）、只读观察（observer/UI）、domain v1（domain）、五工具/schema 字节不变（fixed-context/字节对比）、原有测试全部保留、报告只列实际运行结果。未完成项：B/C/D 尚未开始；真实付费模型和浏览器视觉验收不在 A 的已通过声明内。
