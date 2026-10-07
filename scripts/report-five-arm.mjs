/** Render the independently reconciled five-arm data; never launches or replaces samples. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: {
  audit: { type: 'string', default: 'experiments/results/five-arm-comparison-20261006.json' },
  reference: { type: 'string', default: 'experiments/results/five-arm-reference-20261006.json' },
  checks: { type: 'string', default: '.artifacts/five-arm/validation.json' },
  out: { type: 'string', default: 'docs/FIVE_ARM_COMPARISON_IMPLEMENTATION_REPORT.md' },
} })
const json = async path => JSON.parse(await readFile(resolve(path), 'utf8'))
const audit = await json(values.audit), reference = await json(values.reference), validation = await json(values.checks)
const summary = audit.comparison?.summary
if (!summary || !audit.comparison.complete) throw new Error('Complete five-arm data required; no partial report may be labeled complete')
const number = value => value === null || value === undefined ? '—' : value.toFixed(2)
const probability = value => value === null || value === undefined ? '—' : value.toFixed(4)
const pct = value => value === null || value === undefined ? '—' : (value * 100).toFixed(2) + '%'
const rate = value => `${value.successes}/${value.n} (${pct(value.estimate)}) [${pct(value.interval?.lower)}, ${pct(value.interval?.upper)}]`
const metric = value => value.mean === null ? '—（无完成／已知观测）' : `${number(value.mean)} ${value.interval ? `[${number(value.interval.lower)}, ${number(value.interval.upper)}]` : '（单次，无可估计区间）'}`
const arms = summary.arms
const runs = audit.comparison.runs
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0)
const factualCount = sum(runs.map(run => run.factFlowAudit), 'auditedFacts')
const lines = [
  '# 五臂比较修订方案实施报告（2026-10-06）', '',
  `执行 [修订方案](FOUR_ARM_COMPARISON_REVISED_BRIEF.md)。五臂各 5 次，共 ${runs.length}/25 次真实 Desktop 导入模型运行已完成；独立原始审计 ${audit.auditPassed ? '全部通过' : '**存在失败，详见 JSON**'}。adaptive 两阶段完成 ${rate(arms.find(arm => arm.mode === 'adaptive').completion)}。主指标为完成运行的模型调用数；失败消耗另列。\`mayInterpretTopology=${audit.mayInterpretTopology}\`，\`causalClaim=false\`，收益主张为 \`${audit.benefitClaim}\`。`, '',
  '本轮没有增加重复数、提高预算或替换失败样本。旧 ≥4/5 能力门槛已删除；比较直接执行，比较结束后仅以 adaptive 至少一次两阶段完成判断是否有可比信号。换边／拦截／rejected／80% 步数余量均为诊断，不决定比较准入。身份、同源码／模型／预算、配对 seed、构造性绑定及正向事实流仍须核验。', '',
  '## 设计与实际执行', '',
  '模型为历史探针中实际完成过任务的 `deepseek-v4.1-flash`，经实际 Desktop 的 `dsh-opencode-go` → prepareCall 与 installed agent-loop 身份桥接；没有直接 HTTP 推理。LongCat 明确排除。旧探针仅用于模型选择，不借作本轮同源码能力估计。', '',
  '配对 seed 固定为 17、31、45、59、73；8 节点、链长 2，48 步／节点、384 次全网可观测调用准入、4096 输出 token／调用、800 万已观测 token 准入阈值、600 秒／次；autoAdvance=false。各臂完全相同，只有 fixed-wide 的出度上限为 4，其他臂为 2。stepBudget 不是 token、HTTP 请求或费用上限。源码在运行前冻结，所有 manifest 哈希一致；生产默认值未修改。', '',
  `原 Desktop profile 完整性：${audit.comparisonBootstrap?.integrity.unchanged ? '前后哈希一致' : '未通过或未验证'}；载体完整结束：${audit.comparisonBootstrap?.completion.completed ? '是' : '未通过或未验证'}。原始 Session、storage、工具及 provider 事件保留在 \`.artifacts/experiments/five-arm-deepseek-comparison-20261006/\`。设计、源码快照、配置及命令日志在 \`.artifacts/five-arm/\`。`, '',
  '## 固定出度 4 的策略与零模型参考', '',
  '选边函数仅接收运行时公开 live node ID，按可追溯的出生顺序排列；这些身份可通过有界 atn_status(query="*") 发现。每个节点一次性选择循环偏移 [-1,+1,+2,+3]，入口 peers 对应 slot [7,1,2,3]。选择发生在模型调用／证据读取之前，不输入 seed、fixture、任何阶段信息或文档。纯函数无 fixture/scenario 导入；静态 AST 测试核查唯一参数及数据来源。所有节点禁止主动换边，实际发送 ACL 还将自动补边限制在初始静态集合内。', '',
  '| Seed | adaptive 必需事实／入口步／消息 | fixed 必需事实／入口步／消息 | fixed-wide 必需事实／入口步／消息 | fixed-wide 两阶段完成 |',
  '|---|---|---|---|---|',
  ...reference.runs.map(pair => { const cell = run => `${run.obtainedRequiredFactCount}/${run.requiredFactCount} / ${run.entrySteps} / ${run.messages}`;
    return `| ${pair.conditions.seed} | ${cell(pair.adaptive)} | ${cell(pair.fixed)} | ${cell(pair['fixed-wide'])} | ${pair['fixed-wide'].passed ? '是' : '否'} |` }), '',
  '以上三种参考均为零模型调用，通过真实 runtime、同一所有权 ACL 和实际 task/result，公开元数据选持有者，已收到事实构造答案。静态参考为诊断访问第二阶段，即使第一阶段没有提交；这种宿主推进不计真实完成。adaptive 每次 0 调用、27 入口步、19 消息，未经最优性证明。', '',
  'fixed 的不可完成源于四个不同必需持有者超出度二；fixed-wide 的失败源于本次公开静态策略遗漏必需持有者，属于任务设计与选边策略的后果。度四的必需持有者并集本身可被一个预知 fixture 的静态邻域覆盖，因此不能宣称所有度四静态图都结构上不可解，也不能把这两臂失败写成自适应收益。', '',
  '## 完成率、功效与效率', '',
  '完成率用 [Wilson 95% 区间](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)，随每个完成／提交率输出功效声明。在 n=5 下，约 60 个百分点以下的效果不可靠区分。当前设计更严格：五对 seed 的双侧 [精确 McNemar 检验](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html) 即使全部五个差异同向也为 p=2/2⁵=0.0625；alpha=0.05、目标功效 80% 下，[0,100] 个百分点内无可达到的最小可检出效应（JSON 为 null 并注明不可达到，不伪造有限阈值）。十个臂对预先采用 Holm 校正。边际区间重叠不等于等效，分离也不能代替配对检验。', '',
  '连续指标报告算术均值及双侧 Student t 95% 区间，只计两阶段都正确且正向事实审计通过的运行。零完成时没有效率估计；单次完成不能估计方差／区间。t 区间依赖独立 seed 与均值近似正态，小样本仅作描述，允许数学下界为负，不将其解释为负消耗。成功条件造成选择偏差，不能把成功样本均值直接写成全任务速度收益。', '',
  '数值核对：3/5 的 Wilson 95% 区间为 [23.07%,88.24%]，4/5 为 [37.55%,96.38%]；两者重叠。构造性参考对每个脚本动作调用 admitStep，真实模型一步可执行多个工具；入口步倍数只比较这一既定计量口径，不证明某个执行者最优。', '',
  '| 臂 | 完成率及 Wilson 95% 区间 | 完成运行模型调用均值 [95% CI] | ATN 交互均值 [95% CI] | 传输字节均值 [95% CI] | 入口步均值 [95% CI] |',
  '|---|---|---|---|---|---|',
  ...arms.map(arm => `| ${arm.mode} | ${rate(arm.completion)} | ${metric(arm.efficiency.modelCalls)} | ${metric(arm.efficiency.interactions)} | ${metric(arm.efficiency.transferBytes)} | ${metric(arm.efficiency.entrySteps)} |`), '',
  '## 失败消耗与协议诊断', '',
  '| 臂 | 失败数 | 失败调用总计／均值 [95% CI] | 失败交互总计 | 失败字节总计 | accepted / rejected | 换边尝试 / 成功 / 拦截 / 同列表 / 未结算 | 最大节点步数占比 |',
  '|---|---|---|---|---|---|---|---|',
  ...arms.map(arm => `| ${arm.mode} | ${arm.failedConsumption.runs} | ${number(arm.failedConsumption.modelCalls.totalKnown)} / ${metric(arm.failedConsumption.modelCalls)} | ${number(arm.failedConsumption.interactions.totalKnown)} | ${number(arm.failedConsumption.transferBytes.totalKnown)} | ${arm.feedback.accepted} / ${arm.feedback.rejected} | ${['statusRewireCalls','successfulRewires','blockedRewires','unchangedRewires','pendingRewires'].map(key => arm.rewires[key]).join(' / ')} | ${pct(arm.maxNodeStepRatio)} |`), '',
  'accepted/rejected 是所有实际已评价 task 的请求者本地计数，初始化回执也可能被评价；它们不等于取得的必需事实数、宿主正确率或人类授权。', '',
  '调用计数来自实际全网准入，不依赖 token usage。未知 token／cache／费用不记为零；knownTotal 只是有覆盖部分，knownCalls、unknownCalls、缺失运行计数分列。宿主启动／阶段通知另计；ATN 字节包括实际邮件及白板操作，不代表全部模型上下文字节。费用是目录参考价估计，不能写成订阅账单。', '',
  '| 臂 | 成功／失败 total-token usage 未知调用 | 成功／失败 input usage 未知调用 | 成功／失败 cache-read usage 未知调用 | 成功／失败费用未知调用 |',
  '|---|---|---|---|---|',
  ...arms.map(arm => `| ${arm.mode} | ${arm.efficiency.usage.totalTokens.unknownCalls} / ${arm.failedConsumption.usage.totalTokens.unknownCalls} | ${arm.efficiency.usage.inputTokens.unknownCalls} / ${arm.failedConsumption.usage.inputTokens.unknownCalls} | ${arm.efficiency.usage.cacheReadTokens.unknownCalls} / ${arm.failedConsumption.usage.cacheReadTokens.unknownCalls} | ${arm.efficiency.referenceCost.unknownCalls} / ${arm.failedConsumption.referenceCost.unknownCalls} |`), '',
  ...['cacheWriteTokens', 'reasoningTokens'].map(field => `${field}：已知调用 ${arms.reduce((n,arm) => n+arm.efficiency.usage[field].knownCalls+arm.failedConsumption.usage[field].knownCalls,0)}；未知调用 ${arms.reduce((n,arm) => n+arm.efficiency.usage[field].unknownCalls+arm.failedConsumption.usage[field].unknownCalls,0)}。缺失部分保持未知。`), '',
  '## 相对同拓扑构造性参考的连续指标倍数', '',
  '模型调用基线为 0，所有模型调用倍数均为未定义；报告实际调用均值，不写成 Infinity。以下倍数以每个完成样本对应的同 seed、同拓扑参考计算，再报告均值和区间。没有完整参考的静态臂不能当作完整任务效率基线。', '',
  '| 臂 | 完成样本数 | ATN 交互倍数 [95% CI] | 传输字节倍数 [95% CI] | 入口步倍数 [95% CI] | 模型调用倍数 |',
  '|---|---|---|---|---|---|',
  ...arms.map(arm => `| ${arm.mode} | ${arm.efficiency.runs} | ${metric(arm.costMultiples.interactions)} | ${metric(arm.costMultiples.transferBytes)} | ${metric(arm.costMultiples.entrySteps)} | 未定义（参考为 0） |`), '',
  '## 哪些差异不可区分', '',
  '| 臂对 | 配对 n | A 独有成功 / B 独有成功 | 双侧精确 p / Holm p | 完成率差异 | 共同完成数 | 共同完成的调用差 A−B [95% CI] |',
  '|---|---|---|---|---|---|---|',
  ...summary.comparisons.map(pair => `| ${pair.a} vs ${pair.b} | ${pair.pairedSeeds} | ${pair.aOnly} / ${pair.bOnly} | ${probability(pair.pValue)} / ${probability(pair.holmPValue)} | ${pair.distinguishableCompletion ? '可检出' : '本样本量不可区分'} | ${pair.successfulPairs} | ${metric(pair.modelCallDifference)} |`), '',
  `完成率不可区分项：${summary.indistinguishablePairs.join('；')}。共同完成样本不足或调用差区间包含零时，连续效率差异也不可区分；没有共同完成的臂对没有可比较的效率信号。即使条件效率区间不包含零，也只描述共同完成样本，不是总体收益或因果结论。`, '',
  ...['not-distinguishable-at-this-sample-size', 'no-estimable-paired-efficiency-interval', 'nominal-conditional-interval-excludes-zero'].map(status => {
    const pairs = audit.continuousComparisons.filter(pair => pair.status === status)
    const label = status === 'not-distinguishable-at-this-sample-size' ? '连续调用差区间含零，不可区分' : status === 'no-estimable-paired-efficiency-interval'
      ? '无法估计配对效率区间' : '共同完成样本中的名义连续区间不含零'
    return `${label}：${pairs.length ? pairs.map(pair => pair.a + ' vs ' + pair.b + (pair.lowerCallArm ? '（'+pair.lowerCallArm+' 调用较少）' : '')).join('；') : '无'}。`
  }), '',
  '连续臂对区间是未作多重校正的名义 95% Student t 区间，仅描述共同完成样本；完成率检验的 Holm 校正不能借给这些连续区间，也不据此提出总体收益。', '',
  `允许的结论：${summary.hasComparableSignal ? '在拓扑绑定的任务上，可换边臂能够完成，其余臂结果见报告；本样本量不足以区分上列完成率臂对。' : 'adaptive 无两阶段完成，报告无可比信号，停止拓扑解释。'} adaptive 必须相对 fixed-wide、no-feedback、no-board 全部具备一致且超出区间／配对检验的优势才可提出收益；本轮收益主张 ${audit.benefitClaim === 'not-supported' ? '不成立' : audit.benefitClaim}，全部 causalClaim=false。`, '',
  '## 逐次运行与保留的异常', '',
  '| Seed | 臂 | Phase 1 提交／正确 | Phase 2 提交／正确 | 调用 | 入口步 | 终止原因／失败类型 | LLM finish-error 记录数 | 原始工具错误条数 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...runs.map(run => `| ${run.seed} | ${run.mode} | ${run.phase1Submitted} / ${run.phase1Correct} | ${run.phase2Submitted} / ${run.phase2Correct} | ${run.issuedModelCalls} | ${run.entrySteps ?? '未知'} | ${run.stopReason} / ${run.failureClass ?? 'none'} | ${run.failures.length} | ${Object.values(run.rawAudit.toolErrorsByCode).reduce((a,b) => a+b,0)} |`), '',
  `LLM finish-error 记录 ${runs.reduce((n,run) => n+run.failures.length,0)}；遥测 errors / aborted / incomplete 为 ${['errors','aborted','incomplete'].map(field => runs.reduce((n,run) => n+(run.metricsTotals?.[field] ?? 0),0)).join(' / ')}；导入适配器 thrown 事件 ${runs.reduce((n,run) => n+(run.rawAudit.importedCallEvents['imported-call-thrown'] ?? 0),0)}（可能包含宿主取消，不能全部当作 provider 连接失败）。详细原始计数均保留。`, '',
  `正向事实流审计覆盖全部 ${runs.length} 次真实运行、${factualCount} 条实际提交事实；未提交样本无 asserted facts，仍是失败完成。另独立核对实际 live 身份、单向请求时直连边、精确所有者、实际 task/result、提交前交付、本地读取 ACL、所有节点模型／工具 schema／权限、持久化换边与计数、源码和节点步数。原始工具错误分类、未知 usage、失败／超时／收尾状态都在 JSON 保留。`, '',
  '## 完成标准与边界', '',
  '| 命令 | 本轮实际结果 | 保留输出 |',
  '|---|---|---|',
  ...validation.commands.map(command => `| ${command.command} | ${command.exitCode === 0 ? '通过（exit 0）' : '未通过（exit '+command.exitCode+'）'}${command.summary ? '；'+command.summary : ''} | ${command.log} |`), '',
  '旧测试没有删除；与旧成功率／违规计数准入矛盾的断言按修订方案改为区间及诊断，并新增同源码比较身份、缺失遥测、不可达到功效、成功／失败分离、纯公开选边输入和 fixed-wide 实际 runtime／ACL 对照断言。入口宿主所有权、原子网络 mutation、单向边、真实工具身份、授权边界、白板作者／版本／分页／计量及同能力语义未改。', '',
  '已完成：删除小样本点估计准入；fixed-wide 零模型参考及公开策略证明；成功条件连续主指标和失败消耗分离；25 次五臂比较及全体正向审计；完成率区间／设计功效／十对不可区分项；README 和本报告更新。未完成或未获支持：总体速度收益、独立自适应收益、因果估计与更大样本确认，本轮均不宣称成立。', '',
  '复核命令（后两条只重算，不发起模型调用）：', '',
  '```text',
  'npm run experiment:five-arm-reference',
  'node --import tsx/esm scripts/summarize-topology-binding.mjs --comparison .artifacts/experiments/five-arm-deepseek-comparison-20261006 --comparison-bootstrap .artifacts/five-arm/desktop-comparison-20261006 --out experiments/results/five-arm-comparison-20261006.json',
  'npm run experiment:five-arm-report',
  '```', '',
  '数据：[五臂原始独立核对与区间](../experiments/results/five-arm-comparison-20261006.json)、[三拓扑构造性参考](../experiments/results/five-arm-reference-20261006.json)。本地真实启动使用已有 Electron Node carrier 与冻结配置；重新启动会创建新样本，不能把额外成功替换本轮失败。', '',
]
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), lines.join('\n'))
console.log(JSON.stringify({ out: values.out, runs: runs.length, auditPassed: audit.auditPassed,
  indistinguishableCompletionPairs: summary.indistinguishablePairs.length, mayInterpretTopology: audit.mayInterpretTopology, causalClaim: false }))
