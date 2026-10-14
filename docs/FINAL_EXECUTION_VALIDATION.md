# 本轮实施最终验收

日期：2026-10-14，分支 `codex/release-ready`。A、B、C 客户端、声明审计与 D 已分阶段提交；**完整 better-sidebar 0.26.0 host 在目标 Harness 上仍未激活**。用户在该上游阻塞报告后授权自行权衡，故交付可选原生 Tab API 接入与始终可用的结构化顶栏回退，不补旧服务 shim 或擅改另一个插件。

## 最终矩阵

D 决策提交 `3fb34c0` 后，在本工作区执行。目标 CLI 为独立安装的 `@deepseek-ai/dsh@0.2.1-alpha.2`，`DSH_CLI=D:\dsh-ATN\.scratch\harness-alpha\node_modules\.bin\dsh.cmd`；Desktop 内置 rc.2 不作为目标验证环境。

| 命令 | 结果 | 原始输出 |
|---|---|---|
| npm ci | 0，243 packages；普通解析，不使用force/legacy-peer-deps | [FINAL-ci.txt](execution-evidence/FINAL-ci.txt) |
| npm run typecheck | 0，host/client测试类型检查 | [FINAL-typecheck.txt](execution-evidence/FINAL-typecheck.txt) |
| npm test | 0，551 runtime/集成 + 14 UI，fail=0/skipped=0 | [FINAL-test.txt](execution-evidence/FINAL-test.txt) |
| npm run build | 0，client.js=479789 bytes | [FINAL-build.txt](execution-evidence/FINAL-build.txt) |
| npm run pack:tarball | 0，102 files | [FINAL-pack-tarball.txt](execution-evidence/FINAL-pack-tarball.txt) |
| npm run smoke:profile | 0，真实隔离目标profile、五工具与Standard隔离/继承 | [FINAL-smoke-profile.txt](execution-evidence/FINAL-smoke-profile.txt) |
| npm run smoke:visualization（额外） | 0，6节点、跨分支有向/出生边、失败结果、live变化、严格RPC、只读、client served | [FINAL-smoke-visualization.txt](execution-evidence/FINAL-smoke-visualization.txt) |

逐命令退出码与耗时见 [FINAL-commands.json](execution-evidence/FINAL-commands.json)。报告/README最后同步后，仅重打包并再跑两个profile smoke，使最终 tarball 携带当前 README；日志另列 `FINAL-delivery-*`。没有重复增加付费模型测试。

## 各阶段可核验交付

- A：`25cf67c`；前置失败 `e54925c`、`9344c5c`。目标实际 guide 数为 **24=5+19**，输入22篇过期，全部逐篇核对见 [A报告](HARNESS_0_2_1_IMPLEMENTATION_REPORT.md)。移除invariants、迁移cwd、补真实Team目录契约；核心工具身份与schema保持。基线后台竞态、旧CLI拒绝也保留，没有隐藏红灯。
- B：`f47eec0`；前置失败 `2509d98`。默认 **N8=4 / N32=6**；完整 [1..32度数表](execution-evidence/FINAL-degree.csv)，含最大出边192/全连接992。旧网络缺省/冻结4兼容，退休累计不降额；显式实验2不改变。五seed两种配置结论/资格均**0翻转**，完整 [复核](execution-evidence/FINAL-proofs.json)，不外推任意大网络/四边策略。
- C：`feb242d`；前置断言失败 `4554c42`，原provider阻塞留档 `60924fe`。删除layout/SVG/图形样式与locale；共享纯props展示、serial visible polling、可选子scope/disposer、ATN门控、真实结构化回退。有/无服务测试及actual published registry通过；全部删除清单/断言改写见 [C报告](BETTER_SIDEBAR_IMPLEMENTATION_REPORT.md)。bundle **485539→479789**，减少5750 bytes。组件截图为mock数据实际组件渲染，非联合provider页面。
- 声明审计：`682dc2b`，[单一审计表与grep分类](DECLARATION_AUDIT.md)。当前发布说明不再把固定4或旧图形作为全规模功能；历史实验/输入/删除证据保留。D之后再次grep原始输出为 [FINAL-declaration-grep.txt](execution-evidence/FINAL-declaration-grep.txt)；source+bundle删除路径无命中，见 [FINAL-client-grep.txt](execution-evidence/FINAL-client-grep.txt)。
- D：`3fb34c0`，[决策记录](NEXT_SCOPE_DECISION_RECORD.md)与修订路线图；事实逐条核实、P0无翻转无需回退、下一轮4项明确范围、暂缓项/高压线/缺口均列出。不是新生产实现。

