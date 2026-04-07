import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { envFlag, getObservabilityHome, getSessionId } from './state.js'

/**
 * Local copy of the Anthropic SDK's `Fetch` shape — declared here so the
 * dump-prompts module does not depend on a deep import path that may move
 * across SDK versions.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type DumpRecordType = 'init' | 'system_update' | 'message' | 'response'

interface DumpRecord {
  type: DumpRecordType
  timestamp: string
  data: unknown
}

interface SessionDumpState {
  initialized: boolean
  filePath: string
  messageCountSeen: number
  lastInitFingerprint: string
}

interface RingBufferEntry {
  timestamp: string
  url: string
  body: unknown
}

let sessionState: SessionDumpState | null = null

const RING_BUFFER_LIMIT = 5
const ringBuffer: RingBufferEntry[] = []

/** Promises tracked so `__flushDumpPromptsForTests` can await drain. */
const pendingWrites = new Set<Promise<void>>()

function trackPending(p: Promise<void>): void {
  pendingWrites.add(p)
  void p.finally(() => pendingWrites.delete(p))
}

/** Read-only view of the recent-requests ring buffer for debug commands. */
export function getRecentRequests(): readonly RingBufferEntry[] {
  return ringBuffer
}

function pushRing(entry: RingBufferEntry): void {
  ringBuffer.push(entry)
  while (ringBuffer.length > RING_BUFFER_LIMIT) ringBuffer.shift()
}

function getOrCreateSessionState(): SessionDumpState {
  if (sessionState) return sessionState

  const dir = join(getObservabilityHome(), 'dump-prompts')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // Initialize anyway with the planned path; subsequent writes will fail silently.
  }
  sessionState = {
    initialized: false,
    filePath: join(dir, `${getSessionId()}.jsonl`),
    messageCountSeen: 0,
    lastInitFingerprint: '',
  }
  return sessionState
}

/**
 * Cheap, stable fingerprint over the request shape (model + tool names +
 * system-prompt length). Cheap enough to compute on every request, distinctive
 * enough that any meaningful prompt change flips it.
 */
function initFingerprint(req: Record<string, unknown>): string {
  const tools = req['tools'] as Array<{ name?: string }> | undefined
  const system = req['system'] as unknown
  let sysLen = 0
  if (typeof system === 'string') {
    sysLen = system.length
  } else if (Array.isArray(system)) {
    for (const block of system) {
      const text = (block as { text?: string } | null)?.text
      if (typeof text === 'string') sysLen += text.length
    }
  }
  const toolNames = tools?.map(t => t.name ?? '').join(',') ?? ''
  return `${String(req['model'] ?? '')}|${toolNames}|${sysLen}`
}

function writeRecord(filePath: string, record: DumpRecord): void {
  const line = `${JSON.stringify(record)}\n`
  trackPending(
    appendFile(filePath, line).catch(() => {
      // Debug logging must never crash the host process.
    }),
  )
}

interface ParsedRequestBody {
  model?: unknown
  system?: unknown
  tools?: unknown
  messages?: unknown
  max_tokens?: unknown
  [k: string]: unknown
}

function parseRequestBody(init: RequestInit | undefined): ParsedRequestBody | null {
  const body = init?.body
  if (typeof body !== 'string') return null
  try {
    return JSON.parse(body) as ParsedRequestBody
  } catch {
    return null
  }
}

function extractInitFields(req: ParsedRequestBody): Record<string, unknown> {
  const { messages: _messages, ...rest } = req
  return rest
}

function dispatchRequestRecords(
  state: SessionDumpState,
  req: ParsedRequestBody,
  url: string,
  timestamp: string,
): void {
  pushRing({ timestamp, url, body: req })

  const fingerprint = initFingerprint(req)

  if (!state.initialized) {
    state.initialized = true
    state.lastInitFingerprint = fingerprint
    writeRecord(state.filePath, { type: 'init', timestamp, data: extractInitFields(req) })
  } else if (fingerprint !== state.lastInitFingerprint) {
    state.lastInitFingerprint = fingerprint
    writeRecord(state.filePath, {
      type: 'system_update',
      timestamp,
      data: extractInitFields(req),
    })
  }

  const messages = Array.isArray(req.messages) ? (req.messages as unknown[]) : []
  for (let i = state.messageCountSeen; i < messages.length; i++) {
    writeRecord(state.filePath, { type: 'message', timestamp, data: messages[i] })
  }
  state.messageCountSeen = messages.length
}

/** Structural subset of `Response` we need — avoids a Bun/undici type clash. */
interface MinimalResponse {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

async function captureResponse(state: SessionDumpState, response: MinimalResponse): Promise<void> {
  const timestamp = new Date().toISOString()
  const contentType = response.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('text/event-stream')) {
      const text = await response.text()
      const chunks = text.split(/\n\n/).filter(c => c.length > 0)
      writeRecord(state.filePath, {
        type: 'response',
        timestamp,
        data: { streaming: true, status: response.status, chunks },
      })
    } else {
      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // keep as raw text
      }
      writeRecord(state.filePath, {
        type: 'response',
        timestamp,
        data: { streaming: false, status: response.status, body: parsed },
      })
    }
  } catch {
    // Never throw from response capture.
  }
}

function shouldDump(): boolean {
  const explicit = envFlag('PA_DUMP_PROMPTS')
  if (explicit !== undefined) return explicit
  return process.env['NODE_ENV'] !== 'test'
}

/**
 * Build a `fetch` wrapper for the Anthropic SDK that records every API
 * request and response to `~/.pa/dump-prompts/<sessionId>.jsonl`. All
 * bookkeeping is deferred via `setImmediate` so the network call itself
 * never waits on debug work.
 */
export function createDumpPromptsFetch(
  baseFetch: FetchLike = globalThis.fetch as unknown as FetchLike,
): FetchLike {
  return async function dumpPromptsFetch(input: string | URL | Request, init?: RequestInit) {
    if (!shouldDump()) return baseFetch(input, init)

    const response = await baseFetch(input, init)

    const deferred = new Promise<void>(resolve => {
      setImmediate(() => {
        try {
          const state = getOrCreateSessionState()
          const timestamp = new Date().toISOString()
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          const body = parseRequestBody(init)
          if (body) dispatchRequestRecords(state, body, url, timestamp)
          // Clone so the caller still gets a fully consumable response.
          trackPending(captureResponse(state, response.clone() as unknown as MinimalResponse))
        } catch {
          // Never throw from the dump path.
        } finally {
          resolve()
        }
      })
    })
    trackPending(deferred)

    return response
  }
}

/** Test-only: clear per-session dump state to isolate test runs. */
export function __resetDumpPromptsForTests(): void {
  sessionState = null
  ringBuffer.length = 0
  pendingWrites.clear()
}

/** Test-only: wait for all in-flight writes/captures to settle. */
export async function __flushDumpPromptsForTests(): Promise<void> {
  while (pendingWrites.size > 0) {
    const snapshot = Array.from(pendingWrites)
    await Promise.allSettled(snapshot)
  }
}
