import type { ReactNode } from 'react'
import type { StyleProps, BorderStyleName } from '../styles.js'

// ---------------------------------------------------------------------------
// Box props — maps to ink-box DOM element with Yoga layout
// ---------------------------------------------------------------------------

export interface BoxProps extends StyleProps {
  children?: ReactNode
}

export function Box({ children, ...props }: BoxProps) {
  return <ink-box {...props}>{children}</ink-box>
}
