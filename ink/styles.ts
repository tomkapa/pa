export type FlexDirectionProp = 'row' | 'column' | 'row-reverse' | 'column-reverse'
export type AlignProp = 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline' | 'auto'
export type JustifyProp = 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
export type WrapProp = 'nowrap' | 'wrap' | 'wrap-reverse'
export type OverflowProp = 'visible' | 'hidden'
export type DisplayProp = 'flex' | 'none'
export type PositionProp = 'relative' | 'absolute'

export type BorderStyleName = 'single' | 'double' | 'round' | 'bold' | 'classic'

export interface BorderChars {
  readonly topLeft: string
  readonly topRight: string
  readonly bottomLeft: string
  readonly bottomRight: string
  readonly horizontal: string
  readonly vertical: string
}

export const borderStyles: Record<BorderStyleName, BorderChars> = {
  single: { topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘', horizontal: '─', vertical: '│' },
  double: { topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝', horizontal: '═', vertical: '║' },
  round:  { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯', horizontal: '─', vertical: '│' },
  bold:   { topLeft: '┏', topRight: '┓', bottomLeft: '┗', bottomRight: '┛', horizontal: '━', vertical: '┃' },
  classic:{ topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', horizontal: '-', vertical: '|' },
}

export interface StyleProps {
  // Flex layout
  flexDirection?: FlexDirectionProp
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | 'auto' | `${number}%`
  flexWrap?: WrapProp
  justifyContent?: JustifyProp
  alignItems?: AlignProp
  alignSelf?: AlignProp
  gap?: number
  columnGap?: number
  rowGap?: number

  // Dimensions
  width?: number | `${number}%`
  height?: number | `${number}%`
  minWidth?: number | `${number}%`
  minHeight?: number | `${number}%`
  maxWidth?: number | `${number}%`
  maxHeight?: number | `${number}%`

  // Padding
  padding?: number
  paddingX?: number
  paddingY?: number
  paddingTop?: number
  paddingBottom?: number
  paddingLeft?: number
  paddingRight?: number

  // Margin
  margin?: number
  marginX?: number
  marginY?: number
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number

  // Border
  borderStyle?: BorderStyleName
  borderColor?: string
  borderTop?: boolean
  borderBottom?: boolean
  borderLeft?: boolean
  borderRight?: boolean

  // Position
  position?: PositionProp
  overflow?: OverflowProp
  display?: DisplayProp

  // Color (for text)
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
  dimColor?: boolean
  wrap?: 'wrap' | 'truncate' | 'truncate-end' | 'truncate-start' | 'truncate-middle'
}

// Single source of truth for style prop names — used by the reconciler to
// extract style props and to detect which props need to be re-applied to Yoga.
export const STYLE_KEYS = [
  'flexDirection', 'flexGrow', 'flexShrink', 'flexBasis', 'flexWrap',
  'justifyContent', 'alignItems', 'alignSelf', 'gap', 'columnGap', 'rowGap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'borderStyle', 'borderColor', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight',
  'position', 'overflow', 'display',
  'color', 'backgroundColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse', 'dimColor',
  'wrap',
] as const satisfies ReadonlyArray<keyof StyleProps>
