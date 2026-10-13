// The context row (forecast table, chart, short) is adapted from token-weather:
// Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0
//
// Pure helpers: what the band says, from the readings, the cache snapshot,
// the TTL and the time. No `$` here, so the tests can call them directly.

import type { CacheSnapshot, CacheTtl, Reading } from '../types'

export const FIVE_MINUTES = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
export const HISTORY = 12

/** A gap this much past five minutes that still hit the cache proves a 1h TTL. */
const SLACK = 15_000

/** One piece of a band row; the render hook turns each into a `Text`. */
export type Segment = {
  text: string
  color?: string
  bold?: boolean
  dimColor?: boolean
}

const BARS = '▁▂▃▄▅▆▇█'

// Single-width text symbols, not emoji: they line up in every terminal font.
const FORECAST = [
  { upTo: 25, icon: '☀', word: 'Klar', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Bewölkt', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Schauer', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Gewitter', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Bald komprimieren', color: 'red' },
]

export function ttlFor(label: string): number | undefined {
  if (label === '5m') return FIVE_MINUTES
  if (label === '1h') return ONE_HOUR
  return undefined
}

export function ttlLabel(ms: number): string {
  return ms >= ONE_HOUR ? '1h' : '5m'
}

/** Appends a reading, keeps the last HISTORY, drops the empty one taken before any response. */
export function pushReading(list: readonly Reading[], reading: Reading): Reading[] {
  return [...list.filter(one => one.tokens > 0), reading].slice(-HISTORY)
}

/**
 * What a request after `gapMs` of quiet says about the TTL, or undefined.
 *
 * A hit after more than five minutes can only be a 1h entry. A miss that
 * re-wrote about what was cached, after five minutes and under an hour, is a
 * 5m entry that lapsed.
 */
export function learnTtl(
  previous: CacheSnapshot,
  read: number,
  written: number,
  gapMs: number,
): number | undefined {
  if (gapMs <= FIVE_MINUTES + SLACK) return undefined
  if (read > 0) return ONE_HOUR
  const isRewrite = previous.tokens > 0 && written >= previous.tokens * 0.9
  if (isRewrite && gapMs < ONE_HOUR) return FIVE_MINUTES
  return undefined
}

export function weatherRow(readings: readonly Reading[], columns: number): Segment[] {
  const now = readings[readings.length - 1]
  if (!now) return []
  const f = forecastFor(now.percent)
  const row: Segment[] = [
    { text: `${f.icon}  ${f.word}`, color: f.color, bold: true },
    { text: `  ${now.percent}% Kontext` },
    { text: `  ${short(now.tokens)} / ${short(now.window)}`, dimColor: true },
  ]
  if (columns >= 60) {
    row.push({ text: '   letzte Turns ', dimColor: true })
    row.push({ text: chart(readings), color: f.color })
    const trend = trendWord(readings)
    if (trend) row.push({ text: `  ${trend}`, dimColor: true })
  }
  return row
}

export function cacheRow(
  snap: CacheSnapshot,
  ttl: CacheTtl,
  now: number,
  columns: number,
): Segment[] {
  const ttlText = `TTL ${ttlLabel(ttl.ms)}${ttl.source === 'assumed' ? '?' : ''}`
  if (snap.tokens === 0) {
    return [
      { text: '◇ Cache leer', bold: true, dimColor: true },
      { text: '  der letzte Request hat nichts gecacht', dimColor: true },
    ]
  }
  const left = snap.at + ttl.ms - now
  const about = snap.isEstimate ? '~' : ''
  if (left <= 0) {
    return [
      { text: '◇ Cache kalt', color: 'subtle', bold: true },
      { text: `  ${about}${short(snap.tokens)} Tokens, abgelaufen vor ${ago(-left)}` },
      { text: `  · der nächste Request schreibt sie neu · ${ttlText}`, dimColor: true },
    ]
  }
  const color = colorFor(left / ttl.ms)
  const row: Segment[] = [
    { text: '◆ Cache', color, bold: true },
    { text: `  ${about}${short(snap.tokens)} Tokens` },
    { text: `  ${drain(left / ttl.ms)}`, color },
    { text: `  läuft ab in ${clock(left)}`, color, bold: true },
    { text: `  · ${ttlText}`, dimColor: true },
  ]
  if (columns >= 100 && !snap.isEstimate) {
    row.push({
      text: `  · zuletzt ${short(snap.read)} gelesen, ${short(snap.written)} geschrieben`,
      dimColor: true,
    })
  }
  return row
}

function forecastFor(percent: number) {
  return FORECAST.find(band => percent < band.upTo) ?? FORECAST[FORECAST.length - 1]!
}

function colorFor(fraction: number): string {
  if (fraction > 0.5) return 'success'
  if (fraction > 0.2) return 'warning'
  return 'error'
}

/** Ten cells that empty as the entry ages. */
function drain(fraction: number): string {
  const full = Math.max(0, Math.min(10, Math.ceil(fraction * 10)))
  return '█'.repeat(full) + '░'.repeat(10 - full)
}

// Bars scale to the busiest reading shown, so growth shows at any fill level.
function chart(readings: readonly Reading[]): string {
  const top = Math.max(...readings.map(r => r.tokens), 1)
  return readings
    .map(r => BARS[Math.min(BARS.length - 1, Math.floor((r.tokens / top) * (BARS.length - 1)))])
    .join('')
}

function trendWord(readings: readonly Reading[]): string {
  const last = readings[readings.length - 1]
  const before = readings[readings.length - 2]
  if (!last || !before) return ''
  const delta = last.tokens - before.tokens
  if (delta > 0) return `▲ +${short(delta)} letzter Turn`
  if (delta < 0) return `▼ ${short(-delta)} letzter Turn`
  return 'gleich'
}

/** m:ss, or h:mm:ss from an hour up. */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return String(n)
}
