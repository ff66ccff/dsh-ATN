/** Experiment-only ablations; production defaults and the historical five arms stay intact. */
export const SIMPLIFICATION_ARMS = ['adaptive', 'no-feedback', 'no-board', 'minimal'] as const
export type SimplificationArm = typeof SIMPLIFICATION_ARMS[number]

export function shiftingMechanisms(mode: string) {
  return { requesterFeedback: mode !== 'no-feedback' && mode !== 'minimal',
    sharedBoard: mode !== 'no-board' && mode !== 'minimal' }
}
