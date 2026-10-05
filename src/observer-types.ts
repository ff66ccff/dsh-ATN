/** Read-only, operator-facing ATN observations. These never enter model tools. */
export interface AtnObserverSnapshot {
  observedAt: number
  network: AtnNetworkView | null
}

export interface AtnNetworkView {
  id: string
  status: 'open' | 'completed' | 'stopped'
  entryNodeId: string
  goalVersion: number
  objective: string
  stepsUsed: number
  stepBudget: number
  deadlineAt: number
  nodes: AtnNodeView[]
  edges: AtnEdgeView[]
  tasks: AtnTaskView[]
  events: AtnEventView[]
}

export interface AtnNodeView {
  id: string
  sessionId: string
  isEntry: boolean
  creatorId: string | null
  lifecycle: string
  agentStatus: 'running' | 'idle' | 'unloaded'
  peers: string[]
  openTasks: number
  pendingVotes: number
  stepsUsed: number
  currentTool: string | null
}

export interface AtnEdgeView {
  source: string
  target: string
  kind: 'collaboration' | 'birth'
}

export interface AtnTaskView {
  id: string
  holderId: string
  requesterId: string
  description: string
  status: 'open' | 'completed' | 'failed' | 'unreachable'
  summary: string | null
  createdAt: number
  settledAt: number | null
}

export interface AtnEventView {
  id: string
  kind: string
  at: number
  nodeId: string
  targetId: string | null
  taskId: string | null
  summary: string
}