干净安装后额外重跑 actual published API/registry 检查，见 [FINAL-sidebar-contract](execution-evidence/FINAL-sidebar-contract.txt)、[FINAL-sidebar-registry](execution-evidence/FINAL-sidebar-registry.txt)。consumer窄类型投影只验证使用形状；真实service生命周期不等于完整provider激活。

## 十二项不变式

| 项 | 结论及证据 |
|---|---|
| 1 宿主拥有入口 | 未改变；lifecycle/retire/stop回归通过，未dispose入口 |
| 2 原子网络记录/检查修改同临界区 | 未改变；domain/concurrency回归通过，C不改host |
| 3 单向边/出生只追溯 | 保持；topology与UI精确source→target分组，真实Web跨分支smoke |
| 4 身份取真实live Agent | 保持；agent/preset/信息边界回归，无新可伪造身份入口 |
| 5 人类授权/宿主验收不能由同伴替代 | 保持；信息边界/reference与review回归，UI提交不称验收 |
| 6 stepBudget不是token/HTTP/费用上限 | 保持；budget测试与界面文案，窗口成本不冒称费用 |
| 7 同能力原则 | 保持；未改节点model/tools/permissions，真实profile子节点继承检查 |
| 8 观察只读无模型唤醒/网络写入 | 保持；observer、DYNAMIC-STATUS、真实Web smoke核对状态/请求数；允许普通RPC开销 |
| 9 durable domain版本1 | 保持；schema/domain回归，新增可选字段兼容旧记录 |
| 10 不增删改模型工具或schema | 五工具保持；真实kernel [FINAL-context.json](execution-evidence/FINAL-context.json)：systemPromptBytes1161、toolSchemaBytes4749、fixedContextBytes5910，与A修复前相同 |
| 11 不删测试/不弱化断言 | 原测试保留，A仅relay契约、B范围/旧实验额度、C图形→有向分组等价改写；逐项理由在三阶段报告，最终全部通过 |
| 12 不将未测试宣称已通过 | 本报告限定实际目标CLI/服务API/组件/观察面；以下未完成项保留 |

## 明确保留的限制

1. better-sidebar发布版0.26.0完整启动仍pending(webRuntime)，普通同装peer不兼容；ATN未安装该provider也能正常构建、运行与查看结构化状态。真实原生侧栏联合host/browser验收和具体guide第5条说明挤压未完成，需上游适配及联合复测。
2. 当前UI的历史提交统计与遗留任务候选来自有界observer，不是完整履约/验收率或严格孤儿授权判定。未扩大host观察协议或调用模型工具来补数据。
3. 未进行新32节点可达性/真实付费模型实验，没有一般质量/速度收益、租户端到端隔离、任意语义泄漏或不可篡改完整重放证明。D定义下一轮补证范围，不冒称本轮已实现。
4. 未发布npm、push或修改用户真实profile；本地tarball位于 `.artifacts/dsh-atn-0.5.0.tgz`，历史npm 0.5.0与本轮源码区分。开工前四份用户输入plan/brief保持原文未纳入实施提交，工作树中的这些untracked文件不是遗漏的实现文件。

本轮已完成授权范围内可独立验收的ATN实现、文档审计与决策。外部provider完整兼容未冒称已达成。
