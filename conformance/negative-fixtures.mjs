/** Deliberately invalid policies: use only to test that a host adapter detects failure. */
export function allowUnowned(custody) { return Object.assign(() => {}, { custody }) }
export function asynchronous() { return async () => {} }
