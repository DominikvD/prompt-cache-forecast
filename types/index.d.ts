/** One context reading after a main-loop turn, as token-weather keeps it. */
export type Reading = { tokens: number; window: number; percent: number }

/** What the last main-loop request left in the prompt cache, and when. */
export type CacheSnapshot = {
  /** Tokens now cached: what the request read plus what it wrote. */
  tokens: number
  read: number
  written: number
  /** When the request answered, in `$.clock.now()` milliseconds. */
  at: number
  /** True when seeded from a resumed transcript rather than a request. */
  isEstimate: boolean
}

/** How long a cache entry lives, and how the mod knows. */
export type CacheTtl = {
  ms: number
  source: 'assumed' | 'config' | 'observed' | 'reported'
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-cache-forecast': {
      readings: Reading[]
      cache: CacheSnapshot | null
      ttl: CacheTtl
      now: number
    }
  }
}
