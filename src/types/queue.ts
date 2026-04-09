// A single user submission that has been buffered while the agent was
// mid-turn, waiting to be delivered when the current turn ends.
//
// Deliberately narrow for MVP — the `mode` discriminator is future-proofing
// for bash/slash-command modes that will land with CODE-148/149.
export type QueuedCommand = {
  /** The user's trimmed text input. */
  value: string
  /** Stable id for React keys and future dedupe. Generated at enqueue time. */
  uuid: string
  /** Submission mode. Only 'prompt' is supported today. */
  mode: 'prompt'
}
