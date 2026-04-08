import type { DOMElement } from '../dom.js'
import { isTextNode } from '../dom.js'
import { ClickEvent } from './types.js'
import { getNodeRect } from './node-cache.js'

// ---------------------------------------------------------------------------
// Hit test — recursive tree walk filtered by the cached node-rect map.
//
// Why no spatial index? The renderer already walks the DOM tree post-layout
// every frame and knows each node's screen rect. We piggyback on that work
// by stashing rects into a WeakMap (see node-cache.ts) and walking the tree
// at click time. The walk is O(depth × siblings) — fine for terminal UIs.
//
// Subtle points:
//   - We traverse children in REVERSE order so siblings painted on top of
//     earlier siblings win the hit test (matches z-order).
//   - We skip subtrees with no cached rect, which naturally handles
//     `display: none` and detached subtrees without any extra flag.
//   - We return the hit node even if it has no onClick handler. The bubble
//     walk and (future) click-to-focus walk start from this node and climb.
// ---------------------------------------------------------------------------

export function hitTest(node: DOMElement, col: number, row: number): DOMElement | null {
  const rect = getNodeRect(node)
  if (!rect) return null
  if (col < rect.x || col >= rect.x + rect.width) return null
  if (row < rect.y || row >= rect.y + rect.height) return null

  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i]!
    if (isTextNode(child)) continue   // text nodes are not event targets
    const hit = hitTest(child, col, row)
    if (hit) return hit
  }

  return node
}

// ---------------------------------------------------------------------------
// Dispatch click — bubble onClick from the hit node up through parentNode.
//
// We use a plain while loop instead of a full two-phase capture/bubble
// dispatcher (the kind keyboard events use). Clicks in a terminal UI don't
// need the capture phase, and the simpler shape is easier to reason about.
// A full Dispatcher with React priority scheduling is a worthwhile refactor
// later — see the split-out tech-debt task.
// ---------------------------------------------------------------------------

export function dispatchClick(root: DOMElement, col: number, row: number): boolean {
  let target: DOMElement | null = hitTest(root, col, row)
  if (!target) return false

  const event = new ClickEvent(col, row)
  let handled = false

  while (target) {
    const handler = target._eventHandlers?.onClick
    if (handler) {
      handled = true
      // Recompute local coords so each handler sees coordinates relative to
      // its OWN node, not the original hit target. Lets a container ask
      // "which child cell?" without recomputing the rect itself.
      const rect = getNodeRect(target)
      if (rect) {
        event.localCol = col - rect.x
        event.localRow = row - rect.y
      }
      handler(event)
      if (event.isImmediatePropagationStopped) return true
    }
    target = target.parentNode
  }

  return handled
}

// ---------------------------------------------------------------------------
// Dispatch hover — diff against previously hovered set.
//
// The diff-vs-previous-set pattern is the important part. Comparing only the
// hit node old vs new would re-fire the parent's enter handler when the
// pointer moves between two children of the same parent — wrong. Instead, we
// compute the full set of currently-hovered ancestors that own enter/leave
// handlers, then take the symmetric difference against the previous set.
// ---------------------------------------------------------------------------

export function dispatchHover(
  root: DOMElement,
  col: number,
  row: number,
  hovered: Set<DOMElement>,   // mutated in place — caller owns the set
): void {
  // Build the new hovered path INNER → OUTER as an array. We need order
  // for the enter/leave fire sequence; the parallel Set is for O(1) lookup.
  const nextArr: DOMElement[] = []
  let node: DOMElement | null = hitTest(root, col, row)
  while (node) {
    const handlers = node._eventHandlers
    if (handlers && (handlers.onMouseEnter || handlers.onMouseLeave)) {
      nextArr.push(node)
    }
    node = node.parentNode
  }
  const nextSet = new Set(nextArr)

  // Leaves fire INNER → OUTER (child leaves before parent). `hovered` was
  // populated below in inner-to-outer order, so a forward iteration is the
  // right order. Skip detached nodes whose subtree has unmounted.
  for (const old of hovered) {
    if (nextSet.has(old)) continue
    if (old !== root && old.parentNode === null) continue
    old._eventHandlers?.onMouseLeave?.()
  }

  // Enters fire OUTER → INNER (parent enters before child). Walk the new
  // path in REVERSE (we built it inner-first, so reverse = outer-first).
  for (let i = nextArr.length - 1; i >= 0; i--) {
    const n = nextArr[i]!
    if (!hovered.has(n)) {
      n._eventHandlers?.onMouseEnter?.()
    }
  }

  // Replace `hovered` with the new set, preserving inner-to-outer insertion
  // order so the next call's leave-loop fires in the correct sequence.
  hovered.clear()
  for (const n of nextArr) hovered.add(n)
}
