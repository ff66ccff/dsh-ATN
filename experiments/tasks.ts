/** Small, architecture-neutral pilot inputs. Expected answers live only in evaluation.ts. */
export const PILOT_TASK_IDS = ['ledger-reconciliation', 'release-candidate', 'boundary-diagnosis'] as const
export type PilotTaskId = typeof PILOT_TASK_IDS[number]

export interface PilotDocument {
  readonly id: string
  readonly text: string
}

/** Copy only this public value into a model-visible run workspace. */
export interface PilotTask {
  readonly id: PilotTaskId
  readonly title: string
  readonly revision: 1
  readonly instruction: string
  readonly documents: readonly PilotDocument[]
  readonly answerFormat: string
}

const TASKS: Record<PilotTaskId, PilotTask> = {
  'ledger-reconciliation': {
    id: 'ledger-reconciliation', title: 'Reconcile a payment ledger across corrections and events', revision: 1,
    instruction: 'Compute the final net captured amount for accounts A and B at the cutoff. Apply all supplied rules and corrections. Amounts are integer credits. Report ignored event ids separately from duplicate event ids.',
    documents: [
      { id: 'policy', text: 'Cutoff: 2030-01-01T12:00:00Z, inclusive. Count each event id once. A capture adds its amount; a refund subtracts it; authorization contributes nothing. Ignore events after the cutoff. Use the corrected account for every event of a corrected order. Include zero balances. Evidence must identify the supplied documents used.' },
      { id: 'orders', text: 'order,account\no1,A\no2,B\no3,A\no4,B' },
      { id: 'events', text: 'id,order,type,amount,time\ne1,o1,capture,100,11:00\ne2,o1,refund,30,11:30\ne3,o2,authorization,90,11:40\ne4,o2,capture,90,12:00\ne4,o2,capture,90,12:00\ne5,o3,capture,40,12:01\ne6,o4,capture,50,10:00\ne7,o4,refund,10,12:00\nAll times are UTC on the cutoff date.' },
      { id: 'correction', text: 'Approved correction: order o2 belongs to account A, replacing its account in the order table. No other order is corrected.' },
    ],
    answerFormat: '{"netByAccount":{"A":integer,"B":integer},"excludedEventIds":[string],"deduplicatedEventIds":[string],"evidence":[document-id]}. List each id at most once; list order does not matter. Excluded means ignored for type or time, not the repeated copy of a counted event.',
  },
  'release-candidate': {
    id: 'release-candidate', title: 'Choose a deployment candidate from independent records', revision: 1,
    instruction: 'Determine all eligible hosts and select one for release at the evaluation time. Report one exclusion reason for each ineligible host, using the specified reason labels.',
    documents: [
      { id: 'requirements', text: 'Evaluate at 2030-02-01T15:00:00Z. A host is eligible only if region=eu, version>=3, ramGiB>=16, p95Ms<=80, and approval has validUntil strictly later than evaluation time. Select the eligible host with greatest capacity; break ties by ascending host id. Exclusion reason labels: region, version, memory, latency, approval. These inputs give each excluded host exactly one failing rule.' },
      { id: 'inventory', text: 'host,region,version,ramGiB,capacity\neu-a,eu,3,16,20\neu-b,eu,4,32,50\neu-c,eu,3,16,30\neu-d,eu,4,16,30\nus-e,us,4,32,90' },
      { id: 'probes', text: 'host,p95Ms\neu-a,90\neu-b,60\neu-c,70\neu-d,70\nus-e,40' },
      { id: 'approvals', text: 'host,validUntil\neu-a,16:00\neu-b,15:00\neu-c,16:00\neu-d,16:00\nus-e,16:00\nAll times are UTC on the evaluation date. Each listed host is approved until its validUntil boundary.' },
    ],
    answerFormat: '{"selected":host-id,"eligible":[host-id],"excludedByReason":{host-id:reason-label},"evidence":[document-id]}. List each id at most once; list order does not matter.',
  },
  'boundary-diagnosis': {
    id: 'boundary-diagnosis', title: 'Diagnose code against boundary cases and the contract', revision: 1,
    instruction: 'Review the supplied JavaScript expression against its contract. Identify all supplied cases where actual and required output differ. Report the required output for every case and the two comparison operators that repair the expression without changing its operands.',
    documents: [
      { id: 'contract', text: 'A user is eligible iff not disabled and startsAt <= now < expiresAt. Starts are inclusive; expiry is exclusive. Inputs are finite integer timestamps. Do not change the disabled guard.' },
      { id: 'implementation', text: 'function eligible(user, now) {\n  return !user.disabled && user.expiresAt >= now && now > user.startsAt;\n}\nThe expiry slot is user.expiresAt OP now. The start slot is now OP user.startsAt.' },
      { id: 'cases', text: 'case,startsAt,expiresAt,disabled,now\nbefore-start,10,20,false,9\nat-start,10,20,false,10\ninside,10,20,false,15\nat-expiry,10,20,false,20\ndisabled,10,20,true,15' },
    ],
    answerFormat: '{"failingCaseIds":[case-id],"operators":{"expiry":operator,"start":operator},"expected":{case-id:boolean},"evidence":[document-id]}. Report every case in expected. List each id at most once; list order does not matter.',
  },
}

/** A detached public input; callers cannot mutate future repetitions. */
export function getPilotTask(id: PilotTaskId): PilotTask {
  const task = TASKS[id]
  if (task === undefined) throw new Error(`Unknown pilot task: ${String(id)}`)
  return structuredClone(task)
}

/** Same task content for all architectures; execution policy belongs to the adapter. */
export function renderTaskPrompt(task: PilotTask): string {
  return [
    `Pilot task ${task.id} (revision ${task.revision}): ${task.title}`,
    task.instruction,
    'Use the supplied evidence. You may choose your own solving and collaboration strategy within the available tools and run budget.',
    ...task.documents.map(document => `[document ${document.id}]\n${document.text}`),
    `Return one JSON object as the final answer, with this format:\n${task.answerFormat}`,
    'A statement that work is completed is not an answer. Do not include prose outside the JSON object.',
  ].join('\n\n')
}
