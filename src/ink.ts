import { render, type Instance, type RenderOptions } from 'ink'
import type { ReactNode } from 'react'

export function createRoot(node: ReactNode, options?: RenderOptions): Instance {
  return render(node, options)
}

export { Box, Text, useInput, useApp, useStdin } from 'ink'
