/** Revised two-axis report; failures and unknown telemetry remain in the registered sample. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { shiftingConsumption } from '../experiments/shifting-evidence-protocol.ts'
const { values } = parseArgs({ options: { audit: { type: 'string' },
  design: { type: 'string', default: 'experiments/results/simplification-design-20261007.json' },
  power: { type: 'string', default: 'experiments/results/simplification-power-n14-20261007.json' },
  reference: { type: 'string', default: 'experiments/results/simplification-reference-20261007.json' },
  historical: { type: 'string', default: 'experiments/results/five-arm-comparison-20261006.json' },
  checks: { type: 'string', default: '.artifacts/simplification/checks-20261007/validation.json' },
  date: { type: 'string', default: '2026-10-07' }, out: { type: 'string', default: 'docs/SIMPLIFICATION_STUDY_IMPLEMENTATION_REPORT.md' } } })
const read = async path => JSON.parse(await readFile(resolve(path), 'utf8'))
const audit = values.audit ? await read(values.audit) : null
const design = audit?.summary.design ?? await read(values.design), power = design.power ?? await read(values.power)
const reference = await read(values.reference), historical = await read(values.historical), summary = audit?.summary
let checks = null
try { checks = await read(values.checks) } catch (error) { if (error.code !== 'ENOENT') throw error }
const link = (label, path) => `[${label}](${relative(dirname(resolve(values.out)), resolve(path)).replaceAll('\\', '/')})`
const pp = value => value == null ? '未测' : `${(100 * value).toFixed(2)}pp`
const percent = value => value == null ? '未知' : `${(100 * value).toFixed(2)}%`
const ci = value => value ? `[${pp(value.lower)}, ${pp(value.upper)}]` : '不可估计'
const proportionCI = value => value ? `[${percent(value.lower)}, ${percent(value.upper)}]` : '不可估计'
const metric = value => !value || value.mean === null ? '未知／无观测' : `${value.mean.toFixed(2)} ${value.interval ? `[${value.interval.lower.toFixed(2)}, ${value.interval.upper.toFixed(2)}]` : 'CI不可估计'}（已知${value.knownRuns}，未知${value.unknownRuns}）`
const state = !audit ? '离线实现完成；未输入本轮真实审计数据' : summary.observedRuns < summary.plannedRuns ? '真实样本尚未齐全'
  : audit.auditPassed && summary.readyForDecision ? '登记样本与审计完成；建议待维护者决定' : '登记样本已保留；原始或宿主审计未通过，保守不确定'
const lines = [`# 机制简化研究实施报告（${values.date}）`, '',
  `依据：[SIMPLIFICATION_STUDY_BRIEF.md](SIMPLIFICATION_STUDY_BRIEF.md)修订版。状态：**${state}**。本轮是移除决策研究，**未主张收益**；全部 \`causalClaim=false\`，\`benefitClaim=not-claimed\`。版本保持0.4.0。`, '',
  '## 预登记与功效分析', '',
  `${link('维护者登记', values.design)}：δ=${pp(design.margin)}，n=${design.seeds.length}，臂=${design.modes.join('/')}，计划${design.plannedRuns}次。理由：${design.maintainerDecision.rationale} 选择依据：${design.maintainerDecision.evidence}`, '',
  `冻结时间${design.frozenAt}；${link('离线功效分析', values.power)}生成于${power.generatedAt}，模型调用0。seed为${design.seeds.join('/')}，按既有17+14×i规则生成，未按结果挑选或补跑。任务、fixture、ACL、模型和每次运行预算冻结，仅改变机制组成。`, '',
  '判据：Δ=完成率(去机制)−完成率(adaptive)，**95%区间下界L>−δ**；等于边界也不通过。指定反例Δ=−10pp、CI=[−40pp,+20pp]不可接受；Δ=0、CI=[−20pp,+20pp]可接受。两条测试在真实启动前通过，登记目录criterion-tests.txt及criterion-validation.json保留输出和时间。旧上界<+δ规则已禁止登记。', '',
  `最佳情形按Clopper–Pearson单侧95%零不一致对上界1−0.05^(1/n)规划：δ=40/30/25/20/15pp时最小n=6/9/11/14/19。所选δ对应最小n=${power.bestCaseSampleSize.minimumSeeds}，增加${power.bestCaseSampleSize.discordanceReserve}个seed；所选n的该上界${pp(power.bestCaseSampleSize.zeroDiscordanceUpperBound)}。n=10时25.89pp，n=12时22.09pp。`, '',
  `实际配对区间采用[Tango (1998)多项分布有效得分反演](https://www.site.uottawa.ca/~nat/Courses/csi5388/Tango.paired.pdf)，名义双侧95%，不是有限样本精确区间。所选n下零不一致对的**实际得分区间**${ci(power.nonInferiority.zeroDiscordanceInterval.interval)}；CP规划下限不能替代实际区间，Tango 95%在δ=25pp时最小n=12。完成率单独使用Wilson 95%。`, '',
  `最小可能双侧精确McNemar p=${power.minimumPossibleP}，α=0.05${power.alphaAttainable ? '可达' : '不可达'}，仅作设计诊断，不能用优效性支持移除。所选n满足最佳情形可检出性；Δ=0、q=${power.nonInferiority.planningAlternative.discordance}时非劣性枚举功效${percent(power.nonInferiority.power)}，未达到80%目标，低功效预算选择已登记。完成率轴很可能不确定。`, '',
  '| 不一致率q | Δ=0时功效 | 边界分布q | Δ=−δ时拒绝率 |', '|---|---:|---:|---:|',
  ...power.nonInferiority.sensitivity.map(row => `| ${row.discordance} | ${percent(row.power)} | ${row.nullBoundaryDiscordance} | ${percent(row.nullBoundaryRejectionRate)} |`), '',
  `成本轴使用全部配对运行的Student t 95%区间。正态近似80%功效的标准化最小可检出差约${power.costAxis.normalApproximationMdeInPairedStandardDeviations.toFixed(3)}个配对标准差；实际方差未知，不保证小样本成本轴一定有良好功效。实质成本下降的预登记定义：${design.costCriterion.rule} 10%阈值在观测前固定，不按结果放宽。`, '',
  '## 四臂零模型参考', '',
  `${link('参考对照', values.reference)}：${reference.rows.filter(row => row.configurationPassed).length}/${reference.rows.length}通过（${reference.seeds.length} seed×4臂），模型调用${reference.issuedModelCalls}。每臂实际禁用相应机制，均可换边、取得4/4事实并完成两阶段。任一参考失败都阻止真实启动。`, '',
  '| 臂 | 参考通过 | 入口步 | 请求者评价数 | 白板读写 |', '|---|---:|---|---|---|',
  ...reference.modes.map(mode => { const rows = reference.rows.filter(row => row.mode === mode)
    const distinct = field => [...new Set(rows.map(field))].join(', ')
    return `| ${mode} | ${rows.filter(row => row.configurationPassed).length}/${rows.length} | ${distinct(row => row.reference.entrySteps)} | ${distinct(row => row.reference.requesterRatings)} | ${distinct(row => row.reference.board.reads + row.reference.board.writes)} |` }), '',
  '参考只证明配置可解，不代表真实模型能力、成本收益或非劣性。', '', '## 轴A：成本主指标', '']
if (audit) {
  lines.push(`${link('真实数据与原始审计', values.audit)}记录${summary.observedRuns}/${summary.plannedRuns}次，保留${summary.failedRunsRetained}次失败。失败与异常纳入成本主轴，同时另列完成／失败分组。`, '',
    `数据汇总时间：${audit.reconciledAt}。表中均值仅使用有测量的样本；覆盖不足时不能视为全部登记样本的完整成本估计。`, '',
    '| 臂／分组 | 运行数 | 调用均值[t95%] | 交互均值[t95%] | 传输字节均值[t95%] | 入口步均值[t95%] |', '|---|---:|---|---|---|---|',
    ...summary.arms.flatMap(row => [['全部', row.allConsumption], ['完成', row.completedConsumption], ['失败', row.failedConsumption]]
      .map(([group, cost]) => `| ${row.mode}／${group} | ${cost.runs} | ${metric(cost.modelCalls)} | ${metric(cost.interactions)} | ${metric(cost.transferBytes)} | ${metric(cost.entrySteps)} |`)), '',
    '| adaptive−去机制 | 全配对数 | 调用节省[t95%] | 交互节省[t95%] | 字节节省[t95%] | 入口步节省[t95%] | 交互相对下降 |', '|---|---:|---|---|---|---|---|',
    ...summary.comparisons.map(row => `| ${row.mode} | ${row.costSavings.pairedRuns} | ${metric(row.costSavings.modelCalls)} | ${metric(row.costSavings.interactions)} | ${metric(row.costSavings.transferBytes)} | ${metric(row.costSavings.entrySteps)} | ${percent(row.costSavings.interactions.relativeReduction)} |`), '')
  for (const row of summary.arms) {
    const usage = row.allConsumption.usage.inputTokens, cost = row.allConsumption.referenceCost
    const runs = audit.comparison.runs.filter(run => run.mode === row.mode)
    const unsettled = runs.reduce((sum, run) => sum + (run.metricsTotals?.inFlight ?? 0), 0)
    const currencies = [...new Set(runs.map(run => run.metricsTotals?.cost?.currency).filter(Boolean))].join('/') || '币种未知'
    lines.push(`- ${row.mode}：输入token已知部分总计${usage.knownTotal ?? '未知'}，已结算调用中已知${usage.knownCalls}、未知${usage.unknownCalls}、未结算调用${unsettled}、缺失遥测${usage.missingRunTelemetry}次；参考费用已知部分${cost.knownTotal?.toFixed(6) ?? '未知'} ${currencies}，已结算调用中已知${cost.knownCalls}、未知${cost.unknownCalls}、缺失遥测${cost.missingRunTelemetry}次。`)
  }
  lines.push('', '完整usage字段、覆盖数、失败stopReason和异常代码均在JSON；部分已知合计不是完整合计。未知usage、费用和成本保留null，不能记0。费用是目录参考价估计，不是订阅账单；stepBudget只计Agent步数，不是token、HTTP请求或费用上限。', '')
} else lines.push('未提供本轮审计数据，实际运行数、全样本成本和配对节省均未验证，不能记为0或写通过。', '')
lines.push('## 轴B：完成率仅报告', '')
if (summary) lines.push('| 臂 | 两阶段完成 | Wilson 95% |', '|---|---:|---|',
  ...summary.arms.map(row => `| ${row.mode} | ${row.completion.successes}/${row.completion.n} | ${proportionCI(row.completion.interval)} |`), '',
  '| 去机制臂 | Δ | 配对95% | 不一致对（增／损） | L>−δ数值判据 | 完整证据下非劣性 |', '|---|---|---|---|---|---|',
  ...summary.comparisons.map(row => `| ${row.mode} | ${pp(row.riskDifference.estimate)} | ${ci(row.riskDifference.interval)} | ${row.riskDifference.discordantPairs}（${row.riskDifference.gains}/${row.riskDifference.losses}）/${row.riskDifference.n} | ${row.riskDifference.nonInferiorityPassed ? '通过' : '不通过'} | ${row.nonInferiorityPassed ? '通过' : '不确定'} |`), '')
else lines.push('未测；风险差、区间和不一致对未知。成本下降不能替代完成率判定。', '')
if (audit?.comparison.runs.some(row => row.hostInitializationFailure)) lines.push('首次GUI载体未被PowerShell等待，在初始化时结束。原始事件未记录model.start，但完整遥测缺失，调用与协调消耗均保留未知。原runId及adaptive/seed=17保留为失败；修正为隐藏载体并等待，仅继续剩余55项，没有重跑或替换失败。该宿主异常不归因于机制效果。', '',
  '该样本完整原始身份审计无法恢复，rawAudit.passed=false。其余运行继续正向事实流、live身份、发送者、单向直连和机制禁用审计；总体审计不完整时，数值上的非劣性通过也不能授权移除。', '')
if (audit?.comparison.runs.some(row => row.hostExceptionAuditIncomplete)) lines.push(
  `另有${audit.comparison.runs.filter(row => row.hostExceptionAuditIncomplete).length}次宿主初始化错误缺少manifest：${audit.comparison.runs.filter(row => row.hostExceptionAuditIncomplete).map(row => `${row.mode}/seed=${row.seed}（${row.stopReason}，已知调用${row.issuedModelCalls ?? '未知'}）`).join('；')}。失败及已知消耗仍保留，完整身份审计不通过，不归因于机制移除。原始stderr日志保留在本轮checks目录。`, '')
if (audit?.bootstrapPassed === false) {
  const integrity = audit.comparisonBootstrap.integrity
  const changed = Object.keys(integrity.before).filter(name => integrity.before[name] !== integrity.after[name])
  lines.push(`宿主完整性审计也未通过：原桌面profile中${changed.join('、') || '未标识的文件'}的运行前后哈希发生变化，变化来源未确认。before/after哈希及原始observer-completion.json完整保留；载体退出码${audit.comparisonBootstrap.completion.exitCode}，completed=${audit.comparisonBootstrap.completion.completed}。56项尝试已记录不代表宿主完整性通过。汇总命令先保存全部结果，再以非零退出码报告审计失败；未覆盖原profile或改写原审计结果。`, '')
}
lines.push('## 每机制书面建议', '')
if (summary) for (const row of summary.recommendations) lines.push(`### ${row.mechanism}：${row.conclusion}，默认${row.defaultAction}`, '',
  `${row.reason} 轴A：交互节省${metric(row.costSavings.interactions)}，相对下降${percent(row.costSavings.interactions.relativeReduction)}，实质成本判据${row.substantiveCostReduction ? '通过' : '不确定／未通过'}。轴B：Δ=${pp(row.riskDifference.estimate)}，95%区间${ci(row.riskDifference.interval)}，不一致对${row.riskDifference.discordantPairs}/${row.riskDifference.n}，非劣性${row.nonInferiorityPassed ? '通过' : '不确定'}。minimal非劣性${row.jointNonInferiorityPassed ? '通过' : '不确定'}，minimal成本${row.jointSubstantiveCostReduction ? '通过' : '不确定／未通过'}。`, '',
  `${row.scope} 未检验理由：${row.untestedRationale}`, '')
else lines.push('- 白板：保留。事实多、广播频繁时减少同伴唤醒的理由未被当前任务激活或检验。',
  '- 请求者评价：保留但待定；在本任务族未观察到收益，是后续简化首要候选。长期学习及复杂／模糊结果的价值未检验。',
  '- 同时移除：不确定，默认保留；补偿性交互未检验。', '')
lines.push('默认保留；移除建议必须同时满足完整证据、单项和minimal的实质成本下降及损害边界，不放宽δ。结论只适用于当前任务族，最终决定交维护者，本轮不自动删除机制。', '',
  '## 既有证据和未检验理由', '', `${link('历史五臂比较', values.historical)}的n=5描述不并入本轮登记样本：`, '',
  '| 臂 | 两阶段完成 | 完成调用均值 | 完成交互均值 | 全部交互均值（含失败） |', '|---|---:|---:|---:|---:|',
  ...['adaptive', 'no-feedback', 'no-board'].map(mode => { const rows = historical.comparison.runs.filter(row => row.mode === mode)
    const successes = rows.filter(row => row.phase1Correct && row.phase2Correct && row.factFlowAudit.passed)
    const a = shiftingConsumption(successes), b = shiftingConsumption(rows)
    return `| ${mode} | ${successes.length}/${rows.length} | ${a.modelCalls.mean?.toFixed(2) ?? '未知'} | ${a.interactions.mean?.toFixed(2) ?? '未知'} | ${b.interactions.mean?.toFixed(2) ?? '未知'} |` }), '',
  '历史白板移除的完成交互26.00对42.33，约下降38.58%，只作成本信号。历史评价记录18次rejected，说明机制已激活，n=5仍不足定论。当前任务事实少、邮件足够，白板面向事实多与频繁广播的理由未被检验。minimal只检查联合移除，未对正式阶乘交互检验另作80%功效保证。三个配对区间均为名义95%，不主张族整体95%覆盖。', '',
  '## 验收与冻结证据', '', `${link('验收输出摘要', values.checks)}保留每条命令日志；登记中${Object.keys(design.freezeChecks).length}个基线哈希核对通过，${Object.keys(design.sourceHashes).length}个源码哈希与快照留存。原有入口宿主所有权、网络原子持久化、真实身份、人类授权、单向边和同能力语义未改。`, '',
  '| 命令 | 实际状态 | 摘要 |', '|---|---|---|',
  ...['npm test', 'npm run typecheck', 'npm run build', 'npm run pack:tarball', 'npm run smoke:profile'].map(command => { const row = checks?.commands?.find(row => row.command === command)
    return `| ${command} | ${row ? row.exitCode === 0 ? '通过' : '失败' : '未完成'} | ${row?.summary ?? '未记录'} |` }), '',
  ...(audit ? (() => {
    const runs = audit.comparison.runs
    const verified = runs.filter(run => run.rawAudit?.passed)
    const missing = runs.filter(run => run.hostInitializationFailure || run.hostExceptionAuditIncomplete)
    const otherFailures = runs.filter(run => !run.rawAudit?.passed && !run.hostInitializationFailure && !run.hostExceptionAuditIncomplete)
    const facts = verified.reduce((sum, run) => sum + (run.factFlowAudit?.auditedFacts ?? 0), 0)
    return [`原始审计：${verified.length}/${runs.length}次完整通过，核对${facts}条已提交事实；${missing.length}次宿主初始化异常缺少完整证据，另有${otherFailures.length}次其他审计未通过。总体auditPassed=${audit.auditPassed}，readyForDecision=${summary.readyForDecision}。未提交的运行保留为失败，不虚构事实流证据。`, '',
      `跨运行模型路由、工具schema及权限一致性：${Object.entries(audit.crossRunChecks).map(([key, passed]) => `${key}=${passed}`).join('；')}。原桌面profile完整性：${!audit.comparisonBootstrap ? '未验证' : audit.comparisonBootstrap.integrity.unchanged ? '最终哈希未改' : '失败（运行前后哈希改变）'}；载体验收完成：${!audit.comparisonBootstrap ? '未验证' : audit.comparisonBootstrap.completion.completed ? '通过' : `失败（退出码${audit.comparisonBootstrap.completion.exitCode}）`}。`, '',
      '本轮请求者评价实际记录（仅有完整原始审计的样本；缺失样本不记为零）：', '',
      '| 臂 | 完整审计数 | accepted | rejected | needs-more |', '|---|---:|---:|---:|---:|',
      ...design.modes.map(mode => {
        const rows = verified.filter(run => run.mode === mode)
        const ratings = status => rows.reduce((sum, run) => sum + (run.rawAudit.durableRequesterRatings?.[status] ?? 0), 0)
        return `| ${mode} | ${rows.length} | ${ratings('accepted')} | ${ratings('rejected')} | ${ratings('needs-more')} |`
      }), '']
  })() : []),
  '## 重跑与实际未完成项', '', '```powershell',
  'npm run experiment:simplification-power -- --n 14 --delta 0.25',
  'npm run experiment:simplification-reference -- --n 14 --out experiments/results/simplification-reference-rerun.json', '```', '',
  '离线重跑不调用模型。准备时必须显式输入维护者--delta、--n、--rationale及--evidence；可检出性、两条判据测试和每臂参考通过后才生成登记。预算受限优先减臂，未测minimal时默认保留。不得重新启动本批次替换失败。', '',
  !audit ? '未完成：尚未输入本轮完整真实数据及原始审计，不能写真实研究通过。'
    : summary.observedRuns < summary.plannedRuns ? `未完成：尚缺${summary.plannedRuns - summary.observedRuns}项登记样本。`
      : !audit.auditPassed ? '无法恢复／未通过：初始化异常样本的完整原始审计缺失，首次中断还缺少成本遥测；宿主完整性状态见上文。总体非劣性与移除证据不完整，保持不确定并保留机制。异常没有删除或补跑。'
        : '登记样本和审计已完成；区间过宽或成本未达判据的项目仍写不确定，不能写移除验证通过。', '',
  '本轮不阻塞0.4.0发布。若后续采纳移除建议，走0.5.0并注明依据限于特定任务族上的非劣性判断。', '')
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), lines.join('\n'))
console.log(JSON.stringify({ report: values.out, recordedRuns: summary?.observedRuns ?? null, referencePassed: reference.passed,
  verifiedCommands: checks?.commands?.filter(row => row.exitCode === 0).length ?? 0, causalClaim: false, benefitClaim: 'not-claimed' }))
