# V2 合并实施报告

日期：2026-10-17。执行输入为 [MASTER_EXECUTION_PLAN_V2](MASTER_EXECUTION_PLAN_V2.md)，用户已批准 §12 三项推荐：读策略默认关闭、套件随包发布、舰队显式授权且默认不授予。全过程使用脚本模型验证结构，未调用外部/付费模型、未发布 npm、未推送远程或执行 GitHub 托管矩阵。

## 前置与实施提交

旧工作树按来源收尾归档，未丢弃原有改动：历史探针归档、读取边界提交 `2e99b63`、批准计划与实测基线 `e3c7178`。原始基线 `npm test` 为 **593 runtime/集成 + 15 UI，0 fail/skip**；live registry 为 **7956 / 5910** 字节。[前置证据](execution-evidence/round-v2-preflight/README.md)。归档的旧 probe 文件不是本轮真实模型调用证据。

| 阶段 | 独立提交 | 要求／结果 | 证据 |
|---|---|---|---|
| 0 工程卫生 | `2fc0448` | 七个零直接 import 包按真实传递 peer/宿主依赖图逐项保留；措辞改任务可见性；读取面声明清单同步 | [阶段 0](execution-evidence/round-v2-phase0/README.md)、DECLARATION_AUDIT；593 + 15 |
| 1 命名空间 | `f210091` | msg/node/task/artifact 同名本地解析、外网独有拒绝、真实 Agent 工具与双主体 Gateway；分别报告业务分区/读取授权，无生产补丁 | [阶段 1 两张表](execution-evidence/round-v2-phase1/README.md)；595 + 15 |
| 2 可选读策略 | `3828de1` | 同一 principal/resource/action；排序前过滤、祖先闭包、可见权重重放、citedBy/任务证据过滤、隐藏/未知错误不可区分、关闭对照、冷重放、同步失败原子性；论文第 8 偏离 | [阶段 2](execution-evidence/round-v2-phase2/README.md)、[授权契约](OBSERVER_READ_AUTHORIZATION.md)；601 + 15 |
| 3 宿主套件 | `03b09e5` | 46 个可携带结构用例；14 通道 held/unheld、三类引用、传输字段、原子性、容量与读策略；两个错误策略实际红灯；npm files/exports 与独立解包 CLI 可得 | [阶段 3](execution-evidence/round-v2-phase3/README.md)、[接入指南](../conformance/README.md)；603 + 15 |
| 4 舰队观察 | `b85513e` | atn-fleet/index + 逐网络授权；默认拒绝且不用 owner bypass；严格只读快照、有界易失拒绝桶；原 tab/顶栏内部切换；真实浏览器 A/B/双网/未授权范围 | [阶段 4](execution-evidence/round-v2-phase4/README.md)、[计数口径](FLEET_OBSERVATION_CONTRACT.md)；606 + 17 |
| 5 日志设计 | 本报告同阶段文档提交（见 git log） | 仅文档：三种一致性/丢失策略、JSON Lines 五字段、最终 14/16 词汇、宿主 ownership、独立未来权限、B-REFUSAL-LOG；无日志实现 | [设计稿](REFUSAL_LOG_DESIGN.md)、[阶段 5](execution-evidence/round-v2-phase5/README.md) |

阶段 0/1/2/3/4 均在全部命令成功、证据保存并独立提交后才开始下一阶段。阶段 1 为纯补证：红灯明确是故意指向错误网络的 resolver 负对照，不伪称生产漏洞。

## 修复依据与主动收窄

