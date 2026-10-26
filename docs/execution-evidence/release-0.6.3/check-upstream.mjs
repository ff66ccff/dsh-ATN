import { build } from 'esbuild'
import ts from 'typescript'
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const upstream = resolve('upstream/deepseek-harness')
const paths = ts.readConfigFile(resolve(upstream,'tsconfig.base.json'),ts.sys.readFile).config.compilerOptions.paths
const sourcePlugin = { name: 'upstream-source', setup(b) {
 b.onResolve({filter:/^@deepseek-ai\//}, args => {
   let mapped = paths[args.path]?.[0]
   if (!mapped) for(const [key,value] of Object.entries(paths)) { if(key.includes('*') && args.path.startsWith(key.split('*')[0])) { mapped=value[0].replace('*',args.path.slice(key.indexOf('*'))); break } }
   if (!mapped) return { path: args.path, external: true }
   let path=resolve(upstream,mapped)
   if(!existsSync(path) || statSync(path).isDirectory()) path=['.ts','.tsx','/index.ts','/index.tsx'].map(ext=>path+ext).find(existsSync) ?? path
   return {path}
 })
 b.onLoad({filter:/\.tsx?$/}, args => args.path.startsWith(upstream) ? ({loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:dirname(args.path),contents:readFileSync(args.path,'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(args.path).href))}) : undefined)
 b.onLoad({filter:/tests[\\/]fixtures[\\/]kernel\.ts$/}, args => ({ loader:'ts', resolveDir:dirname(args.path), contents:readFileSync(args.path,'utf8').replace("import ToolRuntime from '@deepseek-ai/dsh-tools'", "import ToolRuntime from '@deepseek-ai/dsh-tools'\nimport * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'").replace('await ctx.plugin(ToolRuntime)', 'await ctx.plugin(ToolRuntime)\n    await ctx.plugin(NativeExecutor)') }))
}}
mkdirSync('.scratch/upstream-check',{recursive:true})
const tests=process.argv.slice(2)
for (const entry of tests) {
 const outfile=resolve('.scratch/upstream-check',basename(entry).replace('.ts','.mjs'))
 await build({entryPoints:[entry],outfile,bundle:true,format:'esm',platform:'node',target:'es2022',packages:'external',plugins:[sourcePlugin],sourcemap:'inline',tsconfig:'tsconfig.json'})
 const result=spawnSync(process.execPath,['--test',outfile],{stdio:'inherit'})
 if(result.status) process.exitCode=result.status
}
