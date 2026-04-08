import type { ReactElement } from 'react'
import type { FiberRoot } from 'react-reconciler'
import { LegacyRoot } from 'react-reconciler/constants.js'
import { createReconciler, type InkReconciler } from './reconciler.js'
import { createDOMElement, type DOMElement } from './dom.js'
import type { ScreenBuffer } from './screen.js'
import { createScreenBuffer } from './screen.js'
import { renderToBuffer } from './output.js'
import { computeOutputHeight } from './render-node-to-output.js'
import { diffBuffers, serializePatches, serializeFullFrame, serializeFrameRelative } from './log-update.js'
import { cursorTo, cursorUp, cursorHide, cursorShow, resetStyle, eraseDown, bracketedPasteEnable, bracketedPasteDisable, kittyKeyboardPush, kittyKeyboardPop } from './termio/csi.js'
import { decreset, disableMouseTracking } from './termio/dec.js'
import { throttle } from './throttle.js'
import { FRAME_INTERVAL_MS } from './constants.js'
import { parseInput } from './hooks/useInput.js'
import { dispatchClick, dispatchHover } from './mouse/dispatch.js'
import { isMotionEvent, getBaseButton, MOUSE_BUTTON_LEFT, type ParsedMouse } from './mouse/types.js'

const logReconcilerError = (label: string) => (error: Error): void => {
  process.stderr.write(`Ink ${label} error: ${error.stack ?? error.message}\n`)
}

export interface InkOptions {
  stdout: NodeJS.WriteStream
  stdin: NodeJS.ReadStream
  stderr?: NodeJS.WriteStream
  exitOnCtrlC?: boolean
  patchConsole?: boolean
  debug?: boolean
}

export class Ink {
  private readonly stdout: NodeJS.WriteStream
  private readonly stdin: NodeJS.ReadStream
  private readonly exitOnCtrlC: boolean
  private readonly debug: boolean

  private readonly rootNode: DOMElement
  private readonly reconciler: InkReconciler
  private readonly container: FiberRoot

  private frontBuffer: ScreenBuffer
  private backBuffer: ScreenBuffer
  private isFirstRender = true
  private needsFullRepaint = true
  private isUnmounted = false
  // Number of terminal rows currently occupied by the live region in
  // non-alt-screen mode. Tracked so the next frame can move the cursor up to
  // the top of the previous live region before redrawing. Capped at viewport
  // rows when used so we never try to walk above the visible viewport (any
  // rows beyond that have already scrolled into terminal scrollback and are
  // immutable).
  private liveRegionRows = 0

  private readonly exitPromise: Promise<void>
  private resolveExit!: () => void

  private readonly resizeHandler: () => void

  private altScreenActive = false
  private readonly signalHandler: () => void

  // Set of currently-hovered DOMElements (those with onMouseEnter/Leave) used
  // by dispatchHover for diff-based enter/leave fires.
  private readonly hoveredNodes: Set<DOMElement> = new Set()
  // Track left-button drag state so we can fire `onClick` only on the press
  // event (release events arrive separately and would otherwise double-fire).
  private leftButtonDown = false

  private readonly mouseStdinHandler: (data: Buffer) => void

  setAltScreen(active: boolean): void {
    this.altScreenActive = active
    if (!active) {
      // Drop hover state on alt-screen exit so re-entry starts clean.
      this.hoveredNodes.clear()
      this.leftButtonDown = false
    }
  }

