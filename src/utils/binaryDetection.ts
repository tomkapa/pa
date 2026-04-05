const BINARY_EXTENSIONS = new Set([
  // Executables
  '.exe', '.dll', '.so', '.dylib', '.bin',
  // Archives
  '.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz', '.zst',
  // Media — audio
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma',
  // Media — video
  '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm',
  // Databases
  '.sqlite', '.db', '.mdb',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Compiled / object
  '.o', '.a', '.pyc', '.pyo', '.class', '.obj', '.pdb',
  // Disk images
  '.iso', '.dmg', '.img',
  // Other binary
  '.deb', '.rpm', '.msi',
])

// Excluded from binary detection — handled natively by later enhancements:
// .png, .jpg, .jpeg, .gif, .svg, .webp, .bmp, .ico, .pdf

export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase())
}

const BINARY_SAMPLE_SIZE = 8192
const NON_PRINTABLE_THRESHOLD = 0.10

export function isBinaryContent(buffer: Buffer): boolean {
  if (buffer.length === 0) return false

  const sample = buffer.subarray(0, BINARY_SAMPLE_SIZE)
  let nonPrintableCount = 0

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i]!
    // Null byte is a strong binary signal
    if (byte === 0x00) return true

    // Count non-printable chars (< 32) excluding tab (0x09), newline (0x0A), CR (0x0D)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      nonPrintableCount++
    }
  }

  return nonPrintableCount / sample.length > NON_PRINTABLE_THRESHOLD
}

const BLOCKED_DEVICE_FILES = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/null',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
])

export function isDeviceFile(filePath: string): boolean {
  if (BLOCKED_DEVICE_FILES.has(filePath)) return true
  if (filePath.startsWith('/dev/fd/')) return true
  return false
}
