import Yoga, {
  type Node as YogaNode,
  type MeasureFunction,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  Align,
  Wrap,
  Overflow,
  Display,
  PositionType,
} from 'yoga-layout'

export { Edge, FlexDirection, Gutter, Justify, Align, Wrap, Overflow, Display, PositionType }

export type YogaMeasureFunc = MeasureFunction

export class YogaLayoutNode {
  readonly node: YogaNode

  constructor() {
    this.node = Yoga.Node.create()
  }

  setFlexDirection(dir: FlexDirection): void {
    this.node.setFlexDirection(dir)
  }

  setFlexGrow(value: number): void {
    this.node.setFlexGrow(value)
  }

  setFlexShrink(value: number): void {
    this.node.setFlexShrink(value)
  }

  setFlexBasis(value: number | 'auto' | `${number}%`): void {
    this.node.setFlexBasis(value)
  }

  setFlexWrap(wrap: Wrap): void {
    this.node.setFlexWrap(wrap)
  }

  setJustifyContent(justify: Justify): void {
    this.node.setJustifyContent(justify)
  }

  setAlignItems(align: Align): void {
    this.node.setAlignItems(align)
  }

  setAlignSelf(align: Align): void {
    this.node.setAlignSelf(align)
  }

  setPadding(edge: Edge, value: number): void {
    this.node.setPadding(edge, value)
  }

  setMargin(edge: Edge, value: number): void {
    this.node.setMargin(edge, value)
  }

  setBorder(edge: Edge, value: number): void {
    this.node.setBorder(edge, value)
  }

  setWidth(value: number | 'auto' | `${number}%` | undefined): void {
    this.node.setWidth(value)
  }

  setHeight(value: number | 'auto' | `${number}%` | undefined): void {
    this.node.setHeight(value)
  }

  setMinWidth(value: number | `${number}%` | undefined): void {
    this.node.setMinWidth(value)
  }

  setMinHeight(value: number | `${number}%` | undefined): void {
    this.node.setMinHeight(value)
  }

  setMaxWidth(value: number | `${number}%` | undefined): void {
    this.node.setMaxWidth(value)
  }

  setMaxHeight(value: number | `${number}%` | undefined): void {
    this.node.setMaxHeight(value)
  }

  setOverflow(overflow: Overflow): void {
    this.node.setOverflow(overflow)
  }

  setDisplay(display: Display): void {
    this.node.setDisplay(display)
  }

  setPositionType(positionType: PositionType): void {
    this.node.setPositionType(positionType)
  }

  setPosition(edge: Edge, value: number | `${number}%` | undefined): void {
    this.node.setPosition(edge, value)
  }

  setGap(gutter: Gutter, value: number): void {
    this.node.setGap(gutter, value)
  }

  setMeasureFunc(fn: MeasureFunction | null): void {
    if (fn) {
      this.node.setMeasureFunc(fn)
    } else {
      this.node.unsetMeasureFunc()
    }
  }

  insertChild(child: YogaLayoutNode, index: number): void {
    this.node.insertChild(child.node, index)
  }

  removeChild(child: YogaLayoutNode): void {
    this.node.removeChild(child.node)
  }

  getChildCount(): number {
    return this.node.getChildCount()
  }

  calculateLayout(availableWidth: number, availableHeight?: number): void {
    this.node.calculateLayout(availableWidth, availableHeight ?? 'auto')
  }

  getComputedLeft(): number {
    return this.node.getComputedLeft()
  }

  getComputedTop(): number {
    return this.node.getComputedTop()
  }

  getComputedWidth(): number {
    return this.node.getComputedWidth()
  }

  getComputedHeight(): number {
    return this.node.getComputedHeight()
  }

  getComputedPadding(edge: Edge): number {
    return this.node.getComputedPadding(edge)
  }

  getComputedBorder(edge: Edge): number {
    return this.node.getComputedBorder(edge)
  }

  markDirty(): void {
    this.node.markDirty()
  }

  isDirty(): boolean {
    return this.node.isDirty()
  }

  free(): void {
    this.node.free()
  }
}
