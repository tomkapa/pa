import { describe, it, expect } from 'bun:test'
import { parseInput } from '../hooks/useInput.js'

// ---------------------------------------------------------------------------
// SGR mouse parsing tests
//
// SGR mouse format: ESC[<button;col;row M  (press)
//                   ESC[<button;col;row m  (release)
// ---------------------------------------------------------------------------

describe('parseInput — SGR mouse', () => {
  it('parses a left-click press', () => {
    const events = parseInput('\x1b[<0;10;5M')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      kind: 'mouse',
      mouse: {
        kind: 'mouse',
        button: 0,
        action: 'press',
        col: 10,
        row: 5,
        sequence: '\x1b[<0;10;5M',
      },
    })
  })

  it('parses a left-click release', () => {
    const events = parseInput('\x1b[<0;10;5m')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'mouse', mouse: { action: 'release', col: 10, row: 5 } })
  })

  it('parses a hover (motion with no-button base)', () => {
    // 35 = motion (0x20) | no-button (3)
    const events = parseInput('\x1b[<35;42;7M')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'mouse', mouse: { button: 35, col: 42, row: 7 } })
  })

  it('parses large coordinates (>223)', () => {
    const events = parseInput('\x1b[<0;500;300M')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'mouse', mouse: { col: 500, row: 300 } })
  })

  it('routes wheel-up as a synthetic key, not a mouse event', () => {
    // 64 = wheel bit (0x40) | base 0 → wheel up
    const events = parseInput('\x1b[<64;10;5M')
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.kind).toBe('key')
    if (ev.kind === 'key') {
      expect(ev.key.wheelup).toBe(true)
      expect(ev.key.wheeldown).toBe(false)
    }
  })

  it('routes wheel-down as a synthetic key, not a mouse event', () => {
    // 65 = wheel bit (0x40) | base 1 → wheel down
    const events = parseInput('\x1b[<65;10;5M')
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.kind).toBe('key')
    if (ev.kind === 'key') {
      expect(ev.key.wheeldown).toBe(true)
      expect(ev.key.wheelup).toBe(false)
    }
  })

  it('handles a mouse sequence followed by a keypress', () => {
    const events = parseInput('\x1b[<0;1;1Ma')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'mouse', mouse: { action: 'press' } })
    expect(events[1]).toMatchObject({ kind: 'key', input: 'a' })
  })

  it('handles a keypress followed by a mouse sequence', () => {
    const events = parseInput('a\x1b[<0;1;1M')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'key', input: 'a' })
    expect(events[1]).toMatchObject({ kind: 'mouse', mouse: { action: 'press' } })
  })

  it('does not consume bracketed-paste markers as mouse', () => {
    const data = '\x1b[200~hi\x1b[201~'
    const events = parseInput(data)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'key', input: 'hi' })
  })
})
