import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { FIVE_MINUTES, ONE_HOUR, cacheRow, clock, learnTtl } from '../hooks/cache'

const START = 1_700_000_000_000

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** Answers what the plugin asks beneath it: a clock, a store, usage, toasts, and one request's usage. */
function world(on: On, cached: { read: number; written: number }) {
  const time = mock.clock(on, { now: START })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: START,
      context: { tokens: 60_000, window: 200_000, percent: 30 },
      rateLimits: [],
    },
  }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: 'claude-test',
        input_tokens: 12,
        output_tokens: 300,
        cache_read_input_tokens: cached.read,
        cache_creation_input_tokens: cached.written,
      },
    }
  })
  return { time, toasts }
}

async function step($: Engine, index: number) {
  const stream = $.turn.step({ turnId: 't', index, model: 'claude-test', messageCount: 3 })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

describe('learnTtl', () => {
  const previous = { tokens: 50_000, read: 0, written: 50_000, at: 0, isEstimate: false }

  test('a hit after more than five minutes proves 1h', () => {
    expect(learnTtl(previous, 50_000, 0, 10 * 60_000)).toBe(ONE_HOUR)
  })

  test('a full re-write after ten minutes is a lapsed 5m entry', () => {
    expect(learnTtl(previous, 0, 51_000, 10 * 60_000)).toBe(FIVE_MINUTES)
  })

  test('a short gap says nothing', () => {
    expect(learnTtl(previous, 50_000, 0, 60_000)).toBeUndefined()
  })
})

describe('cacheRow', () => {
  const snap = { tokens: 42_000, read: 40_000, written: 2_000, at: 0, isEstimate: false }
  const ttl = { ms: FIVE_MINUTES, source: 'config' } as const

  test('counts down while warm', () => {
    const text = cacheRow(snap, ttl, 90_000, 120).map(s => s.text).join('')
    expect(text).toContain('42k Tokens')
    expect(text).toContain('läuft ab in 3:30')
    expect(text).toContain('40k gelesen, 2k geschrieben')
  })

  test('says cold once lapsed', () => {
    const text = cacheRow(snap, ttl, FIVE_MINUTES + 3 * 60_000, 120).map(s => s.text).join('')
    expect(text).toContain('Cache kalt')
    expect(text).toContain('abgelaufen vor 3 min')
  })

  test('clock formats hours', () => {
    expect(clock(ONE_HOUR)).toBe('1:00:00')
    expect(clock(61_000)).toBe('1:01')
  })
})

test('the band shows the cache and counts down on every surface', { options: { ttl: '5m', warnSeconds: 60 } }, async ($, on) => {
  const { time, toasts } = world(on, { read: 40_000, written: 2_000 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await step($, 0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cache-weather', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /30% Kontext/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42k Tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /läuft ab in 5:00/ })).toBeDefined()
    await ui.unmount()
  }

  await time.advance(4 * 60_000 + 30_000)
  const ui = await $.ui.mount({ plugin: 'cache-weather', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /läuft ab in 0:30/ })).toBeDefined()
  expect(toasts.length).toBe(1)

  await time.advance(60_000)
  expect(await ui.find({ type: 'Text', text: /Cache kalt/ })).toBeDefined()
  await ui.unmount()
})

test('auto learns a 1h TTL from a late cache hit', { options: { ttl: 'auto' } }, async ($, on) => {
  const { time } = world(on, { read: 40_000, written: 0 })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await step($, 0)
  const ui = await $.ui.mount({ plugin: 'cache-weather', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /TTL 5m\?/ })).toBeDefined()

  await time.advance(20 * 60_000)
  await step($, 1)
  expect(await ui.find({ type: 'Text', text: /TTL 1h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /läuft ab in 1:00:00/ })).toBeDefined()
  await ui.unmount()
})
