import { useLayoutEffect, useContext, useRef } from 'react'
import { StdinContext } from '../components/contexts.js'
import {
  type ParsedMouse,
  isWheelEvent,
  getBaseButton,
  MOUSE_BUTTON_LEFT,
  MOUSE_BUTTON_MIDDLE,
} from '../mouse/types.js'

// ---------------------------------------------------------------------------
// Key descriptor matching Ink's API
// ---------------------------------------------------------------------------

export interface Key {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  // Synthetic wheel "keys" — wheel events are routed through the keyboard
  // pipeline because they behave like scroll keys, not like clicks.
  wheelup: boolean
  wheeldown: boolean
}

export type InputHandler = (input: string, key: Key) => void

export interface UseInputOptions {
  isActive?: boolean
}

// ---------------------------------------------------------------------------
// Discriminated union returned by parseInput
// ---------------------------------------------------------------------------

export type ParsedEvent =
  | { kind: 'key'; input: string; key: Key }
  | { kind: 'mouse'; mouse: ParsedMouse }

// ---------------------------------------------------------------------------
// Parse raw terminal input
//
// Key design: for regular character input (including multi-char paste),
// we call the handler ONCE with the full string. This matches stock Ink's
// behavior and avoids React batching issues with per-character state updates.
// ---------------------------------------------------------------------------

function baseKey(): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    wheelup: false,
    wheeldown: false,
  }
}

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

// Match `ESC[<button;col;row M|m` anchored at the cursor position. The regex
// is anchored implicitly via `data.slice(i).match(...)` returning at index 0.
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/

function parseSgrMouseAt(data: string, i: number): { event: ParsedEvent; consumed: number } | null {
  // Quick prefix check before running the regex.
  if (data.charCodeAt(i) !== 0x1b) return null
  if (data[i + 1] !== '[' || data[i + 2] !== '<') return null

  const match = data.slice(i).match(SGR_MOUSE_RE)
  if (!match) return null

  const button = Number(match[1])
  const col = Number(match[2])
  const row = Number(match[3])
  const terminator = match[4]
  const sequence = match[0]

  // Wheel events are routed back through the keyboard system as synthetic
  // wheelup/wheeldown keys — they behave like scroll keys, not clicks.
  if (isWheelEvent(button)) {
    const key = baseKey()
    const base = getBaseButton(button)
    if (base === MOUSE_BUTTON_LEFT)        key.wheelup = true
    else if (base === MOUSE_BUTTON_MIDDLE) key.wheeldown = true
    // Other base values (2, 3) come from horizontal wheels — ignore for now;
    // they have no obvious mapping to a keyboard scroll key.
    return { event: { kind: 'key', input: '', key }, consumed: sequence.length }
  }

  const action: 'press' | 'release' = terminator === 'M' ? 'press' : 'release'
  const mouse: ParsedMouse = { kind: 'mouse', button, action, col, row, sequence }
  return { event: { kind: 'mouse', mouse }, consumed: sequence.length }
}

export function parseInput(data: string): ParsedEvent[] {
  const results: ParsedEvent[] = []
  let regularChars = ''

  const flush = () => {
    if (regularChars) {
      results.push({ kind: 'key', input: regularChars, key: baseKey() })
      regularChars = ''
    }
  }

  let i = 0
  while (i < data.length) {
    // Bracketed paste start: collect everything until end marker as literal text
    if (data.startsWith(BRACKETED_PASTE_START, i)) {
      flush()
      i += BRACKETED_PASTE_START.length
      const endIdx = data.indexOf(BRACKETED_PASTE_END, i)
      const pasteContent = endIdx >= 0
        ? data.slice(i, endIdx)
        : data.slice(i)
      // Normalise \r and \r\n to \n within the pasted block
      results.push({ kind: 'key', input: pasteContent.replace(/\r\n?/g, '\n'), key: baseKey() })
      i = endIdx >= 0 ? endIdx + BRACKETED_PASTE_END.length : data.length
      continue
    }

    // SGR mouse sequence: must be checked before generic ESC handling so we
    // don't fall through to `key.escape = true; i += 2` and leak the rest of
    // the sequence as bogus regular-char input.
    const mouseMatch = parseSgrMouseAt(data, i)
    if (mouseMatch) {
      flush()
      results.push(mouseMatch.event)
      i += mouseMatch.consumed
      continue
    }

    const ch = data[i]

    if (ch === '\x1b') {
      flush()
      const key = baseKey()

      if (i + 1 < data.length && data[i + 1] === '[') {
        const seq = data.slice(i + 2)

        if (seq.startsWith('A')) { key.upArrow = true; i += 3 }
        else if (seq.startsWith('B')) { key.downArrow = true; i += 3 }
        else if (seq.startsWith('C')) { key.rightArrow = true; i += 3 }
        else if (seq.startsWith('D')) { key.leftArrow = true; i += 3 }
        else if (seq.startsWith('5~')) { key.pageUp = true; i += 4 }
        else if (seq.startsWith('6~')) { key.pageDown = true; i += 4 }
        else if (seq.startsWith('3~')) { key.delete = true; i += 4 }
        else if (seq.startsWith('Z')) { key.shift = true; key.tab = true; i += 3 }
        else if (seq.startsWith('1;2A')) { key.shift = true; key.upArrow = true; i += 6 }
        else if (seq.startsWith('1;2B')) { key.shift = true; key.downArrow = true; i += 6 }
        else if (seq.startsWith('1;2C')) { key.shift = true; key.rightArrow = true; i += 6 }
        else if (seq.startsWith('1;2D')) { key.shift = true; key.leftArrow = true; i += 6 }
        else { key.escape = true; i += 2 }
        results.push({ kind: 'key', input: '', key })
      } else if (i + 1 < data.length) {
        key.meta = true
        results.push({ kind: 'key', input: data[i + 1]!, key })
        i += 2
      } else {
        key.escape = true
        i += 1
        results.push({ kind: 'key', input: '', key })
      }
    }
    else if (ch === '\r' || ch === '\n') {
      flush()
      const key = baseKey()
      key.return = true
      results.push({ kind: 'key', input: '', key })
      i += 1
    }
    else if (ch === '\t') {
      flush()
      const key = baseKey()
      key.tab = true
      results.push({ kind: 'key', input: '', key })
      i += 1
    }
    else if (ch === '\x7f' || ch === '\b') {
      flush()
      const key = baseKey()
      key.backspace = true
      results.push({ kind: 'key', input: '', key })
      i += 1
    }
    else if (data.charCodeAt(i) <= 26) {
      flush()
      const key = baseKey()
      key.ctrl = true
      results.push({ kind: 'key', input: String.fromCharCode(data.charCodeAt(i) + 96), key })
      i += 1
    }
    else {
      regularChars += ch
      i += 1
    }
  }

  flush()
  return results
}

// ---------------------------------------------------------------------------
// useInput hook
//
// Uses a ref for the handler to avoid re-registering the event listener on
// every render. This prevents race conditions with React's async passive
// effect scheduling — the listener always calls the latest handler closure.
// ---------------------------------------------------------------------------

export function useInput(handler: InputHandler, options?: UseInputOptions): void {
  const { stdin } = useContext(StdinContext)
  const isActive = options?.isActive ?? true
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useLayoutEffect(() => {
    if (!isActive) return

    const onData = (data: Buffer) => {
      const str = String(data)
      const events = parseInput(str)
      for (const event of events) {
        if (event.kind === 'key') {
          handlerRef.current(event.input, event.key)
        }
      }
    }

    stdin.on('data', onData)
    return () => { stdin.removeListener('data', onData) }
  }, [stdin, isActive])
}
