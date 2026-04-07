import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Text props — maps to ink-text DOM element
// ---------------------------------------------------------------------------

export interface TextProps {
  children?: ReactNode
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
  dimColor?: boolean
  wrap?: 'wrap' | 'truncate' | 'truncate-end' | 'truncate-start' | 'truncate-middle'
}

export function Text({ children, ...props }: TextProps) {
  return <ink-text {...props}>{children}</ink-text>
}
