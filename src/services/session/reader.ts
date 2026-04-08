import { readFile } from 'node:fs/promises'
import type { Message } from '../../types/message.js'
import { isNodeError } from '../../utils/error.js'
import { unwrapMessage, type SerializedMessage } from './envelope.js'

// Lines with unknown type discriminators or bad JSON are silently skipped so a
// crash mid-appendFile never blocks future loads and so old binaries remain
// forward-compatible with newer files.

const KNOWN_MESSAGE_TYPES = new Set(['user', 'assistant', 'system'])

/** Returns null for missing files so callers can choose between error and
 *  start-fresh semantics. */
export async function loadSession(filePath: string): Promise<Message[] | null> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }

  const messages: Message[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecognizedEntry(parsed)) continue
    messages.push(unwrapMessage(parsed))
  }
  return messages
}

function isRecognizedEntry(value: unknown): value is SerializedMessage {
  if (value === null || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  if (typeof rec.type !== 'string') return false
  if (!KNOWN_MESSAGE_TYPES.has(rec.type)) return false
  if (typeof rec.uuid !== 'string') return false
  if (typeof rec.timestamp !== 'string') return false
  return true
}
