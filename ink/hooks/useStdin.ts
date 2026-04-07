import { useContext } from 'react'
import { StdinContext, type StdinContextValue } from '../components/contexts.js'

export function useStdin(): StdinContextValue {
  return useContext(StdinContext)
}
