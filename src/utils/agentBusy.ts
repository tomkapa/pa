// Synchronous "agent is running a turn" flag, readable from anywhere.
//
// The submit handler reads isAgentBusy() BEFORE its first await so it can
// decide whether to enqueue the new submission or run it immediately. React
// state would be one render behind; a module-level boolean is read in the
// same tick it's written.
//
// The drain path and the immediate path both wrap their work in
// setAgentBusy(true) / finally setAgentBusy(false). The flag MUST flip to
// true synchronously, BEFORE the first await, so a second drain effect
// firing in the same microtask sees busy=true and bails — this is the trick
// that makes the simple single-boolean design race-safe.

import { createSignal } from './signal.js'

let busy = false
const changed = createSignal()

export function isAgentBusy(): boolean {
  return busy
}

export function setAgentBusy(value: boolean): void {
  if (busy === value) return
  busy = value
  changed.emit()
}

export const subscribeToAgentBusy = changed.subscribe

/**
 * Test-only: reset the module-level state.
 */
export function __resetAgentBusyForTests(): void {
  busy = false
  changed.emit()
}
