/** Public live-node roster only: no fixture, phase, document, seed or scenario input. */
export const STATIC_WIDE_POLICY = {
  id: 'public-roster-cyclic-minus1-plus1-plus2-plus3-v1',
  offsets: [-1, 1, 2, 3],
  inputSource: 'Provisioned live node IDs in public birth order; these identities are available through bounded atn_status discovery.',
  usesFixture: false,
  usesPhaseInformation: false,
  selectionTime: 'Once after provisioning, before any model call or evidence read.',
} as const

export function selectStaticWidePeers(publicNodeIds: readonly string[]): Record<string, string[]> {
  if (publicNodeIds.length < 5 || new Set(publicNodeIds).size !== publicNodeIds.length ||
    publicNodeIds.some(id => typeof id !== 'string' || !id)) throw new Error('Require at least five distinct public live node IDs')
  return Object.fromEntries(publicNodeIds.map((id, index) => [id,
    STATIC_WIDE_POLICY.offsets.map(offset => publicNodeIds[(index + offset + publicNodeIds.length) % publicNodeIds.length])]))
}
