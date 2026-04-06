export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
