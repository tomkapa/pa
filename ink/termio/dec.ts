import { CSI } from './csi.js'

export const decset = (mode: number): string => `${CSI}?${mode}h`
export const decreset = (mode: number): string => `${CSI}?${mode}l`

// ---------------------------------------------------------------------------
// Mouse tracking (DEC private modes)
//
// 1000 = button press / release / wheel
// 1002 = button motion (drag while a button is held)
// 1003 = any motion (hover with no button held)
// 1006 = SGR extended coordinates (`CSI < btn;col;row M/m`, supports col > 223)
//
// Enable in ascending order; disable in REVERSE order so we restore terminal
// state in the inverse sequence we changed it. Both writes are idempotent.
// ---------------------------------------------------------------------------

export const enableMouseTracking = (): string =>
  decset(1000) + decset(1002) + decset(1003) + decset(1006)

export const disableMouseTracking = (): string =>
  decreset(1006) + decreset(1003) + decreset(1002) + decreset(1000)
