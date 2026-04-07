import { createContext } from 'react'
import type { Ink } from '../ink.js'

// ---------------------------------------------------------------------------
// App context — provides exit functionality
// ---------------------------------------------------------------------------

export interface AppContextValue {
  exit: (error?: Error) => void
}

export const AppContext = createContext<AppContextValue>({
  exit: () => {},
})

// ---------------------------------------------------------------------------
// Stdin context — provides raw input access
// ---------------------------------------------------------------------------

export interface StdinContextValue {
  stdin: NodeJS.ReadStream
  isRawModeSupported: boolean
  setRawMode: (mode: boolean) => void
}

export const StdinContext = createContext<StdinContextValue>({
  stdin: process.stdin,
  isRawModeSupported: false,
  setRawMode: () => {},
})

// ---------------------------------------------------------------------------
// Stdout context — provides write access and dimensions
// ---------------------------------------------------------------------------

export interface StdoutContextValue {
  stdout: NodeJS.WriteStream
  write: (data: string) => void
}

export const StdoutContext = createContext<StdoutContextValue>({
  stdout: process.stdout,
  write: () => {},
})

// ---------------------------------------------------------------------------
// Internal Ink instance context
// ---------------------------------------------------------------------------

export const InkContext = createContext<Ink | null>(null)
