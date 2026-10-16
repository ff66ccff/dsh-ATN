/** CI-replayable offline entry. Reads committed evidence only, never accounts or providers. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { loadProbeHistory, loadLegacyProbeHistory, QUANTILE_PRINCIPLE } from '../experiments/live-probe-history.ts'
import { analyzeProbeBatch, buildSensitivity, verifyArchivedProbeHashes } from '../experiments/probe-gate-quiescence.ts'

const directory = resolve(process.argv[2] ?? 'docs/execution-evidence/probe-gate-quiescence-20261015')
const current = await loadProbeHistory(), legacy = await loadLegacyProbeHistory()
const sensitivity = buildSensitivity(current), analysis = await analyzeProbeBatch(), hashes = await verifyArchivedProbeHashes()
assert.deepEqual(analysis.quiescenceCounts, { 'quiescence-with-obligations-open': 5, 'quiescence-with-obligations-complete': 0 })
assert.deepEqual(analysis.failureCounts, { 'incorrect-proof': 3, 'submission-discipline': 2 })
assert.deepEqual(analysis.tokenPolicy.exceededInputSeeds, [45, 73])
const selected = sensitivity.find(row => row.quantile === 0.9)!
const taskOriginAudit = analysis.stops.map(stop => {
  const firstStepSequence = Math.min(...[stop.entry, ...stop.otherNodes].flatMap(node => node.steps.map(step => step.eventSequence)))
  const open = stop.tasks.filter(task => task.status === 'open')
  const provisionedOpen = open.filter(task => task.taskSequence < firstStepSequence).length
  assert.equal(provisionedOpen, stop.obligations.openTasks, 'Open task origin needs explicit review')
  return { seed: stop.seed, firstStepSequence, openTasks: open.length, provisionedOpen,
    evidence: open.map(task => ({ task: task.task, sequence: task.taskSequence })) }
})
assert.deepEqual(selected.at600000.insufficient, ['deadline'])
assert.deepEqual(selected.at120000.insufficient, ['deadline'])
assert.ok(selected.atRequiredDeadline.admitted)
const arithmeticFlip = [8144, 8660, 9504, 10282, 11133].map(latencyMs => ({ latencyMs,
  requiredDeadlineMs: 68 * latencyMs + 30000, admitted600000: 600000 >= 68 * latencyMs + 30000 }))
const summary = { execution: 'offline-zero-model', actualModelCalls: 0, accountReads: 0, networkAccess: false,
  headline: 'incorrect-proof: 3 (submitted wrong answers); submission-discipline: 2 (no submission). All 5 quiescent with obligations open.',
  quantilePrinciple: QUANTILE_PRINCIPLE, current, legacy, pooled: false, sensitivity, arithmeticFlip, analysis, taskOriginAudit, hashes,
  conclusion: '若门在上批运行前使用本批可得的上偏延迟统计量，该配置会被拒绝。原准入偏松体现方向一致的选择偏差（幸存调用均值与排除取消样本）；本次反事实重算不证明延迟造成静默，也不估计删失的偏差量。' }
await mkdir(directory, { recursive: true })
await writeFile(join(directory, 'recomputation.json'), JSON.stringify(summary, null, 2) + '\n')
const table = (headers: string[], rows: Array<Array<string | number>>) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}`
const verdict = (admitted: boolean) => admitted ? '放行' : '拒绝（仅期限不足）'
let validationText = '验证尚未留档；不宣称工程命令已通过。'
try {
  const validation: { commands: Array<{ command: string; exitCode: number; summary: string }> } = JSON.parse(await readFile('docs/execution-evidence/probe-gate-quiescence-20261015/validation.json', 'utf8'))
  validationText = table(['命令', '退出码', '实际结果'], validation.commands.map(row => [row.command, row.exitCode, row.summary]))
    + '\n\n回归过程保留两个既有不稳定结果：result-outcome.test.ts 子进程异常退出、无断言详情（first-test-process-failure.txt，原因未确定），独立 5 项通过；另一次全量 KNOWLEDGE-02 在前后快照间 mail-10 从 queued 变 delivered（knowledge-mail-race-full-suite.txt），独立文件 8 项通过。完整回归曾通过，最终命令结果按上表及原始日志记录；不据重跑消除对时序不稳定的记录。未删除测试或修改既有断言来绕过失败，src/ 保持不变。'
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const curves = table(['覆盖分位', '延迟 ms', 'requiredDeadlineMs', '600000 ms', '120000 ms', '所需期限边界纯计算对照'],
  sensitivity.map(row => [`p${row.quantile * 100}`, row.latencyMs, row.requiredDeadlineMs, verdict(row.at600000.admitted), verdict(row.at120000.admitted), `${row.atRequiredDeadline.admitted ? '放行' : '拒绝'}；少 1 ms 拒绝`]))
const seedTable = table(['seed', '失败类别', 'open / unresolved / queued', '入口已用/剩余步', '入口终止', '停止分类'], analysis.stops.map(stop => [stop.seed,
  stop.failureClass, `${stop.obligations.openTasks} / ${stop.obligations.unresolvedTasks} / ${stop.obligations.queuedMail}`, `${stop.entry.stepsUsed}/${stop.entry.remainingSteps}`,
  `${stop.entry.lifecycle}; ${stop.entry.lastTurnReason}`, stop.classification]))
const entries = table(['seed', '只读发现', '协议（含 review/checkpoint）', '换边', '其余（本地读取/无工具）', '步数合计', 'atn_status 工具调用'], analysis.stops.map(stop => [stop.seed,
  stop.entry.categories.discovery, stop.entry.categories.protocol, stop.entry.categories.rewire, stop.entry.categories.other, stop.entry.stepsUsed, stop.entry.toolCounts.atn_status]))
const tokenTable = table(['seed', '已知 input', '已知 output', '已知 cacheRead', 'total 未知调用', 'input >400000'], analysis.stops.map(stop => [stop.seed,
  stop.tokens.inputKnown, stop.tokens.outputKnown, stop.tokens.cacheReadKnown, stop.tokens.totalUnknownCalls, stop.tokens.inputExceedsHistoricalThreshold ? '是' : '否']))
const flipTable = table(['延迟输入 ms', '68L +30000 ms', '600000 ms'], arithmeticFlip.map(row => [row.latencyMs, row.requiredDeadlineMs, row.admitted600000 ? '放行' : '拒绝']))
const comparison = table(['来源', '样本/dispatch', '删失', 'p50', 'p75', 'p90', 'p95'], [
  ['本批', `${current.sampleCount}/${current.dispatchCount}`, current.censoring, ...current.quantiles.map(row => row.ms)],
  ['上批（单列，未合池）', `${legacy.sampleCount}/${legacy.dispatchCount}`, legacy.censoring, ...legacy.quantiles.map(row => row.ms)],
])
const perSeed = table(['seed', 'dispatch→finish 均值 ms', '仅成功均值 ms'], current.perSeed.map(row => [row.seed, row.meanMs.toFixed(3), row.successfulMeanMs.toFixed(3)]))
const detailed = analysis.stops.map(stop => {
  const mapping = table(['匿名工具', '真实工具', '互证依据'], stop.toolMapping.map(row => {
    const first = row.evidence[0] as { eventSequence: number; sourceSeq: number }
    return [row.tool, row.name, `逐次 session tool/call 与 event ${first.eventSequence} 对应（source seq ${first.sourceSeq}）；${row.evidence.length} 次命名证据，详见 tool-identities.json 及 recomputation.json`]
  }))
  const holders = table(['任务', 'holder', 'requester', 'status', '创建步数', '停止 lifecycle', '已用/剩余', '持有者判定', '证据 task/node/turn seq'], stop.tasks.map(task => [task.task,
    task.holder, task.requester, task.status, task.holderStepsAtCreation, task.holderState.lifecycle,
    `${task.holderState.stepsUsed}/${task.holderState.remainingSteps}`, task.holderReachability === 'holder-alive' ? '持有者存活（未运行）' : '持有者不可达',
    `${task.taskSequence}/${task.holderState.nodeSequence}/${task.holderState.turnSequence}`]))
  const steps = table(['turn:step', '类别', '工具（类别）', 'step/start sequence'], stop.entry.steps.map(step => [`${step.turn}:${step.step}`, step.category,
    step.tools.map(tool => `${tool.name}(${tool.category})`).join(', ') || '无工具', step.eventSequence]))
  const peers = table(['节点/session', '已用步', '只读发现', '协议', '换边', '其余', '只读 status 次数', '发现步占比', '最后 turn 原因'], stop.otherNodes.map(node => [`${node.node}/${node.session}`,
    node.stepsUsed, node.categories.discovery, node.categories.protocol, node.categories.rewire, node.categories.other, node.readOnlyStatusCalls, `${(100 * node.categories.discovery / node.stepsUsed).toFixed(1)}%`, node.lastTurnReason]))
  return `## seed ${stop.seed}\n\n${mapping}\n\n未完成任务（含已不可达但未完成者）：\n\n${holders}\n\n入口逐步：\n\n${steps}\n\n其它节点：\n\n${peers}\n`
}).join('\n')
await writeFile(join(directory, 'analysis-tables.md'), `# 逐 seed 工具映射、持有者与步数证据\n\n此文件由 scripts/recompute-probe-gate.ts 生成，零模型调用。节点和任务使用 telemetry 匿名别名；protocol.stepUse 原始节点 ID 另有命名空间，不能按数字直接相连。所有 seq 是各 seed events.jsonl 的 sequence。\n\n${detailed}`)
const report = `# 探针门分位修正与静默定位实施报告（2026-10-15）

**3 个 incorrect-proof（提交了错误答案）+ 2 个 submission-discipline（未提交）；5 个 seed 全部是义务仍未完成的活性静默。** 本轮模型调用 **0**，不读账号、不联网、不加载 provider、不重跑真实探针。

**若门在上批运行前使用本批可得的上偏延迟统计量，该配置会被拒绝。** p90 为 **${current.latency.ms} ms**，期限要求 **${selected.requiredDeadlineMs} ms**；600000 ms 和 120000 ms 均只因期限不足拒绝。步数 **12 ≥9**、调用 **96 ≥68** 仍充足，这是规划判断而非完成保证。没有据此放宽任何运行预算。

## 无删失样本与独立分位原则

延迟从 [本批 provider-calls.jsonl](execution-evidence/live-probe-resumed-20261015/provider-calls.jsonl) 逐 call 配对 dispatch.at→finish.at；文件 SHA-256：\`${current.fileSha256}\`。224 次 dispatch、224 个配对 finish、metrics attempts 合计 224、aborted 合计 0，无未配对或排除样本，删失状态 **uncensored**。finish 包含 221 stop、2 max-tokens、1 error，**无删失不等于全部成功**。每个来源报告的哈希和逐 seed 计数见 [重算 JSON](execution-evidence/probe-gate-quiescence-20261015/recomputation.json)。

原则（事先固定的服务覆盖政策，不按某配置的放行结果选分位）：**${QUANTILE_PRINCIPLE}** 分位算法为 nearest rank，即升序第 ceil(q×n) 个观测。p90 覆盖观测的单次服务时间分布；不是 68 次总运行的 90% 成功概率，也不是未来延迟上界。30 秒宿主预留与满并发利用假设继续明示。

上一批 SHA-256：\`${legacy.fileSha256}\`，76 次中仅 71 个成功存活样本，5 个取消样本右删失；本批与上批**未合池**。

${comparison}

## 敏感性曲线与双向准入

固定公式 ceil(68L/1 +30000)，固定 12/96；表中每个放行都只覆盖该行标出的观测服务时间分位。所需期限边界是**纯计算正向对照，不是建议真实重跑条件**。

${curves}

p50 会放行 600 秒，p75/p90/p95 会拒绝；并非把门改成一律拒绝。所有档位在自身期限边界放行，少 1 ms 时拒绝，沿用必要下界 10/最大单节点 ≥2 的条件性、无条件 ≥1，以及参考 60/8 与 12.5% 规划余量的区别。

## 原准入为什么偏松

brief 第 2.1 节四个展示值（按其整数口径）代回原门：

${flipTable}

原门以排除取消样本的**幸存调用均值** 8144 ms 放行，仅余 16208 ms；四个展示的实测值方向一致地翻转该判断。其偏松是**方向一致的选择偏差（幸存调用均值 + 排除取消样本）**的风险，不应当作无方向的随机误差忽略。均值本身也不表达尾部覆盖；分位政策解决覆盖含义，无法反推已取消调用的完整时长。本次跨批比较不能量化删失偏差，亦不能排除负载变化。

完整逐 seed dispatch→finish 均值如下，避免继续遗漏 seed 73：

${perSeed}

**纠正 brief 的范围**：四个展示值均拒绝成立；“五个实测值全部高于 8144”不成立，seed 73 的均值略低于 8144。provider finish 时间与 timing service settlement 边界的毫秒差异保留，不改写历史值。

## 静默与义务分开记录

${seedTable}

每条新停止记录同时包含原 stopReason、activity、obligations、checkpoint 的 submitted/passed 状态、checkpoint 时快照以及停止时任务状态。活性原因是 unchanged runner 在 tick 后复查无 running 持续 ≥200 ms；逐 turn/end 流佐证最后无运行，**没有把该流伪称为独立采集的 tick 日志**。原 quiescence 字符串不表示协议完成。分类计数：quiescence-with-obligations-open **5**，quiescence-with-obligations-complete **0**。确定性负向对照构造 open/unresolved/mail 均 0、两 checkpoint 已完成，分类为 complete；四种单独未完成条件仍归 open。

**停止时 open 数分别为 7/8/5/7/6**；brief 的 6–8 来自 checkpoint 时刻，不能替代最终停止快照。另记录 unreachable 等未完成任务，避免把持有者退休后的任务漏掉。任务表逐行给 holder、requester、status、holderStepsAtCreation、停止时 active/retired/failed、stepsUsed、剩余步和证据 seq，见 [完整表](execution-evidence/probe-gate-quiescence-20261015/analysis-tables.md)。所有 holder 可判定，无未知状态，无需补采集或改 src/。

进一步定位：五 seed 合计 **33 个 open 任务的最后 task.state 全部早于首个 step/start**，且 holderStepsAtCreation=0；它们来自预置 start/spawn 的初始角色分配，不是 33 个尚未返回的新增事实请求。重算 JSON taskOriginAudit 逐条留存 sequence，冻结 provisionShifting 源码给出预置任务的创建依据。新发出的事实请求另有 completed 任务与 result mail。因而“open 多、邮件空”包含了长期角色义务未收口；它不能单独证明证据请求的持有者失联或都在等待资源。真正未完成的两阶段 proof 仍由 checkpoint 状态独立判定。

多数未完成任务持有者仍 active、已发布且不 running；三个退休入口留下不可达任务。seed 31 入口仍 active、11/12 步，turn/end=max-tokens；seed 59 入口仍 active、9/12 步，turn/end=error，保留 UPSTREAM 失败。只有 17/45/73 入口退休并用满 12 步。因而“全部入口步数耗尽导致静默”不成立。现有证据定位到任务未完成但没有下一次推进的协议停滞，并保留输出截断/上游失败两种停止机制；观察共现不证明预算、发现查询与静默之间的单一因果关系。

## 工具映射与发现假设检验

每个 seed 的别名独立验证：tool-1=read_evidence、tool-2=atn_status、tool-3=atn_send；有 checkpoint 的 seed 中 tool-4=submit_checkpoint。工具 1/4 是实验工具，工具 2/3 是 ATN 工具；没有把所有工具都误称为 ATN 原生工具。

依据为**既有持久化 session.v4.jsonl 的具名 tool/call**：先按首个 turn/start 的精确 time/turn 唯一连接 session 别名，再按 session/time/turn/step 唯一连接 tool.start。全部 170 个工具调用逐次吻合，无猜测。已归档 [脱敏身份投影](execution-evidence/probe-gate-quiescence-20261015/tool-identities.json)，含 40 个来源 session 文件 SHA-256、原 seq、工具名、参数键名和事件 seq；无参数值、提示词或回答正文。复提取脚本 scripts/extract-probe-tool-evidence.ts 仅读已有 sessions。CI 使用归档投影，无需被忽略的 .artifacts 目录。

独立互证：status 的 review/rewire 区间内有 task.requester-feedback/topology.rewire；send 区间内有 task.state 与 queued mail。read_evidence 与 submit_checkpoint 使用具名 session 调用及冻结 runner 中各自 schema/执行入口核对。每条映射及每次调用来源见完整表/JSON。别名与原节点 ID 不直接混用。

${entries}

逐步表保留批量工具；独占步数归类优先级 protocol > rewire > discovery > other，避免一模型步有多个工具时重复计费。review/checkpoint 算协议，本地 read_evidence 和无工具步算其余。seed 45/59 的 rewire 与协议工具同一步，因此独占换边步为 0，但逐工具列表明确保留换边，不能读成没有换边调用。

**第 2.3 节假设：不成立。** tool-2 确为 atn_status，但不全是只读发现。seed 17 的 7 次 status = 4 次只读查询 +2 次 review +1 次 rewire；入口发现只占 4/12（33.3%）。其只读查询数高于每个其它节点的 1–2 次，但发现步占比并非一致更高（node-6 为 2/4=50%）；完整表给逐节点和步数归一化对照。不能据此称发现抖动显著主导预算或证明其造成静默。

## Token 阈值选择 (b)：从有效预算维度去列

本轮实际落地 **b-remove-from-effective-budget**：门和 driver 输出显式列出 nodeSteps/callCap/deadline 三个有效预算维度，totalTokens 标记 unavailable/active=false。4096 每请求输出上限单列，不是整批 token/费用上限。历史 400000 字段留在冻结 runner 和归档条件内用于复核，但**不计为有效预算约束**；没有改写历史判定或归档源码。由于 totalTokens 在 224 次调用中全部未知，该阈值始终没有保护作用。选择 (b) 保留 37 个哈希并避免把不含推理 token 的部分观测误称精确总量。

${tokenTable}

seed 45/73 **已知输入单独超过 400000**；若按已知用量提供有效的准入阈值，两次运行会在后续准入处被截断。现有阈值未阻止此事，故不能声称这两次匹配 400000 token 预算。stepBudget 仍只限制单节点步数，既不是 token、HTTP 请求也不是费用上限。

## 工程验证与边界

37 个固定源码哈希逐个重新计算，与前后两批 plan 及五个 seed report/manifest 均一致；原 sourceHashes 未重写。完整清单见重算 JSON hashes。src/ 未修改、工具 schema 未修改、观察通道仍只读，参考运行语义未变。本轮仅改变新增规划门的延迟输入/覆盖输出并增加离线分析；旧 driver 的当前 600 秒配置现在被 p90 门拒绝，不会派发。

新增 7 个测试覆盖配对防删失、样本独立、敏感性双向对照、义务完成负向对照、持有者、具名映射、离线依赖边界；既有测试未删改、未降低断言。测试与命令最终结果见 [验证清单](execution-evidence/probe-gate-quiescence-20261015/validation.json)，没有把未执行项算作通过。

${validationText}

复算：\`node --import tsx/esm scripts/recompute-probe-gate.ts\`；独立新输出目录可作为位置参数传入。脚本只读仓库证据和固定源码，生成 JSON 与表，零账号、零网络、零 provider。额外命令 npm test、npm run typecheck、npm run build、npm run pack:tarball 的输出均留在本轮证据目录。README 与 docs/README 同步链接本报告。

本轮未进入 NEXT_SCOPE_DECISION_RECORD 四项新范围，也未提高预算或运行真实模型；未提交、推送或发布。
`
await writeFile(resolve('docs/PROBE_GATE_AND_QUIESCENCE_IMPLEMENTATION_REPORT.md'), report)
console.log(JSON.stringify({ execution: summary.execution, actualModelCalls: 0, sampleCount: current.sampleCount, latencyP90Ms: current.latency.ms,
  requiredDeadlineMs: selected.requiredDeadlineMs, admitted600000: selected.at600000.admitted, admitted120000: selected.at120000.admitted,
  failureCounts: analysis.failureCounts, quiescenceCounts: analysis.quiescenceCounts, verifiedSourceHashes: hashes.count, directory }, null, 2))
