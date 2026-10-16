# A/B/C 统一声明审计

日期：2026-10-14，C 代码 `feb242d` 之后、D 之前执行。位置列保留总纲输入时的行号，后续插入文案使实际行号改变。表中旧声明是审计对象，不代表当前承诺。

| 原位置 → 当前段落 | 旧声明 | 新声明 | 依据（阶段 / 测试或实测） |
|---|---|---|---|
| README:32 → 拓扑层表格 | 出度严格受限 ≤4 | 累计规模对数曲线；默认8节点=4，32节点=6；历史证明限定冻结额度 | B / DYNAMIC-01..05，degree-table完整1..32，五seed脚本 |
| README:62 → 出度硬顶控制 | 单节点最大活跃出边4 | min(天花板,ceil(log2累计N)+1)，默认/硬顶8，累计含退休失败；保留稀疏承诺 | B / DYNAMIC-01..05、DYNAMIC-STATUS，192/992边比例 |
| README:220 → 配置表 | 默认4，硬约束1–4 | 默认天花板8，范围1..8，status报告有效值；旧4/缺省冻结4，显式2保留 | B / CONFIG-02、DEGREE-05、ADAPT-12、DYNAMIC-STATUS |
| README:73–86 → 状态面板 | 动态有向连通图，旧可视化入口，全量历史履约率，无系统负载 | 节点表/有向邻接/出生分区/详情/活动；顶栏ATN网络状态及条件侧栏；窗口提交率/候选明确限制；有RPC开销无模型调用 | C / 原8UI保留、VIEW-PROPS、VISIBLE、MENU，真实Web smoke只读与请求数 |
| docs/assets/atn-web-gui.png | 旧SVG截图 | 实际NetworkView+确定性mockSnapshot生成的结构化组件示例 | C / render:screenshot成功及人工查看；不声称provider联合页面截图 |
| ADAPTIVE_TOPOLOGY:11 → status重连段 | atn_rewire，上限1–4 | status(rewire)，天花板1..8/默认8，累计曲线/旧记录冻结；N8仍4 | B / CONFIG-02、DYNAMIC-STATUS、冷恢复/domain与拓扑测试 |
| STRATEGY:14 → 机制定位 | 出度上限4 | 随累计规模增长，N8=4/N32=6，安全天花板8 | B / 度数表、单调性/保边测试 |
| STRATEGY:22 → 拓扑证据 | 出度上限4作为证据 | 动态额度；历史结构证明只用于显式冻结实验，不外推大网络 | B / compare-degree-proofs五seed 0翻转 |
| STRATEGY:63 → Topology-as-ACL | 局部配额上限4 | 局部动态配额（8→4、32→6、顶8），未来策略授权仍是方向 | B / DYNAMIC-STATUS；未将未来ACL声明成新实现 |
| docs/README → 当前实施/机制索引 | 固定四边、图形看板及22篇guide | 当前曲线/结构化双路径；24篇实测guide；完整provider尚待上游适配；输入与历史分开说明 | A/B/C / 各报告、24篇核对表、PENDING、真实registry检查 |
| README:107 → 环境要求 | Harness≥0.2.0-rc.2，Cordis4.0.4 | 精确验证Harness0.2.1-alpha.2及Cordis4.0.5-alpha.1；npm历史发布和本分支tarball区分 | A / 干净npm ci、实际manifest、目标profile smoke；旧Desktop CLI拒绝记录 |
| ADAPTIVE_TOPOLOGY:3–5及末段（额外发现） | 当前九工具、feedback/publish/board、当前九工具smoke | 当前五工具；review/rewire合入status，发现由host派生，白板与旧smoke明确历史 | A/C / preset/tool注册测试、fixed-context 5工具4749bytes、真实profile smoke |
| README → 核心口号（额外发现） | 永远说不出未持有的数据 | 启用宿主策略时检查extractClaims识别的artifact身份；不冒称任意语义检测或网络即认证租户 | 既有information-boundary/reference-policy测试与defineCustodyPolicy公开契约；D需进一步形式化 |

## grep 与剩余命中的解释

命令：`rg -n '出度|≤ 4|上限 4|1–4|硬约束|拓扑图|连通图|atn-canvas|可视化ATN网络' README.md docs -g '*.md'`。完整原始结果见 [declaration-grep.txt](execution-evidence/declaration-grep.txt)，不筛掉历史资料以制造零命中。客户端另外检查 `rg -n 'atn-canvas|atn-edge|<svg|zoomIn|zoomOut|layout\.ts' src/client lib/client.js` 无命中，见 [declaration-client-grep.txt](execution-evidence/declaration-client-grep.txt)。

逐类核对：

- README/STRATEGY/ADAPTIVE当前机制段与索引：只陈述新曲线、默认八节点仍四、旧记录兼容；不存在将常量四作为现行全规模硬顶的段落。已撤回旧图形承诺并说明新呈现，无旧图产品引用。
- MASTER_EXECUTION_PLAN、三个A/B/C brief：用户提供的实施前输入；含旧基线、预计失败断言和待删除关键字。索引明确标为历史输入；保留输入原文可归因，不将旧基线改成事后基线。路线图也是待D核实输入，后续结论见D决策。
- FULL_FEEDBACK_EXPERIMENT、FIVE_ARM/FOUR_ARM报告及方案、MEASURABILITY、PEER_VARIANCE、TOPOLOGY_BINDING、TOOL_ERROR_AUDIT：历史实验固定二边或wide四边、旧白板/工具条件。对应档案保留，涉及生产默认常量四的早期报告加历史提示；没有把实验四边改成新默认八或抹掉阴性结果。
- DESIGN_TOPOLOGY_MEASUREMENT/MEASURABILITY中“上限4096”是输出token实验条件；第1–4轮/4.1–4.6是章节或轮次，不是度数范围。EQUAL_BUDGET的“硬约束”是等预算实验条件，仍正确。
- MINIMAL_BUNDLE_SPEC“不做拓扑图WebUI”是早期范围，已加历史说明；现行结构化面板由C报告描述。
- 本审计、C删除清单、B报告、输入brief的grep命令：引述旧声明/移除项，不是现行功能。不得为满足字面grep而删除证据。

这些分类覆盖全部命中文档；原有历史参数和正文未被伪造。本审计独立docs提交，不混C代码/D决策。

## 2026-10-16 上游适配

| 声明 | 本轮变更 | 依据 |
|---|---|---|
| 当前验证版本 | Harness alpha.4、Cordis alpha.2、sidebar 0.26.1 精确 optional peer | UPSTREAM_LATEST_ADAPTATION_IMPLEMENTATION_REPORT；engines.dsh 单独判兼容，范围内仅 alpha.4 实测 |
| 运行行为 | 五工具与固定上下文保持，domain=1；JSONL 入口改为命名空间导入 | 上游移除 default export；类型检查、全量测试和真实 profile |
