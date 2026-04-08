import { useCallback, useLayoutEffect, type ReactNode } from 'react'
import { AppContext, StdinContext, StdoutContext, InkContext, type AppContextValue, type StdinContextValue, type StdoutContextValue } from './contexts.js'
import type { Ink } from '../ink.js'

// Ctrl+C arrives as raw \x03 in classic mode, or as \x1b[99;5u under the
// Kitty keyboard protocol. Cheap byte/substring scans avoid running parseInput
// on every chunk just to detect this single keystroke.
const CTRL_C_BYTE = 0x03
const CTRL_C_KITTY = '\x1b[99;5u'

interface AppProps {
  children: ReactNode
  ink: Ink
  exitOnCtrlC: boolean
  onExit: (error?: Error) => void
}

export function App({ children, ink, exitOnCtrlC, onExit }: AppProps) {
  const stdin = ink.getStdin()
  const stdout = ink.getStdout()

  const exit = useCallback((error?: Error) => {
    onExit(error)
  }, [onExit])

  const setRawMode = useCallback((mode: boolean) => {
    if (typeof stdin.setRawMode !== 'function') return
    stdin.setRawMode(mode)
  }, [stdin])

  useLayoutEffect(() => {
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true)
      stdin.resume()
    }

    const handleData = (data: Buffer) => {
      if (!exitOnCtrlC) return
      if (data.includes(CTRL_C_BYTE) || String(data).includes(CTRL_C_KITTY)) {
        exit()
      }
    }

    stdin.on('data', handleData)

    return () => {
      stdin.removeListener('data', handleData)
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false)
        stdin.pause()
      }
    }
  }, [stdin, exit, exitOnCtrlC])

  const appValue: AppContextValue = { exit }

  const stdinValue: StdinContextValue = {
    stdin,
    isRawModeSupported: typeof stdin.setRawMode === 'function',
    setRawMode,
  }

  const stdoutValue: StdoutContextValue = {
    stdout,
    write: (data: string) => stdout.write(data),
  }

  return (
    <InkContext value={ink}>
      <AppContext value={appValue}>
        <StdinContext value={stdinValue}>
          <StdoutContext value={stdoutValue}>
            {children}
          </StdoutContext>
        </StdinContext>
      </AppContext>
    </InkContext>
  )
}
