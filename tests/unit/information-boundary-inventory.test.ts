/** Fail closed on API/tool drift: new channels cannot inherit an accidental exemption. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { INFORMATION_BOUNDARY_REFUSAL_CODES } from '../../src/refusal.ts'
import { networkRecordSchema } from '../../src/schema.ts'
import { makeChain } from '../fixtures/network.ts'

// Readable audit classes, independent of implementation discovery.
const outbound = ['start', 'spawn', 'send', 'feedback', 'claim', 'rewire', 'finish', 'deliver', 'propose', 'vote', 'renew']
const reads = ['networkForSession', 'now', 'callerContext', 'resolveNode', 'peers', 'tasks',
  'deliveryHolder', 'network', 'networkIds', 'findBySessionId', 'ownsHandle', 'handleFor', 'pendingMail']
const trusted = ['installSendPolicy', 'installOutboundPolicy', 'refreshCustody', 'openStore', 'admitStep',
  'deliverMail', 'verifyTask', 'provisionRecoveryTask', 'stop', 'failNode', 'tick', 'recover', 'shutdown']
const compound = ['status']

function auditPublicMethods(text: string) {
  const file = ts.createSourceFile('runtime.ts', text, ts.ScriptTarget.Latest, true)
  const runtime = file.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'AtnRuntime') as ts.ClassDeclaration
  const methods = runtime.members.filter(ts.isMethodDeclaration).filter(member =>
    !member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword))
    .map(member => member.name.getText(file)).sort()
  assert.deepEqual(methods, [...outbound, ...reads, ...trusted, ...compound].sort(), 'classify and test every new public runtime API')
}

function auditTools(text: string) {
  const advertised = [...text.matchAll(/name:\s*'(atn_[a-z]+)'/g)].map(row => row[1]).sort()
  assert.deepEqual(advertised, ['atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status'], 'register every new tool in the boundary inventory')
  const file = ts.createSourceFile('tools.ts', text, ts.ScriptTarget.Latest, true)
  const fields: Record<string, string[]> = {}
  const property = (object: ts.ObjectLiteralExpression, key: string) => object.properties.find(item =>
    ts.isPropertyAssignment(item) && item.name.getText(file) === key) as ts.PropertyAssignment | undefined
  const inspect = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'defineTool' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const object = node.arguments[0]
      const name = property(object, 'name')?.initializer
      const parameters = property(object, 'parameters')?.initializer
      if (name && ts.isStringLiteral(name) && name.text.startsWith('atn_') && parameters && ts.isObjectLiteralExpression(parameters)) {
        fields[name.text] = parameters.properties.map(item => item.name!.getText(file)).sort()
        for (const key of ['review', 'rewire']) {
          const nested = property(parameters, key)?.initializer
          const props = nested && ts.isObjectLiteralExpression(nested) ? property(nested, 'properties')?.initializer : undefined
          if (props && ts.isObjectLiteralExpression(props)) fields[`${name.text}.${key}`] = props.properties.map(item => item.name!.getText(file)).sort()
        }
        for (const key of ['kind', 'scope']) {
          const nested = property(parameters, key)?.initializer
          const values = nested && ts.isObjectLiteralExpression(nested) ? property(nested, 'enum')?.initializer : undefined
          if (values && ts.isArrayLiteralExpression(values)) fields[`${name.text}.${key}`] = values.elements.map(item => (item as ts.StringLiteral).text).sort()
        }
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(file)
  assert.deepEqual(fields, {
    atn_start: ['constraints', 'objective', 'successCriteria'],
    atn_spawn: ['context', 'dependsOn', 'leaseMs', 'retryOf', 'task'],
    atn_send: ['body', 'dependsOn', 'evidence', 'kind', 'messageId', 'outcome', 'retryOf', 'summary', 'taskId', 'to'],
    'atn_send.kind': ['note', 'result', 'task'],
    atn_status: ['claimTaskId', 'query', 'review', 'rewire', 'taskIds'],
    'atn_status.review': ['comparisonKey', 'evidence', 'status', 'summary', 'taskId'],
    'atn_status.rewire': ['peers'],
    atn_finish: ['evidence', 'goalVersion', 'reason', 'scope', 'summary'],
    'atn_finish.scope': ['network', 'node'],
  }, 'audit every input field, nested mutation and new transport kind')
}

test('BOUNDARY-INVENTORY: every public runtime path and every model tool has an explicit classification', async () => {
  const runtime = await readFile(new URL('../../src/runtime.ts', import.meta.url), 'utf8')
  const tools = await readFile(new URL('../../src/tools.ts', import.meta.url), 'utf8')
  auditPublicMethods(runtime)
  auditTools(tools)
  assert.throws(() => auditPublicMethods(runtime.replace('static inject =', 'async leak() {}\n  static inject =')), /classify and test/,
    'a new unregistered outbound API must fail the audit')
  assert.throws(() => auditTools(tools + "\nconst leak = { name: 'atn_leak' }"), /register every new tool/)
  assert.throws(() => auditTools(tools.replace('messageId: {', "leak: { type: 'string' }, messageId: {")), /audit every input field/)
})

test('BOUNDARY-CONTRACT: refusal vocabulary stays public and unchanged', () => {
  assert.deepEqual([...INFORMATION_BOUNDARY_REFUSAL_CODES], [
    'evidence-not-owned', 'not-task-holder', 'metadata-only',
    'fact-requests-and-owner-results-only', 'extra-transport-fields',
    'invalid-fact-request', 'fixed-edge-required', 'invalid-setup-receipt', 'invalid-owner-result',
    'async-policy',
  ])
})

test('BOUNDARY-UPGRADE: loading old durable records discards board bodies and leaves other state intact', () => {
  const record = makeChain(['A', 'B'])
  const legacy = { ...record, whiteboard: { entries: [{ body: 'FOREIGN_SECRET', authorId: 'B' }] } }
  const upgraded = networkRecordSchema.parse(legacy)
  assert.deepEqual(upgraded, record)
  assert.equal(JSON.stringify(upgraded).includes('FOREIGN_SECRET'), false)
  assert.throws(() => networkRecordSchema.parse({ ...record, unexpectedChannel: { body: 'SECRET' } }))
})