- 阶段 2 除 search/visit 外，先红后绿确认 status.tasks 的 result.evidence 可返回隐藏 msg 根；补同一任务证据投影和 review 引用校验，未新增发现源。公开 API 清单曾检出新增安装方法未分类，原始失败留档后登记可信宿主入口。
- 阶段 3 按停止条件 4 收窄可携带语义范围：全部 16 拒绝名冻结；八个协议专属码没有任意宿主通用触发，仍由真实 reference-policy 测试覆盖语义。未引入内部 import 或公开测试后门，也未声称通用套件证明任意宿主协议/提取器。
- 阶段 4 选择观察服务存活期的易失桶，**不**为拒绝计数写业务 NetworkRecord，保留拒绝整记录/写次数不变。每码 65535、64 网络桶，最多返回 32 授权网络；无网络身份拒绝、网关拒绝与非结构化存储故障不计入该口径。重启/淘汰清零，不是持久计数或合规日志。
- 阶段 4 的 ci 首跑遇到预览进程持有 esbuild.exe 的 Windows EPERM；关掉临时预览后恢复。真实 Web smoke 首跑检出测试插件缺少 remoteAccess inject，补夹具声明后通过；未关闭 Cordis 注入检查或授权检查。

## 读取面与公开增量

| 读取面 | principal / resource / action | 边界 |
|---|---|---|
| node substrate | live Agent → 宿主非 owner 映射 / atn-substrate JSON(networkId,address) / atnSubstrate/read | 默认无策略全网读；显式策略后按可见闭包读，抛错/异步 fail closed；host policy/bindings 须纯函数并带同版本授予快照重放 |
| 单网络观察 | 真实 Peer / atn-observation session 别名 / snapshot 或 metadata | session 授权是整网披露，两个 action 独立 |
| 舰队 | 真实非 owner Peer / atn-fleet:index 加逐网络资源 / atnObserver/fleet | 自己的 grants 派生范围，加载前后复核；owner 拒绝，无任意 networkId 参数 |
| exportSubstrate/raw host API | 可信宿主，无 caller 校验 | 保留 B-HOST-EXPORT 书面前提，不是外部安全代理 |
| 拒绝日志 | 仅设计，尚无实际读取面 | 未来另设独立 stream 资源/action，当前没有 journal API |

导出增量：defineSubstrateReadPolicy、SubstrateReadPolicy/Options、substrateResourceId、ATN_SUBSTRATE_READER；ATN_FLEET_READER、fleetNetworkResourceId、AtnFleetSnapshot；`dsh-atn/conformance` JS/类型/CLI。安装读策略仍为宿主方法。模型八工具、参数、固定上下文及发现来源不变；持久化 domain 仍 1。

## 验证状态

每阶段的 gates.json 记录 `npm ci`、typecheck、全量 npm test、build、pack:tarball、显式 `.scratch/harness-alpha4` CLI 的 smoke:profile、smoke:visualization、独立 sidebar 0.26.1 的 verify:sidebar 与 diff --check 的实际退出码和时间。红灯不覆盖成绿灯；必要的第一次失败单独保存。

阶段 5 的完整闸门已全绿（606 runtime/集成 + 17 UI，零失败零跳过），只包含文档 diff。最终整体复核尚在执行；结果将补入 [最终 gates.json](execution-evidence/round-v2-final/gates.json)，不将未执行命令视作通过。

浏览器截图来自一次性 loopback fixture 的真实 kernel/Peer/Gateway 与产品同一 ObserverHost/FleetView；选择测试主体的控件只存在于 fixture，不能作为产品 IAM。真实 tarball Web smoke 另验证 HTTP owner 拒绝与非 owner 两网 Gateway 读取。截图：[舰队](execution-evidence/round-v2-phase4/browser-all.png)、[未授权](execution-evidence/round-v2-phase4/browser-denied.png)。

## 未完成与不主张

未实现持久拒绝日志、持久计数、外部 IAM、凭据/框架外存储/模型路由隔离或任意自然语言保密；网络不是认证租户。宿主可变策略若不保留版本/授予快照，不主张跨版本重放。通用套件的宿主端口与 claim grammar 必须诚实接真实 API，不能用预置答案代替。

不主张真实模型会使用新增能力、正确率/效率/吞吐/成本/延迟收益、CJK 检索质量或语义贡献保证。完整 better-sidebar provider host 激活仍受上游 webRuntime 限制，未验证；本轮未跑 GitHub 托管 CI 矩阵、未扩展 §10 发布治理或重开等预算线。
