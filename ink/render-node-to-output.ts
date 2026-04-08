import type { DOMElement, DOMTextNode, DOMNode } from './dom.js'
import { isTextNode, collectText } from './dom.js'
import type { ScreenBuffer, CellStyle } from './screen.js'
import { writeCell } from './screen.js'
import type { StyleProps, BorderStyleName } from './styles.js'
import { borderStyles } from './styles.js'
import { Edge } from './layout/yoga.js'
import { setNodeRect } from './mouse/node-cache.js'

// ---------------------------------------------------------------------------
// Clip region for overflow: hidden
// ---------------------------------------------------------------------------

interface ClipRegion {
  x: number
  y: number
  width: number
  height: number
}

function intersectClip(a: ClipRegion, b: ClipRegion): ClipRegion {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

// ---------------------------------------------------------------------------
// Style inheritance for text nodes
// ---------------------------------------------------------------------------

function mergeTextStyle(parent: CellStyle, child: StyleProps): CellStyle {
  return {
    color: child.color ?? parent.color,
    backgroundColor: child.backgroundColor ?? parent.backgroundColor,
    bold: child.bold ?? parent.bold,
    italic: child.italic ?? parent.italic,
    underline: child.underline ?? parent.underline,
    strikethrough: child.strikethrough ?? parent.strikethrough,
    inverse: child.inverse ?? parent.inverse,
    dimColor: child.dimColor ?? parent.dimColor,
  }
}

// ---------------------------------------------------------------------------
// Render borders
// ---------------------------------------------------------------------------

function renderBorders(
  buffer: ScreenBuffer,
  element: DOMElement,
  absX: number,
  absY: number,
  clip: ClipRegion,
): void {
  const style = element.style
  if (!style.borderStyle) return

  const chars = borderStyles[style.borderStyle as BorderStyleName]
  if (!chars) return

  const w = Math.floor(element.yogaNode.getComputedWidth())
  const h = Math.floor(element.yogaNode.getComputedHeight())
  const borderColor = style.borderColor
  const cellStyle: CellStyle = { color: borderColor }

  const showTop = style.borderTop !== false
  const showBottom = style.borderBottom !== false
  const showLeft = style.borderLeft !== false
  const showRight = style.borderRight !== false

  // Top border
  if (showTop) {
    for (let col = 0; col < w; col++) {
      const cx = absX + col
      const cy = absY
      if (cx >= clip.x && cx < clip.x + clip.width && cy >= clip.y && cy < clip.y + clip.height) {
        let ch = chars.horizontal
        if (col === 0 && showLeft) ch = chars.topLeft
        else if (col === w - 1 && showRight) ch = chars.topRight
        writeCell(buffer, cx, cy, ch, cellStyle)
      }
    }
  }

  // Bottom border
  if (showBottom) {
    for (let col = 0; col < w; col++) {
      const cx = absX + col
      const cy = absY + h - 1
      if (cx >= clip.x && cx < clip.x + clip.width && cy >= clip.y && cy < clip.y + clip.height) {
        let ch = chars.horizontal
        if (col === 0 && showLeft) ch = chars.bottomLeft
        else if (col === w - 1 && showRight) ch = chars.bottomRight
        writeCell(buffer, cx, cy, ch, cellStyle)
      }
    }
  }

  // Left border
  if (showLeft) {
    for (let row = 1; row < h - 1; row++) {
      const cx = absX
      const cy = absY + row
      if (cx >= clip.x && cx < clip.x + clip.width && cy >= clip.y && cy < clip.y + clip.height) {
        writeCell(buffer, cx, cy, chars.vertical, cellStyle)
      }
    }
  }

  // Right border
  if (showRight) {
    for (let row = 1; row < h - 1; row++) {
      const cx = absX + w - 1
      const cy = absY + row
      if (cx >= clip.x && cx < clip.x + clip.width && cy >= clip.y && cy < clip.y + clip.height) {
        writeCell(buffer, cx, cy, chars.vertical, cellStyle)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Render text content into buffer
// ---------------------------------------------------------------------------

function renderText(
  buffer: ScreenBuffer,
  text: string,
  startX: number,
  startY: number,
  maxWidth: number,
  style: CellStyle,
  clip: ClipRegion,
): void {
  const lines = text.split('\n')
  let row = startY

  for (const line of lines) {
    if (row >= clip.y + clip.height) break

    // Simple character-level wrapping
    let col = startX
    for (let i = 0; i < line.length; i++) {
      if (col >= startX + maxWidth) {
        row++
        col = startX
        if (row >= clip.y + clip.height) break
      }

      if (col >= clip.x && col < clip.x + clip.width && row >= clip.y && row < clip.y + clip.height) {
        writeCell(buffer, col, row, line[i]!, style)
      }
      col++
    }
    row++
  }
}

// ---------------------------------------------------------------------------
// Recursive tree walker
// ---------------------------------------------------------------------------

export function renderNodeToOutput(
  node: DOMNode,
  buffer: ScreenBuffer,
  absX: number,
  absY: number,
  clip: ClipRegion,
  inheritedStyle: CellStyle,
): void {
  if (isTextNode(node)) {
    // Text nodes are rendered by their parent ink-text element
    return
  }

  const element = node
  const yoga = element.yogaNode
  const x = absX + yoga.getComputedLeft()
  const y = absY + yoga.getComputedTop()
  const w = Math.floor(yoga.getComputedWidth())
  const h = Math.floor(yoga.getComputedHeight())

  if (w <= 0 || h <= 0) return

  // Cache absolute screen rect so the mouse hit-tester can locate this node.
  // We record before recursing so children appear after their parent in the
  // cache, and we use absolute (post-translation) coordinates because
  // hit-test inputs arrive in absolute screen cells.
  setNodeRect(element, { x, y, width: w, height: h })

  // Apply overflow clipping
  let childClip = clip
  if (element.style.overflow === 'hidden') {
    childClip = intersectClip(clip, { x, y, width: w, height: h })
  }

  // Render borders
  renderBorders(buffer, element, x, y, childClip)

  // Compute content area (inside padding + border)
  const padTop = yoga.getComputedPadding(Edge.Top) + yoga.getComputedBorder(Edge.Top)
  const padLeft = yoga.getComputedPadding(Edge.Left) + yoga.getComputedBorder(Edge.Left)
  const padRight = yoga.getComputedPadding(Edge.Right) + yoga.getComputedBorder(Edge.Right)
  const padBottom = yoga.getComputedPadding(Edge.Bottom) + yoga.getComputedBorder(Edge.Bottom)

  const contentX = x + padLeft
  const contentY = y + padTop
  const contentW = Math.max(0, w - padLeft - padRight)

  // For text elements, collect and render text
  if (element.nodeName === 'ink-text' || element.nodeName === 'ink-virtual-text') {
    const textStyle = mergeTextStyle(inheritedStyle, element.style)
    const text = collectText(element)
    renderText(buffer, text, contentX, contentY, contentW, textStyle, childClip)
    return
  }

  // For box elements, recurse into children
  const boxStyle = mergeTextStyle(inheritedStyle, element.style)
  for (const child of element.childNodes) {
    renderNodeToOutput(child, buffer, contentX, contentY, childClip, boxStyle)
  }
}

// ---------------------------------------------------------------------------
// Top-level render: compute actual output height from DOM tree
// ---------------------------------------------------------------------------

export function computeOutputHeight(root: DOMElement): number {
  return Math.ceil(root.yogaNode.getComputedHeight())
}
