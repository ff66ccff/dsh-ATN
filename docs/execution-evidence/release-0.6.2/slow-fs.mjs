import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
for (const method of ['writeFile', 'appendFile', 'rename']) {
  const original = fs[method]
  fs[method] = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 25))
    return original(...args)
  }
}
syncBuiltinESMExports()
