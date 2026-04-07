import { useCallback, useLayoutEffect, type ReactNode } from 'react'
import { AppContext, StdinContext, StdoutContext, InkContext, type AppContextValue, type StdinContextValue, type StdoutContextValue } from './contexts.js'
import type { Ink } from '../ink.js'

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
      if (exitOnCtrlC && String(data) === '\x03') {
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
