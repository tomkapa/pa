import { CSI } from './csi.js'

export const decset = (mode: number): string => `${CSI}?${mode}h`
export const decreset = (mode: number): string => `${CSI}?${mode}l`

// SGR mouse protocol: 1003 = report all motion events, 1006 = SGR extended coords
export const enableMouseTracking = (): string => decset(1003) + decset(1006)
export const disableMouseTracking = (): string => decreset(1003) + decreset(1006)
