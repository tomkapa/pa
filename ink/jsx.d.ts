import type { ReactNode, Key } from 'react'
import type { StyleProps } from './styles.ts'

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': StyleProps & { children?: ReactNode; internal_static?: boolean; key?: Key }
      'ink-text': Partial<StyleProps> & { children?: ReactNode; key?: Key }
      'ink-virtual-text': Partial<StyleProps> & { children?: ReactNode; key?: Key }
    }
  }
}
