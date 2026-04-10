import { describe, test, expect } from 'bun:test'
import { parseFrontmatter } from '../../services/custom-commands/frontmatter.js'

describe('parseFrontmatter', () => {
  test('parses valid frontmatter and content', () => {
    const input = `---
description: "Review code"
argument-hint: "[file]"
---

Review this file: $ARGUMENTS`

    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({
      description: 'Review code',
      'argument-hint': '[file]',
    })
    expect(result.content).toBe('Review this file: $ARGUMENTS')
  })

  test('handles no frontmatter — entire file is content', () => {
    const input = 'Just a plain prompt with no frontmatter'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('Just a plain prompt with no frontmatter')
  })

  test('handles empty frontmatter', () => {
    // The shared parser regex requires at least one line between the fences,
    // so empty frontmatter (---\n---) is treated as no frontmatter.
    // Use a blank line between fences for proper empty frontmatter.
    const input = `---

---

Content after empty frontmatter`

    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('Content after empty frontmatter')
  })

  test('handles frontmatter-only (no content after ---)', () => {
    const input = `---
description: "No content"
---`

    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({ description: 'No content' })
    expect(result.content).toBe('')
  })

  test('handles invalid YAML — returns empty frontmatter and strips fence', () => {
    const input = `---
: invalid: [yaml
---

Some content`

    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    // The shared parser strips the fence even on invalid YAML
    expect(result.content).toBe('Some content')
  })

  test('parses allowed-tools as string', () => {
    const input = `---
allowed-tools: "bash, write, edit"
---

Do something`

    const result = parseFrontmatter(input)
    expect(result.frontmatter['allowed-tools']).toBe('bash, write, edit')
  })

  test('parses allowed-tools as YAML list', () => {
    const input = `---
allowed-tools:
  - bash
  - write
  - edit
---

Do something`

    const result = parseFrontmatter(input)
    expect(result.frontmatter['allowed-tools']).toEqual(['bash', 'write', 'edit'])
  })

  test('parses model override', () => {
    const input = `---
model: "haiku"
---

Quick task`

    const result = parseFrontmatter(input)
    expect(result.frontmatter.model).toBe('haiku')
  })

  test('parses arguments as space-separated string', () => {
    const input = `---
arguments: "source dest mode"
---

Copy $source to $dest`

    const result = parseFrontmatter(input)
    expect(result.frontmatter.arguments).toBe('source dest mode')
  })

  test('parses arguments as YAML list', () => {
    const input = `---
arguments:
  - source
  - dest
---

Copy $source to $dest`

    const result = parseFrontmatter(input)
    expect(result.frontmatter.arguments).toEqual(['source', 'dest'])
  })

  test('handles Windows-style line endings (\\r\\n)', () => {
    const input = '---\r\ndescription: "Test"\r\n---\r\n\r\nContent'
    const result = parseFrontmatter(input)
    expect(result.frontmatter.description).toBe('Test')
    expect(result.content).toBe('Content')
  })

  test('handles content that starts with --- but is not frontmatter', () => {
    // Frontmatter requires the opening --- to be the very first line
    const input = 'Some text\n---\nMore text'
    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe(input)
  })

  test('trims single leading newline after closing ---', () => {
    const input = `---
description: "Test"
---
Content right after`

    const result = parseFrontmatter(input)
    expect(result.content).toBe('Content right after')
  })

  test('preserves all frontmatter fields', () => {
    const input = `---
description: "Deploy to production"
argument-hint: "[branch] [env]"
allowed-tools: "bash"
model: "opus"
arguments: "branch env"
---

Deploy $branch to $env`

    const result = parseFrontmatter(input)
    expect(result.frontmatter).toEqual({
      description: 'Deploy to production',
      'argument-hint': '[branch] [env]',
      'allowed-tools': 'bash',
      model: 'opus',
      arguments: 'branch env',
    })
  })

  test('handles empty string input', () => {
    const result = parseFrontmatter('')
    expect(result.frontmatter).toEqual({})
    expect(result.content).toBe('')
  })
})
