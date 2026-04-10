import { z, type ZodTypeAny } from 'zod'

// ---------------------------------------------------------------------------
// Semantic type coercion for LLM inputs
// ---------------------------------------------------------------------------
// LLMs occasionally send quoted numbers ("30") or booleans ("true") in JSON.
// These preprocessors handle that safely — unlike z.coerce.number() which
// accepts "" and null, or z.coerce.boolean() which uses JS truthiness
// (so "false" → true).

const NUMERIC_RE = /^-?\d+(\.\d+)?$/

/**
 * Zod preprocessor that accepts numeric strings and coerces to number.
 * Preserves `{type: "number"}` in the generated JSON schema.
 */
export function semanticNumber<T extends ZodTypeAny>(inner: T) {
  return z.preprocess((val: unknown) => {
    if (typeof val === 'string' && NUMERIC_RE.test(val)) {
      return Number(val)
    }
    return val
  }, inner)
}

/**
 * Zod preprocessor that accepts "true"/"false" strings and coerces to boolean.
 * Preserves `{type: "boolean"}` in the generated JSON schema.
 */
export function semanticBoolean<T extends ZodTypeAny>(inner: T) {
  return z.preprocess((val: unknown) => {
    if (val === 'true') return true
    if (val === 'false') return false
    return val
  }, inner)
}

/**
 * Zod preprocessor that coerces numbers to strings. LLMs often send
 * numeric IDs as bare numbers (`1`) instead of strings (`"1"`).
 * Preserves `{type: "string"}` in the generated JSON schema.
 */
export function semanticString<T extends ZodTypeAny>(inner: T) {
  return z.preprocess((val: unknown) => {
    if (typeof val === 'number') return String(val)
    return val
  }, inner)
}

