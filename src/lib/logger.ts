import { createConsola } from 'consola'

// Log levels: -1=silent, 0=fatal/error, 1=warn, 2=log, 3=info/success, 4=debug, 5=trace
const DEFAULT_LEVEL = 3 // info

const LEVEL_MAP: Record<string, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 3,
  debug: 4,
  trace: 5
}

function get_log_level(): number {
  const env_level = process.env.LIVE_LAMBDA_LOG_LEVEL?.toLowerCase()
  if (env_level && env_level in LEVEL_MAP) {
    return LEVEL_MAP[env_level]
  }
  return DEFAULT_LEVEL
}

export const logger = createConsola({
  level: get_log_level(),
  formatOptions: {
    date: false
  }
}).withTag('live-lambda')

export function set_log_level(level: number): void {
  logger.level = level
}

export const LOG_LEVELS = LEVEL_MAP
