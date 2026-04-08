import type { ReactNode, Key } from 'react'
import type { StyleProps } from './styles.ts'
import type { EventHandlers } from './mouse/types.ts'

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': StyleProps & EventHandlers & { children?: ReactNode; internal_static?: boolean; key?: Key }
      'ink-text': Partial<StyleProps> & { children?: ReactNode; key?: Key }
      'ink-virtual-text': Partial<StyleProps> & { children?: ReactNode; key?: Key }
    }
  }
}
