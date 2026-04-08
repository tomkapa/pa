import type { ReactNode } from 'react'
import type { StyleProps } from '../styles.js'
import type { EventHandlers } from '../mouse/types.js'

// ---------------------------------------------------------------------------
// Box props — maps to ink-box DOM element with Yoga layout.
// EventHandlers (onClick / onMouseEnter / onMouseLeave) are stored on the
// underlying DOM element by the reconciler and consumed by the mouse
// dispatcher in `ink/mouse/dispatch.ts`.
// ---------------------------------------------------------------------------

export interface BoxProps extends StyleProps, EventHandlers {
  children?: ReactNode
}

export function Box({ children, ...props }: BoxProps) {
  return <ink-box {...props}>{children}</ink-box>
}
