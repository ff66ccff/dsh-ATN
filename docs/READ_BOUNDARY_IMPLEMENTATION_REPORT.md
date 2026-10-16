# ROADMAP V2 §3/§4 读取边界实施报告

2026-10-16。按用户“实施 docs/ROADMAP_NEXT_DIRECTIONS_V2.md”的指令，采用 §14 推荐的本轮范围：威胁模型与读取授权。§5/§6 及后续 P1/P2/P3 方向保留后续排期，本轮没有混入 custody 套件、跨网络引用补证、读侧分区或舰队 UI。

## 交付与书面决策

- [威胁模型](THREAT_MODEL.md)：对手能力、可信计算基、边界图、三类读取、六条 B-* 可执行判据与现有测试锚点；四项排除改为可引用 X-* 条目。
- [读取授权接入](OBSERVER_READ_AUTHORIZATION.md)：owner/operator 权限表、宿主策略示例、撤销及资源别名的整网披露语义。
- `src/observer.ts` 的 snapshot/metadata 使用上游 `@Remote({ resources })`。alpha.4 的 InvocationDescriptor 没有 resources/principal 字段，资源 reader 必须放在方法元数据；没有自造描述符字段或修改上游。
- 新 `atn-observation` 资源 ID 是 sessionId。snapshot 授权可观察此会话所属整个网络；metadata 使用独立 action，仅投影 ID/状态/预算/数量/容量。两者不隐式继承。没有注册全局默认 sessionId 字段，避免给其他宿主 RPC 附加 ATN 资源约束。
- `src/observer-access.ts` 导出资源名和两种公开角色；观察端点注册前检查资源 API 和实际方法 reader，不比较版本号推定能力。
- **exportSubstrate 二选一结论：采用可信宿主假设。** 保留无 caller 校验的完整导出，代码注释、README、威胁模型、接入指南与通道审计均显式说明。持有 ctx.atn 的插件还可读取原始记录，单独接受一个自报 operator 参数不足以形成隔离；任何未来远程包装都须先做相同模型的授权。

## 先红后绿

先完成威胁模型及现有测试锚定，再添加 READ-AUTH 三项初始用例，保留[原始红灯](execution-evidence/read-authorization-20261016/before.txt)（exit 1，0/3 通过），随后修改生产代码：

1. `READ-AUTH-GLOBAL`：只获 global snapshot action 的非 owner 可读指名网络，旧实现报 `Missing expected rejection`，确认真实未授权放行路径。
2. `READ-AUTH-SCOPED`：会话资源授权在旧实现不生效，合法请求被拒。
3. `READ-AUTH-METADATA`：旧实现无 metadata 端点。

修复后补充缺省/抛错策略、冷记录和能力缺失测试。[定向运行](execution-evidence/read-authorization-20261016/focused.txt)共 11 项通过，包括 6 项原有观察契约与 5 项 READ-AUTH 契约。双主体交叉指名、networkId 冒充 sessionId、额外 principal/networkId/allNetworks 参数、撤销后重试均拒绝。冷读取负例设置存储屏障，证明拒绝先于网络枚举/加载；合法授权无需加载 Agent。拒绝与 metadata 调用的业务记录、模型请求和会话历史保持不变。

红灯是在工作树内先保存再修复，没有为此创建 Git 提交；没有与 §5/§6 混合提交。用户原有未提交文件与文档修改保留。

## 最终验证

执行环境为 Windows / Node v24.19.0，Harness 使用本地独立安装的 `0.2.1-alpha.4`；固定在仓库的 alpha.4 协议和网关代码也已核对。

| 命令 | 结果与证据 |
|---|---|
| `npm run typecheck` | exit 0；[日志](execution-evidence/read-authorization-20261016/typecheck.txt) |
| `npm test` | exit 0；**593 项 runtime/集成 + 15 项 UI，零失败、零跳过**；[日志](execution-evidence/read-authorization-20261016/tests.txt) |
| `npm run build` | exit 0；[日志](execution-evidence/read-authorization-20261016/build.txt) |
| `npm run verify:sidebar` | exit 0；独立 0.26.1 声明/真实注册服务通过；[日志](execution-evidence/read-authorization-20261016/sidebar.txt) |
| `npm run pack:tarball` | exit 0；含新增模块和类型声明；[日志](execution-evidence/read-authorization-20261016/pack.txt) |
| `npm run smoke:profile` | 显式设置 `DSH_CLI=.scratch/harness-alpha4/node_modules/.bin/dsh.cmd`，exit 0；安装实际 tarball、配置合成、预设 roster/子节点/脚本模型通过；[日志](execution-evidence/read-authorization-20261016/profile.txt) |
| `npm run smoke:visualization` | 同一 alpha.4 CLI，exit 0；实际 tarball 的 Web 认证 cookie、HTTP snapshot/metadata、严格参数、客户端 bundle、动态观察与只读断言通过；[日志](execution-evidence/read-authorization-20261016/web-observer.txt) |

首次 Profile smoke 使用脚本默认 Desktop CLI（实际为 0.2.0-rc.2），被兼容校验拒绝，exit 1，保留[原始记录](execution-evidence/read-authorization-20261016/profile-default-cli.txt)。随后改用已安装的目标 alpha.4 CLI 验证通过；未加兼容豁免、未放宽校验、未修改用户宿主配置。

额外 Web smoke 首跑触发[异步邮件回执竞态](execution-evidence/read-authorization-20261016/web-before-mail-barrier.txt)：驱动 idle 后，仍有 queued → delivered 持久写入进入观察比较窗口。此问题与旧 substrate 报告的 BOUNDARY-ADMISSION 夹具竞态同型；本轮在 `tests/smoke/visualization-observer.mjs` 的副作用基线之前逐封等待真实 deliverMail 回执并再次等待驱动 idle，保留完整记录相等断言。未修改生产邮件行为、未删除断言或用任意延时掩盖问题；修正后 Web smoke 通过，同时新增 HTTP metadata 的精确字段断言。

最终源码/夹具与 tarball 的 SHA-256 见[验证清单](execution-evidence/read-authorization-20261016/manifest.json)。`git diff --check` 通过。全量测试后仅修改文档与 Web smoke 夹具；夹具修改已由实际安装包的 Web smoke 验证。

## 证明边界

ATN 层负责 live 节点身份、网络业务分区及严格投影；非 owner 的 principal/resource/action 校验由真实上游 Gateway 执行，测试中的 Peer 身份由可信 fixture 创建。双主体用例不是外部 IAM/认证载体的端到端认证证明。owner 的 bypass 是上游协议；直接宿主 API 仍可跨网读取，已作为明确前提记录。

本轮零外部/付费模型调用；脚本模型仅用于结构验证。默认八工具和关闭 substrate 时的固定上下文未改，既有对应测试通过。持久化 domain 仍为 1。没有改变权重/排序/出站准入，也未新增模型工具。

不把网络当租户、不宣称任意语义泄漏不可行；不证明框架外存储、凭据、模型路由隔离。GitHub 托管 CI 未执行；better-sidebar 完整 provider host 激活仍未验证；没有发布 npm 或部署用户服务。
