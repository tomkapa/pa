import { describe, expect, test, beforeEach } from 'bun:test'
import {
  isAgentBusy,
  setAgentBusy,
  subscribeToAgentBusy,
  __resetAgentBusyForTests,
} from '../utils/agentBusy.js'

describe('agentBusy', () => {
  beforeEach(() => {
    __resetAgentBusyForTests()
  })

  test('starts idle', () => {
    expect(isAgentBusy()).toBe(false)
  })

  test('setAgentBusy(true) flips synchronously', () => {
    setAgentBusy(true)
    expect(isAgentBusy()).toBe(true)
  })

  test('setAgentBusy(false) flips back', () => {
    setAgentBusy(true)
    setAgentBusy(false)
    expect(isAgentBusy()).toBe(false)
  })

  test('setAgentBusy with the current value does not notify subscribers', () => {
    let calls = 0
    const unsubscribe = subscribeToAgentBusy(() => { calls++ })
    setAgentBusy(false) // already false
    expect(calls).toBe(0)
    setAgentBusy(true)
    expect(calls).toBe(1)
    setAgentBusy(true) // already true
    expect(calls).toBe(1)
    unsubscribe()
  })

  test('subscribers fire on real transitions', () => {
    let calls = 0
    const unsubscribe = subscribeToAgentBusy(() => { calls++ })
    setAgentBusy(true)
    setAgentBusy(false)
    setAgentBusy(true)
    expect(calls).toBe(3)
    unsubscribe()
  })

  test('unsubscribe prevents further notifications', () => {
    let calls = 0
    const unsubscribe = subscribeToAgentBusy(() => { calls++ })
    setAgentBusy(true)
    unsubscribe()
    setAgentBusy(false)
    expect(calls).toBe(1)
  })
})
