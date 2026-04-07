import type { DOMElement } from './dom.js'
import type { ScreenBuffer } from './screen.js'
import { clearScreenBuffer } from './screen.js'
import { renderNodeToOutput, computeOutputHeight } from './render-node-to-output.js'

export function renderToBuffer(root: DOMElement, buffer: ScreenBuffer): void {
  clearScreenBuffer(buffer)
  const height = computeOutputHeight(root)

  renderNodeToOutput(
    root,
    buffer,
    -root.yogaNode.getComputedLeft(),
    -root.yogaNode.getComputedTop(),
    { x: 0, y: 0, width: buffer.width, height: Math.min(height, buffer.height) },
    {},
  )
}
