# 上游最新版适配实施报告（2026-10-16）

本阶段先于 substrate 实施，保持五工具与运行语义。目标 checkout：Harness `86a402200d95fecef4529d969836f1fe13c6cb0d`（dsh-v0.2.1-alpha.4）；sidebar `05e64855ed636e6eb68a53b48398fa4b62403248`（0.26.1）。执行证据在 [本轮目录](execution-evidence/upstream-latest-2026-10-16/)。

## 清单与兼容性

所有根清单 dsh peers/devDeps/overrides 均为 0.2.1-alpha.4；Cordis 4.0.5-alpha.2、Schemastery 3.18.5-alpha.2、include 1.0.10-alpha.2、loader 1.0.6-alpha.2。JsonValue 类型来源 util-values 补为直接 peer + devDependency（它在 alpha.4 packages/util/values 存在）。Zod 固定 4.4.3：新建锁文件时 ^4.4.3 选中 4.6.7，与 storage-domain 固定 4.4.3 的类型冲突；固定回原验证版本，未改 schema 语义。首次增量锁更新遇到 npm 11 静默 exit 1，改在空隔离目录生成锁，再正常 npm ci。

engines.dsh 为 `>=0.2.1-alpha.4 <0.3.0`；**仅 0.2.1-alpha.4 实测**，范围内其余版本未经验证。alpha.4 由 engines.dsh 单独判兼容，peer 不扩大或缩小它；依据 plugin-engines-dsh guide 和 app-boot/src/plugin-compatibility.ts（includePrerelease:true）。仓库运行代码未读取 IncompatiblePlugin.peers / PluginCompatibility.peers；无须迁移。未发现与这两份权威源码冲突的现行实现。本机 Desktop CLI 是 0.2.0-rc.2，本轮真实 smoke 显式使用 .scratch/harness-alpha4 的 npm 发布 CLI；未改 Desktop。

JSONL 持久化包 alpha.3 移除 default export，改为具名 apply/Config。tests/fixtures/kernel.ts 与三个实验内核改为命名空间导入，通过同一个 ctx.plugin 路径加载；没有修改 ATN 运行时算法。prototype 是独立冻结依赖工程，未升级。dsh-opencode-go 保留 0.1.20：所有 dsh 传递依赖 override 对齐；编译器覆盖实验导入，挂载测试覆盖注入 seam（不是原插件真实挂载），未重跑任何付费实验；不把挂载当成提供商端到端验证。冻结实验源码哈希会因导入修复变化，旧结果重放仍需匹配旧源码快照。

## 11 篇 upgrade guide（逐篇已读）

| guide | 影响 / 依据 |
|---|---|
| deepseek-account-identity-watch | 不影响插件：无 deepseekAccount.watch/getPlatformSession 订阅。 |
| deepseek-account-model-catalog | 不影响：插件不配置 llm-deepseek-account.models；测试使用脚本适配器。 |
| desktop-font-size-shortcuts | 不影响：ATN 不绑定 Ctrl+=/-，浏览器 header action 不使用桌面快捷键。 |
| from-default-profile-replaces-target | smoke 有接触但无需改：只对 mkdtemp 下两个全新 profile 各初始化一次，不重复重置用户 profile。 |
| operator-connect | 浏览器默认 answer 行为保持；ATN 只用 unary connection.rpc.call；smoke 用 HTTP cookie，无 $events/$stream 恢复依赖。 |
| pi-ai-azure-provider | 不影响：无 azure-openai-responses 路由配置；不修改提供商。 |
| pi-ai-model-discovery | 不影响：插件不依赖 pi-ai 模型发现；脚本适配器不需凭据。真实外部目录未做请求验证。 |
| plugin-install-over-installed | 不影响：不调用 installBundle；smoke CLI 在全新 profile 安装一次。 |
| sdk-minimal-image-compaction | 不影响本轮路径：使用 web profile/真实最小 kernel；不假定 sdk-minimal 全部工具数等于 ATN 工具数，也不调用图片或自动摘要模型。 |
| stored-credentials-precedence | 无需迁移：smoke 使用独立 DSH_HOME 并剔除敏感环境变量，脚本模型无付费请求；没有读取用户 credential store。 |
| plugin-engines-dsh（alpha.3） | **影响**：按源码收窄 engines、核对 requirements；真实 alpha.4 CLI 安装验证。 |

alpha.4 upgrade-guide 目录不存在。alpha.2 的十篇保留逐篇核验；现行范围已不接受 alpha.2。

