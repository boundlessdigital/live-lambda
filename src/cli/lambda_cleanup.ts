import {
  LambdaClient,
  paginateListFunctions,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda'
import { LIVE_LAMBDA_ENV_VARS } from '../lib/constants.js'
import { logger } from '../lib/logger.js'

export interface CleanupResult {
  functions_scanned: number
  functions_cleaned: number
  errors: string[]
}

/**
 * Finds Lambda functions with this project's live-lambda layer and removes:
 * - The live-lambda layer
 * - The live-lambda environment variables
 *
 * Only touches functions that have the specific layer ARN for this project.
 */
export async function clean_lambda_functions(
  region: string,
  layer_arn: string
): Promise<CleanupResult> {
  const client = new LambdaClient({ region })
  const result: CleanupResult = {
    functions_scanned: 0,
    functions_cleaned: 0,
    errors: [],
  }

  // Strip version suffix for prefix matching (arn:...:layer:name:5 → arn:...:layer:name)
  const layer_arn_prefix = layer_arn.replace(/:\d+$/, '')
  logger.info(`Scanning Lambda functions for layer: ${layer_arn_prefix}*`)

  const paginator = paginateListFunctions({ client, pageSize: 50 }, {})

  for await (const page of paginator) {
    for (const fn of page.Functions ?? []) {
      result.functions_scanned++

      const has_layer = fn.Layers?.some((l) => l.Arn?.startsWith(layer_arn_prefix))
      if (!has_layer) continue

      const function_name = fn.FunctionName!
      logger.info(`Cleaning function: ${function_name}`)

      try {
        await clean_single_function(client, function_name, layer_arn_prefix)
        result.functions_cleaned++
        // Small delay to avoid Lambda API throttling
        await new Promise((resolve) => setTimeout(resolve, 200))
      } catch (error: any) {
        if (error.name === 'ResourceConflictException') {
          const msg = `Skipping ${function_name}: function is currently being updated`
          logger.warn(msg)
          result.errors.push(msg)
        } else {
          const msg = `Failed to clean ${function_name}: ${error.message ?? error}`
          logger.error(msg)
          result.errors.push(msg)
        }
      }
    }
  }

  logger.info(
    `Cleanup complete: ${result.functions_cleaned}/${result.functions_scanned} functions cleaned` +
      (result.errors.length > 0 ? `, ${result.errors.length} errors` : '')
  )

  return result
}

async function clean_single_function(
  client: LambdaClient,
  function_name: string,
  layer_arn_prefix: string
): Promise<void> {
  const config = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: function_name })
  )

  // Build new layers list excluding this project's live-lambda layer
  const current_layers = config.Layers?.map((l) => l.Arn!) ?? []
  const new_layers = current_layers.filter((arn) => !arn.startsWith(layer_arn_prefix))

  // Build new env vars removing live-lambda keys
  const current_env = config.Environment?.Variables ?? {}
  const new_env = { ...current_env }
  for (const key of LIVE_LAMBDA_ENV_VARS) {
    delete new_env[key]
  }

  await client.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: function_name,
      Layers: new_layers,
      Environment: { Variables: new_env },
    })
  )

  logger.debug(`  Removed layer and ${LIVE_LAMBDA_ENV_VARS.length} env vars from ${function_name}`)
}

/**
 * Extracts the AWS region from a Lambda layer ARN.
 * Example: arn:aws:lambda:us-east-1:123456:layer:name:1 → us-east-1
 */
export function extract_region_from_arn(arn: string): string {
  const parts = arn.split(':')
  if (parts.length < 4) {
    throw new Error(`Invalid ARN format: ${arn}`)
  }
  return parts[3]
}
