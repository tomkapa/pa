import { type ReactNode, useContext, useInsertionEffect } from 'react'
import { InkContext } from './contexts.js'
import { useStdout } from '../hooks/useStdout.js'
import { decset, decreset, enableMouseTracking, disableMouseTracking } from '../termio/dec.js'
import { eraseScreen, cursorHome } from '../termio/csi.js'
import { Box } from './Box.js'

export interface AlternateScreenProps {
  children?: ReactNode
  mouseTracking?: boolean
}

export function AlternateScreen({ children, mouseTracking = false }: AlternateScreenProps) {
  const { stdout } = useStdout()
  const ink = useContext(InkContext)

  // useInsertionEffect fires synchronously before React paints anything.
  // This ensures the terminal switches to alt-screen before any content is
  // rendered, preventing a single-frame flash on the main screen.
  useInsertionEffect(() => {
    stdout.write(decset(1049) + eraseScreen() + cursorHome() + (mouseTracking ? enableMouseTracking() : ''))
    ink?.setAltScreen(true)

    return () => {
      stdout.write((mouseTracking ? disableMouseTracking() : '') + decreset(1049))
      ink?.setAltScreen(false)
    }
  }, [])

  // Constrain content height to terminal viewport so layout fills the screen.
  return <Box height="100%">{children}</Box>
}
