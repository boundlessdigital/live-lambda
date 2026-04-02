import {
  LambdaClient,
  paginateListFunctions,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda'
import { ENV_KEY_LIVE_LAMBDA_ENABLED } from '../lib/constants.js'
import { logger } from '../lib/logger.js'

export type LayerArnByRegion = Map<string, string>

const CONCURRENCY_LIMIT = 5
const THROTTLE_DELAY_MS = 200

export interface ToggleResult {
  functions_toggled: number
  functions_scanned: number
  errors: string[]
}

export async function set_live_lambda_enabled(
  layer_arns: LayerArnByRegion,
  enabled: boolean
): Promise<ToggleResult> {
  const total_result: ToggleResult = {
    functions_toggled: 0,
    functions_scanned: 0,
    errors: [],
  }

  const value = enabled ? String(Math.floor(Date.now() / 1000)) : 'false'
  logger.info(`Setting LIVE_LAMBDA_ENABLED=${value} across ${layer_arns.size} region(s)`)

  for (const [region, layer_arn] of layer_arns) {
    const result = await toggle_region(region, layer_arn, value)
    total_result.functions_toggled += result.functions_toggled
    total_result.functions_scanned += result.functions_scanned
    total_result.errors.push(...result.errors)
  }

  logger.info(
    `Toggle complete: ${total_result.functions_toggled}/${total_result.functions_scanned} functions updated` +
      (total_result.errors.length > 0 ? `, ${total_result.errors.length} errors` : '')
  )

  return total_result
}

async function toggle_region(
  region: string,
  layer_arn: string,
  value: string
): Promise<ToggleResult> {
  const client = new LambdaClient({ region })
  const result: ToggleResult = {
    functions_toggled: 0,
    functions_scanned: 0,
    errors: [],
  }

  const layer_arn_prefix = layer_arn.replace(/:\d+$/, '')
  logger.info(`[${region}] Scanning for functions with layer: ${layer_arn_prefix}*`)

  const paginator = paginateListFunctions({ client, pageSize: 50 }, {})
  const batch: string[] = []

  for await (const page of paginator) {
    for (const fn of page.Functions ?? []) {
      result.functions_scanned++

      const has_layer = fn.Layers?.some((l) => l.Arn?.startsWith(layer_arn_prefix))
      if (!has_layer) continue

      batch.push(fn.FunctionName!)
    }
  }

  logger.info(`[${region}] Found ${batch.length} functions with LiveLambda layer`)

  for (let i = 0; i < batch.length; i += CONCURRENCY_LIMIT) {
    const chunk = batch.slice(i, i + CONCURRENCY_LIMIT)
    const results = await Promise.allSettled(
      chunk.map((fn_name) => toggle_function(client, fn_name, value))
    )

    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === 'fulfilled') {
        result.functions_toggled++
      } else {
        const fn_name = chunk[j]
        const error = r.reason
        if (error?.name === 'ResourceConflictException') {
          const msg = `[${region}] Skipping ${fn_name}: function is currently being updated`
          logger.warn(msg)
          result.errors.push(msg)
        } else {
          const msg = `[${region}] Failed to toggle ${fn_name}: ${error?.message ?? error}`
          logger.error(msg)
          result.errors.push(msg)
        }
      }
    }

    if (i + CONCURRENCY_LIMIT < batch.length) {
      await new Promise((resolve) => setTimeout(resolve, THROTTLE_DELAY_MS))
    }
  }

  return result
}

async function toggle_function(
  client: LambdaClient,
  function_name: string,
  value: string
): Promise<void> {
  const config = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: function_name })
  )

  const current_env = config.Environment?.Variables ?? {}
  if (current_env[ENV_KEY_LIVE_LAMBDA_ENABLED] === value) {
    logger.debug(`  ${function_name}: already ${value}, skipping`)
    return
  }

  await client.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: function_name,
      Environment: {
        Variables: {
          ...current_env,
          [ENV_KEY_LIVE_LAMBDA_ENABLED]: value,
        },
      },
    })
  )

  logger.debug(`  ${function_name}: set LIVE_LAMBDA_ENABLED=${value}`)
}
