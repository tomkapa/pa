import { useContext } from 'react'
import { StdoutContext, type StdoutContextValue } from '../components/contexts.js'

export function useStdout(): StdoutContextValue {
  return useContext(StdoutContext)
}
