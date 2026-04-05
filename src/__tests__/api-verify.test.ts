import { describe, test, expect } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { verifyApiKey } from '../services/api/verify.js'

describe('verifyApiKey', () => {
  test('is exported as a function', () => {
    expect(typeof verifyApiKey).toBe('function')
  })

  test('Anthropic.AuthenticationError exists for auth detection', () => {
    expect(Anthropic.AuthenticationError).toBeDefined()
    const err = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid key' }}, 'invalid key', new Headers())
    expect(err).toBeInstanceOf(Anthropic.AuthenticationError)
    expect(err).toBeInstanceOf(Anthropic.APIError)
  })

  test('non-auth errors are not AuthenticationError instances', () => {
    const networkError = new Error('Network failure')
    expect(networkError instanceof Anthropic.AuthenticationError).toBe(false)
  })
})
