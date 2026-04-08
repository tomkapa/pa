import { describe, it, expect, beforeEach } from 'bun:test'
import { createDOMElement, appendChild, type DOMElement } from '../dom.js'
import { setNodeRect } from './node-cache.js'
import { hitTest, dispatchClick, dispatchHover } from './dispatch.js'
import { ClickEvent, type EventHandlers } from './types.js'

// ---------------------------------------------------------------------------
// Helpers — manually build a DOM tree and seed the rect cache. The Yoga
// layout pass is not exercised here; we want pure logic tests of hit-testing
// and dispatch behaviour.
// ---------------------------------------------------------------------------

function makeBox(rect: { x: number; y: number; width: number; height: number }, handlers?: EventHandlers): DOMElement {
  const el = createDOMElement('ink-box')
  setNodeRect(el, rect)
  if (handlers) el._eventHandlers = handlers
  return el
}

describe('hitTest', () => {
  it('returns null when point is outside root rect', () => {
    const root = makeBox({ x: 0, y: 0, width: 10, height: 5 })
    expect(hitTest(root, 20, 20)).toBeNull()
  })

  it('returns the root when point is inside root with no children', () => {
    const root = makeBox({ x: 0, y: 0, width: 10, height: 5 })
    expect(hitTest(root, 5, 2)).toBe(root)
  })

  it('returns the deepest matching child', () => {
    const root = makeBox({ x: 0, y: 0, width: 20, height: 10 })
    const inner = makeBox({ x: 5, y: 2, width: 5, height: 3 })
    appendChild(root, inner)
    expect(hitTest(root, 6, 3)).toBe(inner)
  })

  it('returns the topmost (last-painted) sibling when overlapping', () => {
    const root = makeBox({ x: 0, y: 0, width: 20, height: 10 })
    const a = makeBox({ x: 5, y: 2, width: 5, height: 3 })
    const b = makeBox({ x: 5, y: 2, width: 5, height: 3 })
    appendChild(root, a)
    appendChild(root, b)
    // `b` is appended after `a`, so it's painted on top → reverse-order walk
    // hits it first.
    expect(hitTest(root, 6, 3)).toBe(b)
  })

  it('skips subtrees with no cached rect (e.g. display: none)', () => {
    const root = makeBox({ x: 0, y: 0, width: 20, height: 10 })
    const hidden = createDOMElement('ink-box')   // no setNodeRect
    appendChild(root, hidden)
    // Hidden subtree is invisible to hit-test, but root still matches.
    expect(hitTest(root, 5, 5)).toBe(root)
  })

  it('returns the hit node even when it has no onClick handler', () => {
    const root = makeBox({ x: 0, y: 0, width: 20, height: 10 })
    const inner = makeBox({ x: 1, y: 1, width: 5, height: 3 })   // no handler
    appendChild(root, inner)
    expect(hitTest(root, 2, 2)).toBe(inner)
  })
})

describe('dispatchClick', () => {
  let root: DOMElement
  let outer: DOMElement
  let inner: DOMElement
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    root = makeBox({ x: 0, y: 0, width: 30, height: 10 })
    outer = makeBox({ x: 5, y: 1, width: 20, height: 8 }, {
      onClick: () => { calls.push('outer') },
    })
    inner = makeBox({ x: 8, y: 3, width: 6, height: 2 }, {
      onClick: () => { calls.push('inner') },
    })
    appendChild(root, outer)
    appendChild(outer, inner)
  })

  it('returns false when click misses everything', () => {
    expect(dispatchClick(root, 100, 100)).toBe(false)
    expect(calls).toEqual([])
  })

  it('bubbles a click from inner to outer', () => {
    expect(dispatchClick(root, 9, 4)).toBe(true)
    expect(calls).toEqual(['inner', 'outer'])
  })

  it('stopImmediatePropagation halts the bubble walk', () => {
    inner._eventHandlers = {
      onClick: (e: ClickEvent) => {
        calls.push('inner')
        e.stopImmediatePropagation()
      },
    }
    expect(dispatchClick(root, 9, 4)).toBe(true)
    expect(calls).toEqual(['inner'])
  })

  it('rewrites localCol/localRow per handler', () => {
    const seen: Array<{ name: string; localCol: number; localRow: number }> = []
    inner._eventHandlers = {
      onClick: (e: ClickEvent) => seen.push({ name: 'inner', localCol: e.localCol, localRow: e.localRow }),
    }
    outer._eventHandlers = {
      onClick: (e: ClickEvent) => seen.push({ name: 'outer', localCol: e.localCol, localRow: e.localRow }),
    }
    dispatchClick(root, 9, 4)
    // inner rect.x=8, rect.y=3 → local (1, 1)
    // outer rect.x=5, rect.y=1 → local (4, 3)
    expect(seen).toEqual([
      { name: 'inner', localCol: 1, localRow: 1 },
      { name: 'outer', localCol: 4, localRow: 3 },
    ])
  })

  it('returns false when click hits a node but no ancestor has onClick', () => {
    const bareRoot = makeBox({ x: 0, y: 0, width: 10, height: 5 })
    const bareChild = makeBox({ x: 1, y: 1, width: 3, height: 2 })
    appendChild(bareRoot, bareChild)
    expect(dispatchClick(bareRoot, 2, 2)).toBe(false)
  })
})

describe('dispatchHover', () => {
  let root: DOMElement
  let parent: DOMElement
  let childA: DOMElement
  let childB: DOMElement
  let calls: string[]

  beforeEach(() => {
    calls = []
    root = makeBox({ x: 0, y: 0, width: 30, height: 10 })
    parent = makeBox({ x: 0, y: 0, width: 30, height: 10 }, {
      onMouseEnter: () => calls.push('parent-enter'),
      onMouseLeave: () => calls.push('parent-leave'),
    })
    childA = makeBox({ x: 0, y: 0, width: 5, height: 3 }, {
      onMouseEnter: () => calls.push('A-enter'),
      onMouseLeave: () => calls.push('A-leave'),
    })
    childB = makeBox({ x: 10, y: 0, width: 5, height: 3 }, {
      onMouseEnter: () => calls.push('B-enter'),
      onMouseLeave: () => calls.push('B-leave'),
    })
    appendChild(root, parent)
    appendChild(parent, childA)
    appendChild(parent, childB)
  })

  it('fires enter on first hover into the tree', () => {
    const hovered = new Set<DOMElement>()
    dispatchHover(root, 1, 1, hovered)
    expect(calls).toEqual(['parent-enter', 'A-enter'])
  })

  it('does NOT re-fire parent enter when moving between sibling children', () => {
    const hovered = new Set<DOMElement>()
    dispatchHover(root, 1, 1, hovered)        // → A
    calls.length = 0
    dispatchHover(root, 11, 1, hovered)       // → B
    expect(calls).toEqual(['A-leave', 'B-enter'])
  })

  it('fires leave when pointer moves out of the tree', () => {
    const hovered = new Set<DOMElement>()
    dispatchHover(root, 1, 1, hovered)        // → A
    calls.length = 0
    dispatchHover(root, 100, 100, hovered)    // → outside
    expect(calls).toEqual(['A-leave', 'parent-leave'])
  })

  it('does not fire enter twice on idempotent hover', () => {
    const hovered = new Set<DOMElement>()
    dispatchHover(root, 1, 1, hovered)
    calls.length = 0
    dispatchHover(root, 1, 1, hovered)
    expect(calls).toEqual([])
  })
})
