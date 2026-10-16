/** Defaults are frozen into new networks; missing legacy fields use these bounds on explicit substrate calls. */
export const SUBSTRATE_DEFAULTS = {
  substrateEnabled: true,
  maxSubstrateMessages: 128,
  maxSubstrateMessageBytes: 2048,
  maxSubstrateTotalBytes: 131072,
  substrateSearchResults: 8,
  substrateVisitLimit: 8,
  substrateRefsPerMessage: 32,
  substrateCitationWeight: true,
  substrateCitersShown: 8,
}

export type SubstrateOptions = typeof SUBSTRATE_DEFAULTS
