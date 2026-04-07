import Reconciler from 'react-reconciler'
import { DefaultEventPriority } from 'react-reconciler/constants.js'
import type { DOMElement, DOMTextNode, DOMNode } from './dom.js'
import { createDOMElement, createDOMTextNode, appendChild, insertBefore, removeChild, freeNode, applyStyles, markTextNodeDirty } from './dom.js'
import { STYLE_KEYS, type StyleProps } from './styles.js'

// ---------------------------------------------------------------------------
// Host context — tracks whether we're inside a <Text> element
// ---------------------------------------------------------------------------

interface HostContext {
  isInsideText: boolean
}

const ROOT_HOST_CONTEXT: HostContext = { isInsideText: false }
const TEXT_HOST_CONTEXT: HostContext = { isInsideText: true }

// ---------------------------------------------------------------------------
// Props extraction
// ---------------------------------------------------------------------------

type Props = Record<string, unknown>

function extractStyleProps(props: Props): StyleProps {
  const style: StyleProps = {}
  for (const key of STYLE_KEYS) {
    if (key in props) {
      ;(style as Record<string, unknown>)[key] = props[key]
    }
  }
  return style
}

// ---------------------------------------------------------------------------
// Reconciler host config
// ---------------------------------------------------------------------------

export type InkReconciler = Reconciler.Reconciler<
  DOMElement,  // container
  DOMElement,  // instance
  DOMTextNode, // text instance
  DOMElement,  // suspense instance
  DOMElement,  // form instance
  DOMElement   // public instance
>

export function createReconciler(
  onCommit: () => void,
): InkReconciler {
  const hostConfig: Reconciler.HostConfig<
    string,        // type
    Props,         // props
    DOMElement,    // container
    DOMElement,    // instance
    DOMTextNode,   // text instance
    DOMElement,    // suspense instance
    DOMElement,    // hydration instance
    DOMElement,    // form instance
    DOMElement,    // public instance
    HostContext,   // host context
    DOMElement[],  // child set (unused — mutation mode)
    number,        // timeout handle
    -1,            // no timeout
    string         // transition status
  > = {
    supportsMutation: true,
    supportsPersistence: false,

    // -- Instance creation --

    createInstance(type: string, props: Props, _root: DOMElement, _hostContext: HostContext): DOMElement {
      const nodeName = type as DOMElement['nodeName']
      const element = createDOMElement(nodeName)

      const styleProps = extractStyleProps(props)
      applyStyles(element, styleProps)

      if (props.internal_static) {
        element.internal_static = true
      }

      return element
    },

    createTextInstance(text: string, _root: DOMElement, hostContext: HostContext): DOMTextNode {
      if (!hostContext.isInsideText) {
        // Text outside of <Text> — Ink ignores this but we'll create it
        // so React doesn't break. It just won't render visually.
      }
      return createDOMTextNode(text)
    },

    // -- Tree mutations --

    appendInitialChild(parent: DOMElement, child: DOMNode): void {
      appendChild(parent, child)
    },

    appendChild(parent: DOMElement, child: DOMNode): void {
      appendChild(parent, child)
    },

    appendChildToContainer(container: DOMElement, child: DOMNode): void {
      appendChild(container, child)
    },

    insertBefore(parent: DOMElement, child: DOMNode, beforeChild: DOMNode): void {
      insertBefore(parent, child, beforeChild)
    },

    insertInContainerBefore(container: DOMElement, child: DOMNode, beforeChild: DOMNode): void {
      insertBefore(container, child, beforeChild)
    },

    removeChild(parent: DOMElement, child: DOMNode): void {
      removeChild(parent, child)
      freeNode(child)
    },

    removeChildFromContainer(container: DOMElement, child: DOMNode): void {
      removeChild(container, child)
      freeNode(child)
    },

    // -- Updates --

    commitUpdate(instance: DOMElement, _type: string, _prevProps: Props, nextProps: Props): void {
      const styleProps = extractStyleProps(nextProps)
      applyStyles(instance, styleProps)
    },

    commitTextUpdate(textInstance: DOMTextNode, _oldText: string, newText: string): void {
      textInstance.nodeValue = newText
      markTextNodeDirty(textInstance)
    },

    // -- Commit phase --

    resetAfterCommit(): void {
      onCommit()
    },

    // -- Host context --

    getRootHostContext(): HostContext {
      return ROOT_HOST_CONTEXT
    },

    getChildHostContext(parentContext: HostContext, type: string): HostContext {
      if (type === 'ink-text' || type === 'ink-virtual-text') {
        return TEXT_HOST_CONTEXT
      }
      return parentContext
    },

    // -- Misc required methods --

    shouldSetTextContent(): boolean {
      return false
    },

    finalizeInitialChildren(): boolean {
      return false
    },

    prepareForCommit(): Record<string, unknown> | null {
      return null
    },

    clearContainer(container: DOMElement): void {
      for (const child of [...container.childNodes]) {
        removeChild(container, child)
        freeNode(child)
      }
    },

    getPublicInstance(instance: DOMElement): DOMElement {
      return instance
    },

    preparePortalMount(): void {},

    scheduleTimeout: setTimeout as unknown as (fn: (...args: unknown[]) => unknown, delay?: number) => number,
    cancelTimeout: clearTimeout as unknown as (id: number) => void,
    noTimeout: -1 as const,

    isPrimaryRenderer: true,
    warnsIfNotActing: true,
    setCurrentUpdatePriority: () => {},
    getCurrentUpdatePriority: () => DefaultEventPriority,
    resolveUpdatePriority: () => DefaultEventPriority,
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: () => {},
    afterActiveInstanceBlur: () => {},
    prepareScopeUpdate: () => {},
    getInstanceFromScope: () => null,
    detachDeletedInstance: () => {},

    // Transition support
    NotPendingTransition: null,
    HostTransitionContext: { $$typeof: Symbol.for('react.context'), _currentValue: null } as never,
    resetFormInstance: () => {},

    // Post-paint callback
    requestPostPaintCallback: () => {},

    // Eager transition
    shouldAttemptEagerTransition: () => false,

    // Scheduler event tracking
    trackSchedulerEvent: () => {},

    // Event type resolution
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1.1,

    // Suspense commit support
    maySuspendCommit: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => {},
    suspendInstance: () => {},
    waitForCommitToBeReady: () => null,

    supportsHydration: false,
  }

  return Reconciler(hostConfig as never)
}
