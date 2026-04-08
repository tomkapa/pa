import type { DOMElement } from '../dom.js'

// ---------------------------------------------------------------------------
// Node-rect cache
//
// Populated by the renderer as it walks the DOM tree post-layout. Each entry
// records the absolute screen rectangle a node painted into. The hit-tester
// reads these rects to find the deepest node under a (col, row) point.
//
// WeakMap so removed DOM elements are collected automatically — no manual
// cleanup is required when nodes unmount.
// ---------------------------------------------------------------------------

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const nodeCache: WeakMap<DOMElement, Rect> = new WeakMap()

export function setNodeRect(node: DOMElement, rect: Rect): void {
  nodeCache.set(node, rect)
}

export function getNodeRect(node: DOMElement): Rect | undefined {
  return nodeCache.get(node)
}
