import { YogaLayoutNode, Edge, FlexDirection, Gutter, Justify, Align, Wrap, Overflow, Display, PositionType } from './layout/yoga.js'
import type { StyleProps, FlexDirectionProp, JustifyProp, AlignProp, WrapProp, OverflowProp, DisplayProp, PositionProp } from './styles.js'
import { MeasureMode } from 'yoga-layout'

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export type InkNodeName =
  | 'ink-root'
  | 'ink-box'
  | 'ink-text'
  | 'ink-virtual-text'

export interface DOMElement {
  nodeName: InkNodeName
  style: StyleProps
  yogaNode: YogaLayoutNode
  parentNode: DOMElement | null
  childNodes: Array<DOMElement | DOMTextNode>
  internal_static?: boolean
}

export interface DOMTextNode {
  nodeName: '#text'
  nodeValue: string
  yogaNode: YogaLayoutNode
  parentNode: DOMElement | null
}

export type DOMNode = DOMElement | DOMTextNode

export function isTextNode(node: DOMNode): node is DOMTextNode {
  return node.nodeName === '#text'
}

function isTextElement(node: DOMNode): boolean {
  return node.nodeName === 'ink-text' || node.nodeName === 'ink-virtual-text'
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function createDOMElement(nodeName: InkNodeName): DOMElement {
  const yogaNode = new YogaLayoutNode()
  const element: DOMElement = {
    nodeName,
    style: {},
    yogaNode,
    parentNode: null,
    childNodes: [],
  }

  // ink-box defaults to row direction (matching stock Ink behavior)
  if (nodeName === 'ink-box') {
    yogaNode.setFlexDirection(FlexDirection.Row)
  }

  // ink-text elements are leaf nodes in Yoga — they measure their own text
  if (nodeName === 'ink-text') {
    yogaNode.setMeasureFunc((width, widthMode) => {
      const text = collectText(element)
      if (text.length === 0) {
        return { width: 0, height: 0 }
      }
      const maxWidth = widthMode === MeasureMode.Undefined ? Infinity : width
      return measureText(text, maxWidth)
    })
  }

  return element
}

export function createDOMTextNode(text: string): DOMTextNode {
  const yogaNode = new YogaLayoutNode()
  return {
    nodeName: '#text',
    nodeValue: text,
    yogaNode,
    parentNode: null,
  }
}

// ---------------------------------------------------------------------------
// Text measurement (word-wrap aware)
// ---------------------------------------------------------------------------

export function measureText(text: string, maxWidth: number): { width: number; height: number } {
  const lines = text.split('\n')
  let height = 0
  let widthUsed = 0

  for (const line of lines) {
    if (line.length === 0) {
      height += 1
      continue
    }

    if (maxWidth === Infinity || line.length <= maxWidth) {
      height += 1
      widthUsed = Math.max(widthUsed, line.length)
    } else {
      const wrappedLines = Math.ceil(line.length / Math.max(1, maxWidth))
      height += wrappedLines
      widthUsed = Math.max(widthUsed, Math.min(line.length, maxWidth))
    }
  }

  return { width: widthUsed, height: Math.max(1, height) }
}

// ---------------------------------------------------------------------------
// Tree manipulation
//
// Key insight: ink-text elements are leaf nodes in Yoga. Their children
// (#text nodes and ink-virtual-text) are tracked in the DOM tree for text
// collection but NOT added to the Yoga tree. Only ink-box children
// participate in Yoga layout.
// ---------------------------------------------------------------------------

function isInsideTextElement(parent: DOMElement): boolean {
  return isTextElement(parent)
}

export function appendChild(parent: DOMElement, child: DOMNode): void {
  if (child.parentNode) {
    removeChild(child.parentNode, child)
  }

  child.parentNode = parent
  parent.childNodes.push(child)

  // Only add to Yoga tree if parent is not a text element
  if (!isInsideTextElement(parent)) {
    parent.yogaNode.insertChild(child.yogaNode, parent.yogaNode.getChildCount())
  } else {
    // Mark the text element's yoga node as dirty so it re-measures
    markTextDirty(parent)
  }
}

export function insertBefore(parent: DOMElement, child: DOMNode, beforeChild: DOMNode): void {
  if (child.parentNode) {
    removeChild(child.parentNode, child)
  }

  const index = parent.childNodes.indexOf(beforeChild)
  if (index < 0) {
    appendChild(parent, child)
    return
  }

  child.parentNode = parent
  parent.childNodes.splice(index, 0, child)

  if (!isInsideTextElement(parent)) {
    parent.yogaNode.insertChild(child.yogaNode, index)
  } else {
    markTextDirty(parent)
  }
}

export function removeChild(parent: DOMElement, child: DOMNode): void {
  const insideText = isInsideTextElement(parent)
  if (!insideText) {
    parent.yogaNode.removeChild(child.yogaNode)
  }
  const index = parent.childNodes.indexOf(child)
  if (index >= 0) {
    parent.childNodes.splice(index, 1)
  }
  child.parentNode = null

  if (insideText) {
    markTextDirty(parent)
  }
}

export function freeNode(node: DOMNode): void {
  if (!isTextNode(node)) {
    for (const child of [...node.childNodes]) {
      freeNode(child)
    }
  }
  node.yogaNode.free()
}

// ---------------------------------------------------------------------------
// Find the nearest ink-text ancestor and mark it dirty
// ---------------------------------------------------------------------------

function markTextDirty(node: DOMElement): void {
  // Walk up to find the top-level ink-text (the one with the measureFunc)
  let current: DOMElement | null = node
  while (current) {
    if (current.nodeName === 'ink-text') {
      current.yogaNode.markDirty()
      return
    }
    current = current.parentNode
  }
}

export function markTextNodeDirty(node: DOMTextNode): void {
  // Walk up to find the nearest ink-text
  let current: DOMElement | null = node.parentNode
  while (current) {
    if (current.nodeName === 'ink-text') {
      current.yogaNode.markDirty()
      return
    }
    current = current.parentNode
  }
}

// ---------------------------------------------------------------------------
// Style application → Yoga node
// ---------------------------------------------------------------------------

const flexDirectionMap: Record<FlexDirectionProp, FlexDirection> = {
  'row': FlexDirection.Row,
  'column': FlexDirection.Column,
  'row-reverse': FlexDirection.RowReverse,
  'column-reverse': FlexDirection.ColumnReverse,
}

const justifyMap: Record<JustifyProp, Justify> = {
  'flex-start': Justify.FlexStart,
  'center': Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
}

const alignMap: Record<Exclude<AlignProp, 'auto'>, Align> = {
  'flex-start': Align.FlexStart,
  'center': Align.Center,
  'flex-end': Align.FlexEnd,
  'stretch': Align.Stretch,
  'baseline': Align.Baseline,
}

const wrapMap: Record<WrapProp, Wrap> = {
  'nowrap': Wrap.NoWrap,
  'wrap': Wrap.Wrap,
  'wrap-reverse': Wrap.WrapReverse,
}

const overflowMap: Record<OverflowProp, Overflow> = {
  'visible': Overflow.Visible,
  'hidden': Overflow.Hidden,
}

const displayMap: Record<DisplayProp, Display> = {
  'flex': Display.Flex,
  'none': Display.None,
}

const positionMap: Record<PositionProp, PositionType> = {
  'relative': PositionType.Relative,
  'absolute': PositionType.Absolute,
}

export function applyStyles(element: DOMElement, style: StyleProps): void {
  element.style = { ...element.style, ...style }
  const yoga = element.yogaNode

  if (style.flexDirection !== undefined) {
    yoga.setFlexDirection(flexDirectionMap[style.flexDirection])
  }

  if (style.flexGrow !== undefined) yoga.setFlexGrow(style.flexGrow)
  if (style.flexShrink !== undefined) yoga.setFlexShrink(style.flexShrink)
  if (style.flexBasis !== undefined) yoga.setFlexBasis(style.flexBasis)

  if (style.flexWrap !== undefined) {
    yoga.setFlexWrap(wrapMap[style.flexWrap])
  }

  if (style.justifyContent !== undefined) {
    yoga.setJustifyContent(justifyMap[style.justifyContent])
  }

  if (style.alignItems !== undefined) {
    if (style.alignItems === 'auto') {
      yoga.setAlignItems(Align.Auto)
    } else {
      yoga.setAlignItems(alignMap[style.alignItems])
    }
  }

  if (style.alignSelf !== undefined) {
    if (style.alignSelf === 'auto') {
      yoga.setAlignSelf(Align.Auto)
    } else {
      yoga.setAlignSelf(alignMap[style.alignSelf])
    }
  }

  // Gap
  if (style.gap !== undefined) yoga.setGap(Gutter.All, style.gap)
  if (style.columnGap !== undefined) yoga.setGap(Gutter.Column, style.columnGap)
  if (style.rowGap !== undefined) yoga.setGap(Gutter.Row, style.rowGap)

  // Dimensions
  if (style.width !== undefined) yoga.setWidth(style.width)
  if (style.height !== undefined) yoga.setHeight(style.height)
  if (style.minWidth !== undefined) yoga.setMinWidth(style.minWidth)
  if (style.minHeight !== undefined) yoga.setMinHeight(style.minHeight)
  if (style.maxWidth !== undefined) yoga.setMaxWidth(style.maxWidth)
  if (style.maxHeight !== undefined) yoga.setMaxHeight(style.maxHeight)

  // Padding — shorthand first, then specific edges (specifics override shorthand)
  if (style.padding !== undefined) yoga.setPadding(Edge.All, style.padding)
  if (style.paddingX !== undefined) yoga.setPadding(Edge.Horizontal, style.paddingX)
  if (style.paddingY !== undefined) yoga.setPadding(Edge.Vertical, style.paddingY)
  if (style.paddingTop !== undefined) yoga.setPadding(Edge.Top, style.paddingTop)
  if (style.paddingBottom !== undefined) yoga.setPadding(Edge.Bottom, style.paddingBottom)
  if (style.paddingLeft !== undefined) yoga.setPadding(Edge.Left, style.paddingLeft)
  if (style.paddingRight !== undefined) yoga.setPadding(Edge.Right, style.paddingRight)

  // Margin
  if (style.margin !== undefined) yoga.setMargin(Edge.All, style.margin)
  if (style.marginX !== undefined) yoga.setMargin(Edge.Horizontal, style.marginX)
  if (style.marginY !== undefined) yoga.setMargin(Edge.Vertical, style.marginY)
  if (style.marginTop !== undefined) yoga.setMargin(Edge.Top, style.marginTop)
  if (style.marginBottom !== undefined) yoga.setMargin(Edge.Bottom, style.marginBottom)
  if (style.marginLeft !== undefined) yoga.setMargin(Edge.Left, style.marginLeft)
  if (style.marginRight !== undefined) yoga.setMargin(Edge.Right, style.marginRight)

  // Border (Yoga needs border width for layout; visual border is handled by renderer)
  if (style.borderStyle !== undefined) {
    const w = 1
    const bTop = style.borderTop !== false
    const bBottom = style.borderBottom !== false
    const bLeft = style.borderLeft !== false
    const bRight = style.borderRight !== false
    yoga.setBorder(Edge.Top, bTop ? w : 0)
    yoga.setBorder(Edge.Bottom, bBottom ? w : 0)
    yoga.setBorder(Edge.Left, bLeft ? w : 0)
    yoga.setBorder(Edge.Right, bRight ? w : 0)
  }

  // Overflow / display / position
  if (style.overflow !== undefined) yoga.setOverflow(overflowMap[style.overflow])
  if (style.display !== undefined) yoga.setDisplay(displayMap[style.display])
  if (style.position !== undefined) yoga.setPositionType(positionMap[style.position])
}

// ---------------------------------------------------------------------------
// Collect text content from a text subtree
// ---------------------------------------------------------------------------

export function collectText(node: DOMNode): string {
  if (isTextNode(node)) return node.nodeValue
  return node.childNodes.map(collectText).join('')
}