## alpha.3 → alpha.4 自行复算

执行 git diff --name-only dsh-v0.2.1-alpha.3 dsh-v0.2.1-alpha.4 -- packages 后筛 /src/，共 **122** 文件、**27** 个包目录。完整路径在 alpha4-source-paths.txt，逐文件归组在 alpha4-audit.json。brief 漏列 extensions/cordis-client-runner，本轮纳入审计。

| 目录 | 影响与依据 |
|---|---|
| api/remotes（2） | 新增远程事件及插件管理 requirements；ATN 使用自有 atnObserver descriptor，不读取安装拒绝字段。 |
| boot/app-boot（3） | 影响：engines.dsh 优先兼容预检；清单收窄、真实 CLI 安装验证；profile 源重置只用于临时新目录。 |
| boot/plugin-manager（4） | requirements 和已安装包处理；ATN 不调用 installBundle；smoke 使用新 profile CLI add。 |
| boot/plugin-market（8） | 市场检索/解析，不在 ATN 调用路径。 |
| client/hmr（1） | 发布变化通知；ATN 不注册 HMR 钩子，Web 装载 smoke 覆盖。 |
| client/modules（6） | 可选 release 与热更新通知；ATN 不生产 release；保留现有 inject 清单。 |
| client/product-analytics（3） | 环境采集；ATN 无此 API。 |
| client/ui-commands（1） | 命令注册；ATN 仅 header action。 |
| client/ui-conversation（15） | draft/input/editor/facade/machine；header actions 槽位未变；客户端与浏览器验证覆盖观察入口。 |
| client/ui-input-trigger（2） | 输入触发器；ATN 无输入扩展。 |
| client/ui-plugin-manager（11） | 管理页/导航/资源；ATN 不用这些契约。 |
| client/ui-plugin-market（8） | 市场 UI；ATN 不用这些契约。 |
| client/ui-settings-general（4） | 版本提示；ATN 不扩展设置页。 |
| client/ui-settings-models（9） | 提供商/模型编辑；ATN 不实现 Provider 配置页。 |
| client/ui-tool（5） | 终端卡片退出码；ATN 返回文本 JSON，无终端卡片。 |
| experimental/inspector（2） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| experimental/plugin-market-bundle（1） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| experimental/speech-to-text-sensevoice（1） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| experimental/tool-agent-team（1） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| experimental/webworker-packer（5） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| experimental/webworker-runtime（21） | 实验包变更（inspector/worker/speech/PTC team）；ATN 不接入对应新机制；native-team 实验依赖仅类型检查，未重跑实验。 |
| extensions/cordis-client-runner（1） | slot catalog 变更，brief 漏列此目录；ATN 槽位仍为 conversation.session.header.actions，无需修改。 |
| extensions/tool-cordis（1） | API catalog；ATN 不调用该工具。 |
| ssh/ssh（1） | SSH helper；ATN 不调用。 |
| subagent/subagent-codex（1） | Codex wire；ATN 使用 in-process subagent，不用 Codex wire。 |
| subprocess/subprocess-local（3） | Linux scope 选择；ATN 无 subprocess 控制。 |
| util/plugin-market-index（2） | 市场索引；ATN 不调用。 |