  constructor(options: InkOptions) {
    this.stdout = options.stdout
    this.stdin = options.stdin
    this.exitOnCtrlC = options.exitOnCtrlC ?? true
    this.debug = options.debug ?? false

    const cols = this.stdout.columns ?? 80
    const rows = this.stdout.rows ?? 24

    this.frontBuffer = createScreenBuffer(cols, rows)
    this.backBuffer = createScreenBuffer(cols, rows)

    this.rootNode = createDOMElement('ink-root')
    this.reconciler = createReconciler(() => this.onCommit())
    this.container = this.reconciler.createContainer(
      this.rootNode,
      LegacyRoot,
      null,
      false,
      null,
      '',
      logReconcilerError('uncaught'),
      logReconcilerError('caught'),
      logReconcilerError('recoverable'),
      () => {},
    )

    this.exitPromise = new Promise<void>(resolve => {
      this.resolveExit = resolve
    })

    this.resizeHandler = () => {
      const cols = this.stdout.columns ?? 80
      const rows = this.stdout.rows ?? 24
      this.frontBuffer = createScreenBuffer(cols, rows)
      this.backBuffer = createScreenBuffer(cols, rows)
      this.needsFullRepaint = true
      // Terminal reflowed: the previous live region's row count no longer
      // matches what's on screen, so we can't safely walk the cursor back to
      // it. Drop the tracker — the next frame in normal mode will simply
      // append below the wrapped old content.
      this.liveRegionRows = 0
      queueMicrotask(() => this.throttledRender())
    }
    this.stdout.on('resize', this.resizeHandler)

    this.signalHandler = () => {
      if (this.altScreenActive) {
        // disableMouseTracking() is idempotent — safe to send even if tracking
        // was never enabled. Combine into a single write for atomic output.
        this.stdout.write(disableMouseTracking() + decreset(1049))
      }
      process.exit(0)
    }
    process.on('SIGTERM', this.signalHandler)
    process.on('SIGINT', this.signalHandler)

    // Mouse stdin listener — runs alongside useInput's listeners and is
    // gated on alt-screen so we don't hit-test against stale rects when the
    // user is in normal scrollback mode (where row coordinates are
    // ambiguous because the buffer can scroll). Wheel events are routed
    // through the keyboard pipeline by the parser, so they're filtered out
    // here.
    this.mouseStdinHandler = (data: Buffer) => {
      if (!this.altScreenActive) return
      const events = parseInput(String(data))
      for (const event of events) {
        if (event.kind !== 'mouse') continue
        this.handleMouseEvent(event.mouse)
      }
    }
    this.stdin.on('data', this.mouseStdinHandler)

    if (!this.debug) {
      this.stdout.write(bracketedPasteEnable() + kittyKeyboardPush())
    }
  }

  // -------------------------------------------------------------------------
  // Mouse event routing
  // -------------------------------------------------------------------------

