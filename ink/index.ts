import type { ReactNode } from 'react'
import { createElement } from 'react'
import { Ink, type InkOptions } from './ink.js'
import { App } from './components/App.js'

// ---------------------------------------------------------------------------
// Public API — matches stock Ink's render() interface
// ---------------------------------------------------------------------------

export interface RenderOptions {
  stdout?: NodeJS.WriteStream
  stdin?: NodeJS.ReadStream
  stderr?: NodeJS.WriteStream
  exitOnCtrlC?: boolean
  patchConsole?: boolean
  debug?: boolean
}

export interface Instance {
  rerender: (tree: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
  cleanup: () => void
}

export function render(tree: ReactNode, options?: RenderOptions): Instance {
  const stdout = options?.stdout ?? process.stdout
  const stdin = options?.stdin ?? process.stdin
  const exitOnCtrlC = options?.exitOnCtrlC ?? true
  const debug = options?.debug ?? false

  const ink = new Ink({
    stdout: stdout as NodeJS.WriteStream,
    stdin: stdin as NodeJS.ReadStream,
    stderr: options?.stderr as NodeJS.WriteStream | undefined,
    exitOnCtrlC,
    patchConsole: options?.patchConsole,
    debug,
  })

  const renderApp = (element: ReactNode) => {
    ink.render(
      createElement(App, {
        ink,
        exitOnCtrlC,
        onExit: () => ink.unmount(),
        children: element,
      }),
    )
  }

  renderApp(tree)

  return {
    rerender: renderApp,
    unmount: () => ink.unmount(),
    waitUntilExit: () => ink.waitUntilExit(),
    cleanup: () => ink.unmount(),
  }
}

// ---------------------------------------------------------------------------
// Component re-exports
// ---------------------------------------------------------------------------

export { Box, type BoxProps } from './components/Box.js'
export { Text, type TextProps } from './components/Text.js'
export { AlternateScreen, type AlternateScreenProps } from './components/AlternateScreen.js'

// ---------------------------------------------------------------------------
// Hook re-exports
// ---------------------------------------------------------------------------

export { useInput, type Key, type InputHandler, type UseInputOptions } from './hooks/useInput.js'
export { useApp } from './hooks/useApp.js'
export { useStdin } from './hooks/useStdin.js'
export { useStdout } from './hooks/useStdout.js'

// ---------------------------------------------------------------------------
// Type re-exports
// ---------------------------------------------------------------------------

export type { StyleProps } from './styles.js'
export type { DOMElement, DOMTextNode } from './dom.js'
export type { ParsedMouse, EventHandlers } from './mouse/types.js'
export { ClickEvent } from './mouse/types.js'
