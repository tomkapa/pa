import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { semanticNumber, semanticBoolean } from '../utils/schema.js'

// ---------------------------------------------------------------------------
// semanticNumber
// ---------------------------------------------------------------------------

describe('semanticNumber', () => {
  const schema = semanticNumber(z.number().int().min(0))

  test('passes through actual numbers', () => {
    expect(schema.parse(42)).toBe(42)
    expect(schema.parse(0)).toBe(0)
  })

  test('coerces numeric strings to numbers', () => {
    expect(schema.parse('42')).toBe(42)
    expect(schema.parse('0')).toBe(0)
    expect(schema.parse('100')).toBe(100)
  })

  test('coerces negative numeric strings', () => {
    const negSchema = semanticNumber(z.number())
    expect(negSchema.parse('-5')).toBe(-5)
  })

  test('coerces floating point strings', () => {
    const floatSchema = semanticNumber(z.number())
    expect(floatSchema.parse('3.14')).toBe(3.14)
  })

  test('rejects non-numeric strings', () => {
    expect(() => schema.parse('abc')).toThrow()
    expect(() => schema.parse('')).toThrow()
    expect(() => schema.parse('12abc')).toThrow()
  })

  test('rejects null and undefined', () => {
    expect(() => schema.parse(null)).toThrow()
    expect(() => schema.parse(undefined)).toThrow()
  })

  test('works with optional()', () => {
    const optSchema = semanticNumber(z.number().optional())
    expect(optSchema.parse(undefined)).toBeUndefined()
    expect(optSchema.parse('42')).toBe(42)
    expect(optSchema.parse(42)).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// semanticBoolean
// ---------------------------------------------------------------------------

describe('semanticBoolean', () => {
  const schema = semanticBoolean(z.boolean())

  test('passes through actual booleans', () => {
    expect(schema.parse(true)).toBe(true)
    expect(schema.parse(false)).toBe(false)
  })

  test('coerces "true" string to true', () => {
    expect(schema.parse('true')).toBe(true)
  })

  test('coerces "false" string to false', () => {
    expect(schema.parse('false')).toBe(false)
  })

  test('rejects other strings (unlike z.coerce.boolean)', () => {
    expect(() => schema.parse('yes')).toThrow()
    expect(() => schema.parse('1')).toThrow()
    expect(() => schema.parse('')).toThrow()
  })

  test('works with optional()', () => {
    const optSchema = semanticBoolean(z.boolean().optional())
    expect(optSchema.parse(undefined)).toBeUndefined()
    expect(optSchema.parse('true')).toBe(true)
    expect(optSchema.parse(false)).toBe(false)
  })
})

