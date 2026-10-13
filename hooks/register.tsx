// Prompt Cache Forecast: token-weather's context forecast, plus a second row for the
// prompt cache: how many tokens the last main-loop request left cached, and a
// countdown to when that entry lapses.
//
// turn.step: after each main-loop request, read its usage; what it read from
// and wrote to the cache is what is cached now, until `at + ttl`.
// turn.complete: token-weather's context reading.
// classic.*ModelSwitch / classic.SessionStart: the engine's own word on the TTL
// and, on a resume, what the transcript left cached.
// session.start: a one-second clock that moves `now`, so the countdown runs.
// ui.render (AbovePrompt): two rows, weather then cache.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, PluginOptions, Register } from 'claude-code'

import type { CacheSnapshot } from '../types'
import {
  FIVE_MINUTES,
  ONE_HOUR,
  cacheRow,
  clock,
  learnTtl,
  pushReading,
  short,
  ttlFor,
  weatherRow,
} from './cache'
import type { Segment } from './cache'

const readings = atom({ plugin: 'prompt-cache-forecast', key: 'readings' } as const, [])
const cache = atom({ plugin: 'prompt-cache-forecast', key: 'cache' } as const, null)
const ttl = atom({ plugin: 'prompt-cache-forecast', key: 'ttl' } as const, {
  ms: FIVE_MINUTES,
  source: 'assumed',
})
const now = atom({ plugin: 'prompt-cache-forecast', key: 'now' } as const, 0)

/** Where an observed or reported TTL is kept across sessions. */
const STORED_TTL = 'ttl'

// Module state that may start over on a reload: nothing is lost but one toast.
let isWorking = false
let warnedFor = -1
let lastTick = 0

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await initTtl($, options)
    await takeReading($)
    $.clock.every(1000, () => void tick($, options))
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, readings, () => [])
      await update($, cache, () => null)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (!e.agentId && response.usage) {
      await recordStep($, response.usage, options)
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      isWorking = false
      await takeReading($)
    }
    return result
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    await reportTtl($, e.cache_ttl, options)
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    await reportTtl($, e.cache_ttl, options)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.context_tokens && e.seconds_since_last_response !== undefined) {
      await seedFromResume($, e.context_tokens, e.seconds_since_last_response, e.prompt_cache_likely_expired, options)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId) {
      return next(e)
    }
    const list = await read($, readings)
    const snap = await read($, cache)
    if (list.length === 0 && !snap) {
      return next(e)
    }
    const life = await read($, ttl)
    const at = (await read($, now)) || (await $.clock.now())
    const columns = e.props.bodyColumns
    const { Box, Text } = $.ui.resolve(e)
    const row = (key: string, segments: Segment[]) => (
      <Box key={key} flexDirection="row">
        {segments.map(one => (
          <Text color={one.color} bold={one.bold} dimColor={one.dimColor}>
            {one.text}
          </Text>
        ))}
      </Box>
    )
    return (
      <Box flexDirection="column" paddingX={1}>
        {list.length > 0 && row('weather', weatherRow(list, columns))}
        {snap && row('cache', cacheRow(snap, life, at, columns))}
      </Box>
    )
  })
}

async function initTtl($: EngineInterface, options: PluginOptions) {
  const fixed = ttlFor(String(options.ttl))
  if (fixed) {
    await update($, ttl, () => ({ ms: fixed, source: 'config' }))
    return
  }
  const current = await read($, ttl)
  if (current.source !== 'assumed' && current.source !== 'config') return
  const stored = ttlFor(String((await $.store.get(STORED_TTL)) ?? ''))
  await update($, ttl, () =>
    stored ? { ms: stored, source: 'observed' } : { ms: FIVE_MINUTES, source: 'assumed' },
  )
}

async function recordStep($: EngineInterface, usage: ModelUsage, options: PluginOptions) {
  const at = await $.clock.now()
  const readTokens = usage.cache_read_input_tokens ?? 0
  const written = usage.cache_creation_input_tokens ?? 0
  const previous = await read($, cache)
  if (previous && !previous.isEstimate && options.ttl === 'auto') {
    const learned = learnTtl(previous, readTokens, written, at - previous.at)
    if (learned) await keepTtl($, learned, 'observed')
  }
  const snap: CacheSnapshot = {
    tokens: readTokens + written,
    read: readTokens,
    written,
    at,
    isEstimate: false,
  }
  await update($, cache, () => snap)
  await update($, now, () => at)
}

async function reportTtl($: EngineInterface, label: string, options: PluginOptions) {
  const ms = ttlFor(label)
  if (ms && options.ttl === 'auto') await keepTtl($, ms, 'reported')
}

async function seedFromResume(
  $: EngineInterface,
  tokens: number,
  seconds: number,
  isLikelyExpired: boolean | undefined,
  options: PluginOptions,
) {
  const at = (await $.clock.now()) - seconds * 1000
  // The engine judged expiry against its own TTL: past five minutes, that verdict names it.
  if (options.ttl === 'auto' && isLikelyExpired !== undefined) {
    const gap = seconds * 1000
    if (gap > FIVE_MINUTES && gap < ONE_HOUR) {
      await keepTtl($, isLikelyExpired ? FIVE_MINUTES : ONE_HOUR, 'reported')
    }
  }
  if (await read($, cache)) return
  await update($, cache, () => ({ tokens, read: 0, written: 0, at, isEstimate: true }))
}

async function keepTtl($: EngineInterface, ms: number, source: 'observed' | 'reported') {
  await update($, ttl, () => ({ ms, source }))
  await $.store.set(STORED_TTL, ms >= ONE_HOUR ? '1h' : '5m')
}

async function takeReading($: EngineInterface) {
  try {
    const { context } = await $.session.usage()
    if (!context || !context.window) return
    const tokens = context.tokens ?? 0
    const percent = Math.round(context.percent ?? (tokens / context.window) * 100)
    await update($, readings, list => pushReading(list, { tokens, window: context.window, percent }))
  } catch {
    // No reading this turn; the band keeps the last one.
  }
}

async function tick($: EngineInterface, options: PluginOptions) {
  const snap = await read($, cache)
  if (!snap || snap.tokens === 0) return
  const t = await $.clock.now()
  const { ms } = await read($, ttl)
  const left = snap.at + ms - t
  // Past expiry the row reads in minutes: a redraw every 15 s is plenty.
  if (left > 0 || t - lastTick >= 15_000) {
    lastTick = t
    await update($, now, () => t)
  }
  const warn = Number(options.warnSeconds) * 1000
  if (warn > 0 && left > 0 && left <= warn && !isWorking && warnedFor !== snap.at) {
    warnedFor = snap.at
    $.ui.toast(`Prompt-Cache (${short(snap.tokens)} Tokens) läuft in ${clock(left)} ab`, {
      timeoutMs: 8000,
    })
  }
}
