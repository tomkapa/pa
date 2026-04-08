// ---------------------------------------------------------------------------
// Mouse event types and ClickEvent class
//
// SGR mouse protocol carries the button as a bitmask. We pass the raw byte
// through to dispatchers and let them interpret bits — keeps the parser dumb
// and decoding centralised.
// ---------------------------------------------------------------------------

export interface ParsedMouse {
  readonly kind: 'mouse'
  readonly button: number              // raw SGR button byte (bitmask)
  readonly action: 'press' | 'release' // 'M' or 'm' terminator
  readonly col: number                 // 1-indexed column from terminal
  readonly row: number                 // 1-indexed row from terminal
  readonly sequence: string            // raw bytes for logging
}

// SGR button-byte bitmask helpers. Centralised so call sites stay readable.
export const MOUSE_BUTTON_MASK = 0x03
export const MOUSE_MOTION_BIT  = 0x20
export const MOUSE_WHEEL_BIT   = 0x40
export const MOUSE_ALT_BIT     = 0x08

export const MOUSE_BUTTON_LEFT     = 0
export const MOUSE_BUTTON_MIDDLE   = 1
export const MOUSE_BUTTON_RIGHT    = 2
export const MOUSE_BUTTON_NO_BTN   = 3

export function isWheelEvent(button: number): boolean {
  return (button & MOUSE_WHEEL_BIT) !== 0
}

export function isMotionEvent(button: number): boolean {
  return (button & MOUSE_MOTION_BIT) !== 0
}

export function getBaseButton(button: number): number {
  return button & MOUSE_BUTTON_MASK
}

// ---------------------------------------------------------------------------
// ClickEvent — passed to onClick handlers during the bubble walk
//
// `localCol`/`localRow` are rewritten before each handler fires so a container
// handler sees coordinates relative to its own Box rather than the original
// hit target.
// ---------------------------------------------------------------------------

export class ClickEvent {
  readonly col: number
  readonly row: number
  localCol: number
  localRow: number
  isImmediatePropagationStopped: boolean

  constructor(col: number, row: number) {
    this.col = col
    this.row = row
    this.localCol = 0
    this.localRow = 0
    this.isImmediatePropagationStopped = false
  }

  stopImmediatePropagation(): void {
    this.isImmediatePropagationStopped = true
  }
}

// ---------------------------------------------------------------------------
// Event handlers stored on DOM elements
// ---------------------------------------------------------------------------

export interface EventHandlers {
  onClick?: (event: ClickEvent) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export const EVENT_HANDLER_KEYS = ['onClick', 'onMouseEnter', 'onMouseLeave'] as const satisfies ReadonlyArray<keyof EventHandlers>
