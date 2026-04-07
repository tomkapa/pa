import { describe, it, expect } from 'bun:test'
import { parseInput } from './useInput.js'

describe('parseInput', () => {
  it('parses regular characters', () => {
    const events = parseInput('hello')
    expect(events).toEqual([{ input: 'hello', key: expect.objectContaining({ return: false }) }])
  })

  it('parses return key', () => {
    const events = parseInput('\r')
    expect(events).toEqual([{ input: '', key: expect.objectContaining({ return: true }) }])
  })

  it('parses backspace', () => {
    const events = parseInput('\x7f')
    expect(events).toEqual([{ input: '', key: expect.objectContaining({ backspace: true }) }])
  })

  it('treats newlines inside bracketed paste as literal characters', () => {
    const paste = '\x1b[200~hello\nworld\x1b[201~'
    const events = parseInput(paste)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ input: 'hello\nworld', key: expect.objectContaining({ return: false }) })
  })

  it('treats \\r inside bracketed paste as \\n', () => {
    const paste = '\x1b[200~line1\rline2\x1b[201~'
    const events = parseInput(paste)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ input: 'line1\nline2', key: expect.objectContaining({ return: false }) })
  })

  it('handles text before and after bracketed paste', () => {
    const data = 'hi\x1b[200~foo\nbar\x1b[201~!'
    const events = parseInput(data)
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ input: 'hi' })
    expect(events[1]).toMatchObject({ input: 'foo\nbar' })
    expect(events[2]).toMatchObject({ input: '!' })
  })

  it('handles single-line bracketed paste without newlines', () => {
    const paste = '\x1b[200~just text\x1b[201~'
    const events = parseInput(paste)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ input: 'just text' })
  })
})
