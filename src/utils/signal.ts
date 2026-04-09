// Tiny pub/sub helper for internal events.
//
// Used by the message queue and the agent-busy flag to notify React
// subscribers (via useSyncExternalStore) when module-level state mutates.
// Kept deliberately dependency-free — this is the primitive that lets
// non-React modules own state without coupling to React's render cycle.

export type Signal = {
  /** Subscribe to change notifications. Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void
  /** Notify all current subscribers synchronously. */
  emit: () => void
}

export function createSignal(): Signal {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit() {
      for (const listener of listeners) listener()
    },
  }
}
