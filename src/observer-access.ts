/** Host authentication owns principals; ATN owns the observation resource and actions. */
import { remoteMethods, type TypertRegistryContract, type TypertResource } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertResourceMap {
    /** A session alias authorizing observation of its entire ATN network. */
    'atn-observation': TypertResource<string>
  }
}

export const ATN_OBSERVATION_RESOURCE = 'atn-observation' as const
export const ATN_CONTENT_READER = {
  name: 'atn-content-reader', resource: ATN_OBSERVATION_RESOURCE,
  actions: ['atnObserver/snapshot'],
} as const
export const ATN_METADATA_READER = {
  name: 'atn-metadata-reader', resource: ATN_OBSERVATION_RESOURCE,
  actions: ['atnObserver/metadata'],
} as const

/** Probe actual protocol capabilities before publishing any observation endpoint. */
export function assertObserverReadCapabilities(registry: TypertRegistryContract, service: object): void {
  if (typeof registry.resources?.entries !== 'function') {
    throw new Error('ATN observation requires Typert resource access-control capabilities')
  }
  for (const method of ['snapshot', 'metadata']) {
    const reader = remoteMethods(service).find(marker => marker.method === method)?.resources?.[ATN_OBSERVATION_RESOURCE]
    if (typeof reader !== 'function' || reader('atn-capability-probe') !== 'atn-capability-probe') {
      throw new Error(`ATN observation requires a resource reader for ${method}`)
    }
  }
}
