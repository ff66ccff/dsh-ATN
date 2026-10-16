export function allowUnowned(custody: (...args: any[]) => readonly string[] | ReadonlySet<string>): (() => void) & { custody: typeof custody }
export function asynchronous(): () => Promise<void>
