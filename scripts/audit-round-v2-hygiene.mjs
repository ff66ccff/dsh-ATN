import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const audit = await readFile('docs/DECLARATION_AUDIT.md', 'utf8')
for (const name of ['dsh-brand', 'dsh-attachment', 'dsh-client-store', 'dsh-credentials', 'dsh-launch-environment', 'dsh-settings', 'dsh-timeout']) {
 assert.match(audit, new RegExp(`\\| ${name} \\| 保留 \\|`), `missing justified disposition: ${name}`)
}
assert.match(audit, /B-HOST-EXPORT.*atn-observation.*atnObserver\/snapshot.*atnObserver\/metadata/s)
assert.match(await readFile('docs/STRATEGY_AND_POSITIONING.md', 'utf8'), /保管／任务可见性／精确引用准入/)
console.log('HYGIENE: seven justified retentions, host export and independent read actions recorded')
