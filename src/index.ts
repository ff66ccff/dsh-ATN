/**
 * `dsh-atn` runtime entry: a Cordis service plugin that owns every ATN network
 * and every Agent the network creates.
 *
 * The bundle patch loads this host row and an ATN preset declaration. The
 * preset's `./tools` row injects the `atn` service this class registers.
 * @module dsh-atn
 */
import type { Context } from '@deepseek-ai/cordis'
import { assertConfigRelations, Config, type Config as AtnConfig } from './config.ts'
import { AtnRuntime } from './runtime.ts'
import { AtnObserver } from './observer.ts'

export const name = 'atn'
/** Services the runtime needs before it can own networks. */
export const inject = ['agents', 'tools', 'sessions']
export { Config, AtnRuntime }
export { createExactJsonValidator, isTaskAccepted } from './tasks.ts'
export type { TaskValidator, TaskValidationOutcome } from './tasks.ts'
export type { TaskRecord, TaskAcceptance, TaskAcceptanceMetrics } from './schema.ts'
export type { RequesterFeedbackInput } from './requester-feedback.ts'
export type { PublishKnowledgeInput } from './knowledge.ts'
export type { WhiteboardInput } from './whiteboard.ts'

/**
 * Cordis service plugin for the ATN runtime.
 *
 * The class only validates the resolved configuration and hands it to
 * {@link AtnRuntime}; every durable or model-facing decision lives in the
 * runtime so tests can exercise it with an explicit store and clock.
 */
export default class AtnRuntimePlugin extends AtnRuntime {
  /**
   * @param ctx - Plugin context, captured as the owner of ATN-created Agents.
   * @param config - Validated plugin configuration.
   */
  constructor(ctx: Context, config: AtnConfig) {
    assertConfigRelations(config)
    super(ctx, config)
    ctx.inject(['typert'], inner => { inner.plugin(AtnObserver) })
  }
}
