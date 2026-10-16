import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CASES, runCustodyConformance } from './index.mjs'
if (process.argv[2] === '--list') console.log(JSON.stringify(CASES, null, 2))
else {
 if (!process.argv[2]) throw new Error('Usage: node node_modules/dsh-atn/conformance/cli.mjs <host-adapter.mjs> (or --list)')
 const module = await import(pathToFileURL(resolve(process.argv[2])).href)
 const result = await runCustodyConformance(await module.default())
 console.log(JSON.stringify(result, null, 2))
 if (result.failed) process.exitCode = 1
}