  private handleMouseEvent(mouse: ParsedMouse): void {
    // Convert from terminal's 1-indexed coordinates to renderer's 0-indexed
    // screen cells (the same space the rect cache stores).
    const col = mouse.col - 1
    const row = mouse.row - 1
    const motion = isMotionEvent(mouse.button)
    const baseButton = getBaseButton(mouse.button)

    if (!motion && mouse.action === 'press' && baseButton === MOUSE_BUTTON_LEFT) {
      // Fresh left-button press → fire click. Track the down state so we
      // know to ignore the matching release.
      this.leftButtonDown = true
      dispatchClick(this.rootNode, col, row)
      return
    }

    if (!motion && mouse.action === 'release' && baseButton === MOUSE_BUTTON_LEFT) {
      this.leftButtonDown = false
      return
    }

    if (motion) {
      // Both hover (no-button motion) and drag (button-held motion) update
      // the hover set. Drag-specific dispatch is left to a follow-up task.
      dispatchHover(this.rootNode, col, row, this.hoveredNodes)
      return
    }

    // Other clicks (middle, right) are not currently dispatched — left as a
    // follow-up. We could route them through dispatchClick with a button
    // discriminator, but the technical notes scope this task to onClick.
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  render(element: ReactElement): void {
    if (this.isUnmounted) return
    // Synchronous update + flush so the initial commit (and useLayoutEffect
    // listeners that depend on stdin) happens before render() returns.
    this.reconciler.updateContainerSync(element, this.container, null, () => {})
    this.reconciler.flushSyncWork()
  }

  unmount(): void {
    if (this.isUnmounted) return
    this.isUnmounted = true

    this.throttledRender.cancel()
    this.reconciler.updateContainer(null, this.container, null, () => {})
    this.stdout.removeListener('resize', this.resizeHandler)
    this.stdin.removeListener('data', this.mouseStdinHandler)
    process.removeListener('SIGTERM', this.signalHandler)
    process.removeListener('SIGINT', this.signalHandler)

    if (!this.debug) {
      this.stdout.write(kittyKeyboardPop() + bracketedPasteDisable() + cursorShow() + resetStyle())
    }

    this.resolveExit()
  }

  waitUntilExit(): Promise<void> {
    return this.exitPromise
  }

  getStdout(): NodeJS.WriteStream { return this.stdout }
  getStdin(): NodeJS.ReadStream { return this.stdin }
  getExitOnCtrlC(): boolean { return this.exitOnCtrlC }

  // -------------------------------------------------------------------------
  // Rendering pipeline
  // -------------------------------------------------------------------------

  private onCommit(): void {
    const cols = this.stdout.columns ?? 80
    this.rootNode.yogaNode.calculateLayout(cols)

    if (this.isFirstRender) {
      // Render synchronously so callers (e.g. test harnesses) can read the
      // first frame immediately after render() returns.
      this.performRender()
      this.isFirstRender = false
    } else {
      // Defer to a microtask so useLayoutEffect runs first, then throttle
      // to cap the frame rate.
      queueMicrotask(() => this.throttledRender())
    }
  }

  private throttledRender = throttle(() => {
    if (this.isUnmounted) return
    this.performRender()
  }, FRAME_INTERVAL_MS)

  private performRender(): void {
    const cols = this.stdout.columns ?? 80
    const viewportRows = this.stdout.rows ?? 24
    const outputHeight = computeOutputHeight(this.rootNode)

    if (this.altScreenActive) {
      // Alt-screen has no scrollback — cap the buffer at the viewport and
      // use absolute positioning + diffing for efficient incremental updates.
      const height = viewportRows
      if (this.backBuffer.width !== cols || this.backBuffer.height !== height) {
        this.backBuffer = createScreenBuffer(cols, height)
      }
      if (this.frontBuffer.width !== cols || this.frontBuffer.height !== height) {
        this.frontBuffer = createScreenBuffer(cols, height)
        this.needsFullRepaint = true
      }

      renderToBuffer(this.rootNode, this.backBuffer)

      if (this.debug) {
        this.writeDebugOutput()
      } else if (this.needsFullRepaint) {
        this.writeFullFrame()
        this.needsFullRepaint = false
      } else {
        this.writeDiffFrame()
      }

      // Swap buffers. The new back buffer (formerly front) will be cleared by
      // the next renderToBuffer call, so no clear is needed here.
      const tmp = this.frontBuffer
      this.frontBuffer = this.backBuffer
      this.backBuffer = tmp
      return
    }

    // Normal screen mode — render the FULL content height (no viewport cap)
    // and emit it via relative cursor positioning so any rows that don't fit
    // in the viewport scroll naturally into the terminal's scrollback. This
    // is what makes overflowed content scrollable.
    const height = Math.max(1, outputHeight)
    if (this.backBuffer.width !== cols || this.backBuffer.height !== height) {
      this.backBuffer = createScreenBuffer(cols, height)
    }

    renderToBuffer(this.rootNode, this.backBuffer)

    if (this.debug) {
      this.writeDebugOutput()
    } else {
      this.writeRelativeFrame(viewportRows)
    }
  }

  private writeDebugOutput(): void {
    const lines: string[] = []
    for (let row = 0; row < this.backBuffer.height; row++) {
      let line = ''
      for (let col = 0; col < this.backBuffer.width; col++) {
        line += this.backBuffer.cells[row]![col]!.char
      }
      lines.push(line.trimEnd())
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    this.stdout.write(lines.join('\n'))
  }

  private writeFullFrame(): void {
    const output = serializeFullFrame(this.backBuffer)
    // eraseDown() clears everything below the rendered content so stale rows
    // from a taller previous frame (e.g. a dismissed dialog) don't linger.
    this.stdout.write(cursorHide() + cursorTo(0, 0) + output + eraseDown())
  }

  private writeDiffFrame(): void {
    const patches = diffBuffers(this.frontBuffer, this.backBuffer)
    if (patches.length === 0) return
    const output = serializePatches(patches)
    this.stdout.write(output)
  }

  // Normal-screen frame writer: relative cursor positioning. Walks the cursor
  // back to the start of the previous live region (capped at viewport-1, since
  // anything older has scrolled into immutable scrollback), erases that region
  // with eraseDown, and emits the new buffer joined by `\r\n`. When the buffer
  // is taller than the viewport, the trailing newlines naturally push the top
  // rows into terminal scrollback so the user can scroll back to see them.
  private writeRelativeFrame(viewportRows: number): void {
    const buffer = this.backBuffer
    const body = serializeFrameRelative(buffer)

    let prefix = ''
    if (this.isFirstRender) {
      prefix += cursorHide()
    }

    if (this.liveRegionRows > 0) {
      // Cursor is currently parked at the end of the previous frame's last
      // row. `\r` returns to col 0, then walk up to the first live row.
      prefix += '\r'
      const moveUp = Math.min(this.liveRegionRows - 1, viewportRows - 1)
      if (moveUp > 0) prefix += cursorUp(moveUp)
      prefix += eraseDown()
    } else {
      // No prior live region — make sure we start at col 0. We deliberately
      // do NOT eraseDown here so we don't wipe whatever the user's shell had
      // on screen above the cursor.
      prefix += '\r'
    }

    this.stdout.write(prefix + body)
    this.liveRegionRows = Math.min(buffer.height, viewportRows)
  }
}
