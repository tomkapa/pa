import { render, type Instance, type RenderOptions } from '../ink/index.js'
import type { ReactNode } from 'react'

export function createRoot(node: ReactNode, options?: RenderOptions): Instance {
  return render(node, options)
}

export { Box, Text, useInput, useApp, useStdin } from '../ink/index.js'
