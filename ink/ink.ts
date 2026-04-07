import type { ReactElement } from 'react'
import type { FiberRoot } from 'react-reconciler'
import { LegacyRoot } from 'react-reconciler/constants.js'
import { createReconciler, type InkReconciler } from './reconciler.js'
import { createDOMElement, type DOMElement } from './dom.js'
import type { ScreenBuffer } from './screen.js'
import { createScreenBuffer } from './screen.js'
import { renderToBuffer } from './output.js'
import { computeOutputHeight } from './render-node-to-output.js'
import { diffBuffers, serializePatches, serializeFullFrame } from './log-update.js'
import { cursorTo, cursorHide, cursorShow, resetStyle, eraseDown, bracketedPasteEnable, bracketedPasteDisable } from './termio/csi.js'
import { throttle } from './throttle.js'
import { FRAME_INTERVAL_MS } from './constants.js'

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

  private readonly exitPromise: Promise<void>
  private resolveExit!: () => void

  private readonly resizeHandler: () => void

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
      (error: Error) => { console.error('Ink uncaught error:', error) },
      (error: Error) => { console.error('Ink caught error:', error) },
      (error: Error) => { console.error('Ink recoverable error:', error) },
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
      queueMicrotask(() => this.throttledRender())
    }
    this.stdout.on('resize', this.resizeHandler)

    if (!this.debug) {
      this.stdout.write(bracketedPasteEnable())
    }
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

    if (!this.debug) {
      this.stdout.write(bracketedPasteDisable() + cursorShow() + resetStyle())
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
    const outputHeight = computeOutputHeight(this.rootNode)
    const height = Math.min(outputHeight, this.stdout.rows ?? 24)

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
}
