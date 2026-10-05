/** Native exact Session reads required by Team continuation; search is not exposed in this pilot. */
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

export class ExperimentSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('Full-text Session search is not part of the experiment'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('Full-text event search is not part of the experiment'))
  }
}
