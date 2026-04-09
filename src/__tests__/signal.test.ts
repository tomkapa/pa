import { describe, expect, test } from 'bun:test'
import { createSignal } from '../utils/signal.js'

describe('createSignal', () => {
  test('notifies a single subscriber on emit', () => {
    const signal = createSignal()
    let calls = 0
    signal.subscribe(() => { calls++ })
    signal.emit()
    expect(calls).toBe(1)
  })

  test('notifies multiple subscribers on emit', () => {
    const signal = createSignal()
    const seen: string[] = []
    signal.subscribe(() => { seen.push('a') })
    signal.subscribe(() => { seen.push('b') })
    signal.emit()
    expect(seen).toEqual(['a', 'b'])
  })

  test('unsubscribe prevents further notifications', () => {
    const signal = createSignal()
    let calls = 0
    const unsubscribe = signal.subscribe(() => { calls++ })
    signal.emit()
    unsubscribe()
    signal.emit()
    expect(calls).toBe(1)
  })

  test('unsubscribing a non-subscribed listener is a no-op', () => {
    const signal = createSignal()
    const unsubscribe = signal.subscribe(() => {})
    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
  })

  test('emit on a signal with no subscribers does not throw', () => {
    const signal = createSignal()
    expect(() => signal.emit()).not.toThrow()
  })
})