core/tools、core/system-prompt、core/agent、core/session、preset/agent-preset*、storage/*、typert/protocol、typert/registry、session/session-persistence-jsonl、subagent/subagent 均无此区间 src diff；ATN 直接依赖的 stable surface 保持。

## alpha.2 → alpha.3 接触面

| 包 | 结论 / 证据 |
|---|---|
| typert/protocol + registry | 新增 principal/resource/remote-info；InvocationDescriptor 原有 id/service/namespace/method/invocation/parameters/cancellation/result 仍成立；ATN 直接 register 严格 codec。typecheck、OBSERVER 全部用例、真实 Gateway smoke 覆盖注册与调用。 |
| client/connection | ConnectionHandle 新增 interactions/openWebSocket；rpc.call 签名保持；ATN unary /api 路径由客户端测试、真实 HTTP Gateway 与浏览器入口验证；未只靠 diff。 |
| core/tools | 原 native defineTool/register 未变，ptcTransport 改为拥有上下文；ATN 不配置 PTC。真实 kernel/model tool schema 与 profile roster 验证 native 路径；不声称 PTC 兼容验证。 |
| core/system-prompt | 仅保留位 TEAM_IDENTITY=125/HARNESS_SOURCE=200/WEB_SURFACE=210；ATN order=40 不冲突。fixed-context 实测前后相同。 |
| core/agent + core/session | 新增 resource:session 元数据与 job/registered/job/settled；本地 MessageSourceMap 增补不冲突；session/Agent/预算/恢复测试覆盖。 |
| preset/agent-preset-registry | select 已选当前 revision 时短路；夹具 mount/select 与入口/子节点继承仍通过 preset/profile 测试。 |
| session/session-persistence-jsonl | **真实入口变更**：default class → named apply/Config；namespace 导入修复；新增 listing limiter 和资源关闭顺序；恢复/生命周期测试与 profile 真实写盘覆盖。 |
| host/webserver | port 可为 undefined、getOrigin/bindUrlHost 新增；ATN 不依赖绑定前端口；smoke appReady 后读端口并真实认证/RPC。 |
| llm/* | 核心新增图片投影与配置目录元数据；不改 ATN 文本/scripted 适配器契约。llm-deepseek/account/pi-ai provider 变更未运行付费请求；类型检查 + 全套脚本模型 + Web profile 覆盖所用路径，不声称远程模型兼容已测。 |

## 侧栏边界

0.26.0 → 0.26.1 service.ts 仅 SIDEBAR_SERVICE_VERSION 字面量变更；TabDescriptor/TabComponentProps/features 未变。清单/锁/验证常量/CI/测试/声明注释同步 0.26.1。registerTab 与 header actions 不变，未引入运行时 provider import。

**client 半的 Tab API 与真实注册服务已在 0.26.1 验证；完整 provider host 激活与联合 host/browser 验收仍不可验证**。provider inject 仍包含 webRuntime、实现仍读 ctx.webRuntime.trustedHosts，而 alpha.4 无此 Cordis 服务。未打补丁或造 shim；顶栏回退保留。默认 npm semver 不接受 provider 的 ^0.2.0-rc.2 对 alpha.4 的 prerelease，启动预检 includePrerelease:true 接受；因此仍精确 optional peer 且不联合安装。旧 residual JSON 不改写；check-gate 脚本新跑结果写入本轮目录，未来拒绝样例推进到合成 0.26.2。

## 验证实测

开工前：569 项 runtime/集成 + 14 项 UI，零失败/跳过。systemPromptBytes=1161、toolSchemaBytes=4749、fixedContextBytes=5910。

完成：npm ci、typecheck、npm test、build、pack:tarball、smoke:profile、verify:sidebar、smoke:visualization 均退出 0；569 + 14 项，零失败/跳过。所有原断言保持，仅按新版本契约更新版本常量与测试依赖。

适配后字节实测仍为 systemPromptBytes=1161、toolSchemaBytes=4749、fixedContextBytes=5910；前后完全相同。sidebar publisher declaration SHA256：dd0264be29b0adc1d11c9f695be0dd266d07a0a6253b02ec05cd50c404f470c6。

真实安装命令输出保存在 smoke-profile.txt：alpha.4 CLI 接受本地 tgz，加入 bundle，188 个已有 profile 行不变，子节点继承五工具。Web smoke 真实认证、服务端严格 codec、/api RPC、六节点有向连接与只读快照通过。另在真实浏览器展开未分组会话、点击 ATN 网络状态，看到六节点、协作邻接/创建关系、失败结果与实时活动；截图 real-browser.png。render:screenshot 命令退出 0（示例数据图不冒充真实宿主证据）。

编译器另发现 brief 未列出的 **api/gateway** 新约束：需真实 remoteAccess 服务与 InvokeRemoteRequest.peer。已为 observer 测试声明 api-remote-access devDependency、挂载真实服务并使用真实 Peer(owner)，visualization smoke 的进程内 invoke 同步提供 Peer。真实 HTTP/browser 路径由 Connection 创建 peer；ATN 生产 observer 注册方式没改。未放宽任何 Gateway 校验。初次红灯留档 pre-fix-gateway-*，六项 observer 定向与全量回归全绿。

未验证：dsh-opencode-go@0.1.20 原始 provider 的完整远程调用/实际挂载不在本轮运行；实验导入与自定义 live mount seam 经过 typecheck/测试，不能代替原 provider 验证。未增加付费请求。GitHub 托管 CI 矩阵未实际运行。既有未提交探针工作被保留，569 项基线包含这些本地用例；不将用户原有未提交文件混入本阶段提交。

本阶段未添加工具、未改 schema/六条规则/出度/配置语义/出站通道/拒绝码；domain=1。后续 substrate 是独立阶段与提交，字节变化不归入本阶段。
