import { useContext } from 'react'
import { AppContext, type AppContextValue } from '../components/contexts.js'

export function useApp(): AppContextValue {
  return useContext(AppContext)
}
