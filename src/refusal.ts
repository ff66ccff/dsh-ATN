/** Stable public refusal codes. Hosts may add codes without renaming these. */
export const INFORMATION_BOUNDARY_REFUSAL_CODES = [
  'evidence-not-owned', 'not-task-holder', 'metadata-only',
  'fact-requests-and-owner-results-only', 'extra-transport-fields',
  'invalid-fact-request', 'fixed-edge-required', 'invalid-setup-receipt', 'invalid-owner-result',
  'async-policy',
] as const

export type InformationBoundaryRefusalCode = (typeof INFORMATION_BOUNDARY_REFUSAL_CODES)[number]

/** Raised before committing an ATN operation. `code` is a public host contract. */
export class AtnRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AtnRefusal'
  }
}
