// Suppress logger output during tests
process.env.LIVE_LAMBDA_LOG_LEVEL = 'silent'

// Suppress CDK bundling output ("Bundling asset X/Y/Code/Stage...")
// CDK writes these to stderr, so we intercept and filter them
const original_stderr_write = process.stderr.write.bind(process.stderr)
process.stderr.write = (
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error) => void),
  callback?: (err?: Error) => void
): boolean => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString()
  if (text.includes('Bundling asset') || text.includes('esbuild')) {
    // Suppress CDK/esbuild bundling output
    if (typeof encoding === 'function') {
      encoding()
    } else if (callback) {
      callback()
    }
    return true
  }
  return original_stderr_write(chunk, encoding as BufferEncoding, callback)
}
