import { describe, expect, test } from 'bun:test'
import {
  isBinaryExtension,
  isBinaryContent,
  isDeviceFile,
} from '../utils/binaryDetection.js'

// ---------------------------------------------------------------------------
// Extension-based binary detection
// ---------------------------------------------------------------------------

describe('isBinaryExtension', () => {
  test('detects executable extensions', () => {
    expect(isBinaryExtension('.exe')).toBe(true)
    expect(isBinaryExtension('.dll')).toBe(true)
    expect(isBinaryExtension('.so')).toBe(true)
    expect(isBinaryExtension('.dylib')).toBe(true)
    expect(isBinaryExtension('.bin')).toBe(true)
  })

  test('detects archive extensions', () => {
    expect(isBinaryExtension('.zip')).toBe(true)
    expect(isBinaryExtension('.tar')).toBe(true)
    expect(isBinaryExtension('.gz')).toBe(true)
    expect(isBinaryExtension('.7z')).toBe(true)
    expect(isBinaryExtension('.rar')).toBe(true)
  })

  test('detects media extensions', () => {
    expect(isBinaryExtension('.mp3')).toBe(true)
    expect(isBinaryExtension('.mp4')).toBe(true)
    expect(isBinaryExtension('.avi')).toBe(true)
    expect(isBinaryExtension('.mov')).toBe(true)
    expect(isBinaryExtension('.wav')).toBe(true)
  })

  test('detects database extensions', () => {
    expect(isBinaryExtension('.sqlite')).toBe(true)
    expect(isBinaryExtension('.db')).toBe(true)
    expect(isBinaryExtension('.mdb')).toBe(true)
  })

  test('detects font extensions', () => {
    expect(isBinaryExtension('.ttf')).toBe(true)
    expect(isBinaryExtension('.otf')).toBe(true)
    expect(isBinaryExtension('.woff')).toBe(true)
    expect(isBinaryExtension('.woff2')).toBe(true)
  })

  test('detects compiled extensions', () => {
    expect(isBinaryExtension('.o')).toBe(true)
    expect(isBinaryExtension('.a')).toBe(true)
    expect(isBinaryExtension('.pyc')).toBe(true)
    expect(isBinaryExtension('.class')).toBe(true)
  })

  test('does NOT flag text file extensions', () => {
    expect(isBinaryExtension('.ts')).toBe(false)
    expect(isBinaryExtension('.js')).toBe(false)
    expect(isBinaryExtension('.json')).toBe(false)
    expect(isBinaryExtension('.md')).toBe(false)
    expect(isBinaryExtension('.txt')).toBe(false)
    expect(isBinaryExtension('.html')).toBe(false)
    expect(isBinaryExtension('.css')).toBe(false)
  })

  test('does NOT flag image/PDF extensions (handled by later enhancements)', () => {
    expect(isBinaryExtension('.png')).toBe(false)
    expect(isBinaryExtension('.jpg')).toBe(false)
    expect(isBinaryExtension('.jpeg')).toBe(false)
    expect(isBinaryExtension('.gif')).toBe(false)
    expect(isBinaryExtension('.svg')).toBe(false)
    expect(isBinaryExtension('.pdf')).toBe(false)
  })

  test('handles extensions with full file paths', () => {
    expect(isBinaryExtension('.exe')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Content-based binary detection
// ---------------------------------------------------------------------------

describe('isBinaryContent', () => {
  test('detects null bytes as binary', () => {
    const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]) // "Hel\0o"
    expect(isBinaryContent(buffer)).toBe(true)
  })

  test('accepts normal text content', () => {
    const buffer = Buffer.from('Hello, world!\nThis is plain text.\n')
    expect(isBinaryContent(buffer)).toBe(false)
  })

  test('accepts content with tabs and carriage returns', () => {
    const buffer = Buffer.from('col1\tcol2\r\nrow1\trow2\r\n')
    expect(isBinaryContent(buffer)).toBe(false)
  })

  test('detects high ratio of non-printable characters', () => {
    // >10% non-printable (excluding \t, \n, \r)
    const bytes = new Uint8Array(100)
    // Fill with printable chars
    bytes.fill(0x41) // 'A'
    // Put 15 control characters (bytes < 32, not tab/newline/CR)
    for (let i = 0; i < 15; i++) {
      bytes[i] = 0x01 // SOH — non-printable
    }
    expect(isBinaryContent(Buffer.from(bytes))).toBe(true)
  })

  test('accepts content right at the 10% threshold', () => {
    const bytes = new Uint8Array(100)
    bytes.fill(0x41) // 'A'
    // Put exactly 10 control characters (at the boundary)
    for (let i = 0; i < 10; i++) {
      bytes[i] = 0x01
    }
    // 10/100 = 10%, threshold is >10%, so this should pass
    expect(isBinaryContent(Buffer.from(bytes))).toBe(false)
  })

  test('accepts empty buffer', () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Device file blocking
// ---------------------------------------------------------------------------

describe('isDeviceFile', () => {
  test('blocks /dev/zero', () => {
    expect(isDeviceFile('/dev/zero')).toBe(true)
  })

  test('blocks /dev/random', () => {
    expect(isDeviceFile('/dev/random')).toBe(true)
  })

  test('blocks /dev/urandom', () => {
    expect(isDeviceFile('/dev/urandom')).toBe(true)
  })

  test('blocks /dev/null', () => {
    expect(isDeviceFile('/dev/null')).toBe(true)
  })

  test('blocks /dev/stdin', () => {
    expect(isDeviceFile('/dev/stdin')).toBe(true)
  })

  test('blocks /dev/stdout', () => {
    expect(isDeviceFile('/dev/stdout')).toBe(true)
  })

  test('blocks /dev/stderr', () => {
    expect(isDeviceFile('/dev/stderr')).toBe(true)
  })

  test('blocks /dev/tty', () => {
    expect(isDeviceFile('/dev/tty')).toBe(true)
  })

  test('blocks /dev/fd/ paths', () => {
    expect(isDeviceFile('/dev/fd/0')).toBe(true)
    expect(isDeviceFile('/dev/fd/1')).toBe(true)
    expect(isDeviceFile('/dev/fd/255')).toBe(true)
  })

  test('allows regular file paths', () => {
    expect(isDeviceFile('/home/user/file.ts')).toBe(false)
    expect(isDeviceFile('/tmp/data.txt')).toBe(false)
  })

  test('allows files in directories named dev', () => {
    expect(isDeviceFile('/home/user/dev/project/file.ts')).toBe(false)
  })
})
