/** Human observer copy; agent-authored summaries remain unchanged. */
export const NS = 'atn-network' as const

/** Chinese observer labels. */
export const zh = {
  substrate:'共享 Substrate', substrateEpoch:'步纪元', substrateMessages:'消息', substrateAddress:'地址',
  substrateTask:'已完成子任务', substrateWeight:'消息引用权重（仅观察面）', substrateRefs:'引用 / 被引',
  substrateMetrics:'发布 / 读取', substrateNotBilling:'与邮件分列；不是 Provider token 或账单', substrateEvidence:'交付证据链（非质量分）',
  trigger: 'ATN 网络状态', title: 'ATN 网络', close: '关闭网络视图',
  description: '观察智能体的当前行为，以及它们自主建立的协作连接。',
  loading: '正在读取网络…', empty: '当前会话尚未加入 ATN 网络',
  emptyHelp: '开始任务后，智能体会按需创建 ATN 网络；这里将显示真实节点与连接。',
  error: '网络读取失败', disconnected: '连接中断 · 保留最后一次观测', retry: '重试',
  live: '实时观测', updated: '更新于', readOnly: '只读视图',
  nodes: '节点', connections: '协作连接', running: '正在运行', tasks: '待处理任务',
  goal: '共享目标', revision: '版本', steps: '已用步数', totalSteps: '全网累计步数', nodeBudget: '每节点步数上限', deadline: '截止时间',
  networkOpen: '进行中', networkCompleted: '已完成', networkStopped: '已停止',
  collaboration: '协作邻接', birth: '创建关系',
  remaining: '剩余步数', peerQuota: '剩余连接额度', fulfilment: '历史任务提交 / 结算',
  fulfilmentHelp: '只统计当前快照窗口中的历史任务，已提交不代表验收通过。', noSamples: '暂无样本',
  orphans: '遗留任务候选', orphanHelp: '失败或退出节点的失败 / 不可达尝试；是否可认领须由 atn_status 确认。',
  details: '节点详情', selectNode: '选择节点查看行为与邻居', entry: '入口', current: '当前会话',
  session: '会话', state: '状态', tool: '正在调用', noTool: '暂无正在调用的工具',
  peers: '选定的邻居', noPeers: '尚无协作邻居', incoming: '将此节点选为邻居', noIncoming: '暂无入向协作连接',
  createdBy: '创建者', entryOrigin: '用户会话', pendingVotes: '待审议提案',
  nodeTasks: '相关任务', noTasks: '暂无相关任务', result: '结果', requester: '请求方', holder: '执行方',
  taskWindow: '任务详情仅展示最近 200 条记录',
  activity: '最近活动', noActivity: '暂无已记录活动', bounded: '展示最近记录，最新在上',
  noNetworkActivity: '运行状态来自宿主；活动来自已记录的任务、通信与拓扑变化。',
  lifecycleActive: '活跃', lifecycleProvisioning: '创建中', lifecycleDraining: '退出中',
  lifecycleRetired: '已退出', lifecycleFailed: '失败', idle: '空闲', unloaded: '未加载',
  taskOpen: '处理中', taskCompleted: '已提交', taskFailed: '失败', taskUnreachable: '不可达',
  showAll: '全部节点', unknown: '其他',
}

/** Locale dictionary key. */
export type AtnKey = keyof typeof zh

/** English observer labels. */
export const en: Record<AtnKey, string> = {
  substrate:'Shared substrate', substrateEpoch:'Step epoch', substrateMessages:'Messages', substrateAddress:'Address',
  substrateTask:'Completed sub-task', substrateWeight:'Message citation weight (operator only)', substrateRefs:'Refs / citers',
  substrateMetrics:'Publishes / reads', substrateNotBilling:'Separate from mail; not provider tokens or billing', substrateEvidence:'Delivery evidence chain (not a quality score)',
  trigger: 'ATN network status', title: 'ATN network', close: 'Close network view',
  description: 'Observe agents, their current work, and the collaboration links they choose.',
  loading: 'Loading network…', empty: 'This session has not joined an ATN network',
  emptyHelp: 'Start a task. Its real nodes and connections will appear after an agent creates the ATN network.',
  error: 'Unable to read network', disconnected: 'Disconnected · showing the last observation', retry: 'Retry',
  live: 'Live observation', updated: 'Updated', readOnly: 'Read only',
  nodes: 'Nodes', connections: 'Collaboration links', running: 'Running', tasks: 'Open tasks',
  goal: 'Shared objective', revision: 'Revision', steps: 'Steps used', totalSteps: 'Total network steps', nodeBudget: 'Step limit per node', deadline: 'Deadline',
  networkOpen: 'In progress', networkCompleted: 'Completed', networkStopped: 'Stopped',
  collaboration: 'Collaboration', birth: 'Birth relationship',
  remaining: 'Steps remaining', peerQuota: 'Connections remaining', fulfilment: 'Historical submitted / settled',
  fulfilmentHelp: 'Historical tasks within the current snapshot window only. Submitted does not mean independently accepted.', noSamples: 'No samples',
  orphans: 'Abandoned task candidates', orphanHelp: 'Failed / unreachable attempts held by failed or retired nodes; confirm claim eligibility with atn_status.',
  details: 'Node details', selectNode: 'Select a node to inspect its work and neighbors', entry: 'Entry', current: 'Current session',
  session: 'Session', state: 'State', tool: 'Current tool', noTool: 'No tool currently running',
  peers: 'Selected neighbors', noPeers: 'No collaboration neighbors yet', incoming: 'Selected by', noIncoming: 'No incoming collaboration links',
  createdBy: 'Created by', entryOrigin: 'User session', pendingVotes: 'Pending reviews',
  nodeTasks: 'Related tasks', noTasks: 'No related tasks', result: 'Result', requester: 'Requested by', holder: 'Assigned to',
  taskWindow: 'Task details show the latest 200 records',
  activity: 'Recent activity', noActivity: 'No recorded activity yet', bounded: 'Recent records, newest first',
  noNetworkActivity: 'Runtime states come from the host; activity comes from recorded tasks, messages, and topology changes.',
  lifecycleActive: 'Active', lifecycleProvisioning: 'Creating', lifecycleDraining: 'Draining',
  lifecycleRetired: 'Retired', lifecycleFailed: 'Failed', idle: 'Idle', unloaded: 'Unloaded',
  taskOpen: 'In progress', taskCompleted: 'Submitted', taskFailed: 'Failed', taskUnreachable: 'Unreachable',
  showAll: 'All nodes', unknown: 'Other',
}
