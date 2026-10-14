/** Required execution-directory services for Harness managed Team activations. */
import type { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'

export async function installTeamDirectory(ctx: Context, cwd: string): Promise<void> {
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: cwd })
}
