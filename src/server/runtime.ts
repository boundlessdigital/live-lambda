import {
  LambdaClient,
  GetFunctionConfigurationCommand
} from '@aws-sdk/client-lambda'
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import * as path from 'path'
import { LambdaContext } from './types.js'
import * as fs from 'fs'
import * as esbuild from 'esbuild'
import * as os from 'os'
import { logger } from '../lib/logger.js'

export interface ExecuteHandlerOptions {
  region: string
  function_arn: string
  event: APIGatewayProxyEventV2
  context: LambdaContext
}

// Snapshot of the original process.env before any handler modifies it.
// Captured once on first use, then used to restore env between handler calls.
let original_env: Record<string, string | undefined> | undefined

function restore_env(saved: Record<string, string | undefined>) {
  // Remove all keys that aren't in the saved snapshot
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) {
      delete process.env[key]
    }
  }
  // Restore all saved values
  Object.assign(process.env, saved)
}

export async function execute_handler(
  event: APIGatewayProxyEventV2,
  context: LambdaContext
) {
  logger.trace('Received event:', JSON.stringify(event, null, 2))

  return execute_module_handler({
    region: context.aws_region as string,
    function_arn: context.invoked_function_arn as string,
    event,
    context
  })
}
interface OutputsJson {
  [stack_name: string]: {
    [key: string]: string | undefined
  }
}

interface SourceMap {
  sources: string[]
  [key: string]: unknown
}

/**
 * Extracts the original TypeScript source file path from a source map.
 * Looks for .ts files that are not in node_modules (user's handler code).
 */
function extract_source_from_sourcemap(
  asset_path: string,
  handler_file: string
): string | undefined {
  // Try .mjs.map first (ESM), then .js.map
  const mjs_map_path = path.join(asset_path, `${handler_file}.mjs.map`)
  const js_map_path = path.join(asset_path, `${handler_file}.js.map`)

  let sourcemap_path: string | undefined
  if (fs.existsSync(mjs_map_path)) {
    sourcemap_path = mjs_map_path
  } else if (fs.existsSync(js_map_path)) {
    sourcemap_path = js_map_path
  }

  if (!sourcemap_path) {
    logger.debug(`No source map found at ${mjs_map_path} or ${js_map_path}`)
    return undefined
  }

  try {
    const sourcemap: SourceMap = JSON.parse(
      fs.readFileSync(sourcemap_path, 'utf-8')
    )

    // Find the source that's a .ts file and not in node_modules (the user's handler file)
    const user_source = sourcemap.sources.find(
      (s: string) => s.endsWith('.ts') && !s.includes('node_modules')
    )

    if (!user_source) {
      logger.debug('No user TypeScript source found in source map')
      return undefined
    }

    // Resolve relative path from asset directory
    const resolved_path = path.resolve(asset_path, user_source)
    logger.debug(`Found source from source map: ${user_source}`)
    logger.debug(`Resolved to: ${resolved_path}`)

    return resolved_path
  } catch (error) {
    logger.warn(`Error parsing source map: ${error}`)
    return undefined
  }
}

/**
 * Finds the output key prefix for a Lambda function in a stack's outputs.
 * The CDK aspect creates outputs named `{constructId}Arn`, `{constructId}Handler`, etc.
 * This function scans all keys to find one ending in 'Arn' whose value matches the function ARN,
 * then returns the prefix so we can look up the related Handler and CdkOutAssetPath keys.
 */
function find_function_output_prefix(
  stack_outputs: { [key: string]: string | undefined },
  function_arn: string
): string | undefined {
  for (const key of Object.keys(stack_outputs)) {
    if (
      key.endsWith('Arn') &&
      !key.endsWith('RoleArn') &&
      stack_outputs[key] === function_arn
    ) {
      return key.slice(0, -3) // Remove 'Arn' suffix to get the prefix
    }
  }
  return undefined
}

/**
 * Resolves handler path and export name from outputs.json based on function ARN.
 * Dynamically scans output keys to support any NodejsFunction construct ID.
 * Prefers TypeScript source files (via source map) over compiled .mjs files.
 */
function resolve_handler_from_outputs(
  outputs: OutputsJson,
  function_arn: string
):
  | { handler_path: string; handler_name: string; is_typescript: boolean }
  | undefined {
  // Search through all stacks to find the matching function ARN
  for (const stack_name of Object.keys(outputs)) {
    const stack_outputs = outputs[stack_name]

    const prefix = find_function_output_prefix(stack_outputs, function_arn)
    if (!prefix) continue

    const handler_string = stack_outputs[`${prefix}Handler`]
    const asset_path = stack_outputs[`${prefix}CdkOutAssetPath`]

    if (!handler_string || !asset_path) {
      logger.warn(
        `Found matching stack ${stack_name} (prefix: ${prefix}) but missing ${prefix}Handler or ${prefix}CdkOutAssetPath`
      )
      continue
    }

    // Parse handler string like "index.handler" → file="index", export="handler"
    const last_dot_index = handler_string.lastIndexOf('.')
    if (last_dot_index === -1) {
      logger.warn(
        `Invalid handler format: ${handler_string}. Expected format: "file.export"`
      )
      continue
    }

    let file_name = handler_string.substring(0, last_dot_index)
    const export_name = handler_string.substring(last_dot_index + 1)

    // Detect wrapper handlers (e.g., Datadog) that point to /opt/... paths
    // instead of the actual bundled file. Fall back to "index" which is the
    // default NodejsFunction entry point.
    const is_wrapper_handler = file_name.startsWith('/opt/')
    if (is_wrapper_handler) {
      logger.debug(
        `Detected wrapper handler (${file_name}), falling back to default entry point`
      )
      file_name = 'index'
    }

    // First, try to get the original TypeScript source from source map
    const source_path = extract_source_from_sourcemap(asset_path, file_name)
    if (source_path && fs.existsSync(source_path)) {
      logger.info(`Using TypeScript source for ${function_arn}`)
      logger.debug(`  handler_path: ${source_path}`)
      logger.debug(`  handler_name: ${export_name}`)
      return {
        handler_path: source_path,
        handler_name: export_name,
        is_typescript: true
      }
    }

    // Fall back to compiled .mjs/.js files
    const mjs_path = path.join(asset_path, `${file_name}.mjs`)
    const js_path = path.join(asset_path, `${file_name}.js`)

    let handler_path: string
    if (fs.existsSync(mjs_path)) {
      handler_path = mjs_path
    } else if (fs.existsSync(js_path)) {
      handler_path = js_path
    } else {
      logger.warn(`Could not find handler file at ${mjs_path} or ${js_path}`)
      continue
    }

    logger.info(`Resolved handler for ${function_arn} (compiled)`)
    logger.debug(`  handler_path: ${handler_path}`)
    logger.debug(`  handler_name: ${export_name}`)

    return { handler_path, handler_name: export_name, is_typescript: false }
  }

  return undefined
}

export async function execute_module_handler({
  region,
  function_arn,
  event,
  context
}: ExecuteHandlerOptions): Promise<unknown> {
  /* ---------- 1 · fetch live configuration ---------- */
  const { function_name } = context
  const outputs: OutputsJson = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'cdk.out', 'outputs.json'),
      'utf-8'
    )
  )

  /* ---------- 1.5 · resolve handler from outputs.json ---------- */
  const resolved_handler = resolve_handler_from_outputs(outputs, function_arn)
  if (!resolved_handler) {
    throw new Error(
      `[live-lambda] Could not find handler info for function ARN: ${function_arn}. ` +
        `Make sure the function is deployed and outputs.json is up to date.`
    )
  }

  const { handler_path, handler_name, is_typescript } = resolved_handler

  // Capture the original environment on first invocation. This snapshot
  // is restored before each handler call to prevent credential leakage
  // between different Lambda functions (each has its own IAM role).
  if (!original_env) {
    original_env = { ...process.env }
  }

  // Restore original env before AWS API calls. Previous handler executions
  // may have set AWS_ACCESS_KEY_ID to a different role's credentials.
  restore_env(original_env)

  const lambda_client = new LambdaClient({ region })
  const config = await lambda_client.send(
    new GetFunctionConfigurationCommand({
      FunctionName: function_name
    })
  )

  if (!config.Role) {
    throw new Error('Lambda configuration did not include execution role ARN.')
  }

  /* ---------- 2 · assume the execution role ---------- */
  const cred_provider = fromTemporaryCredentials({
    params: {
      RoleArn: config.Role,
      RoleSessionName: `live-lambda-${function_name}`
        .replace(/[^a-zA-Z0-9_=,.@-]/g, '_')
        .substring(0, 50)
        .concat(`-${Date.now().toString(36).substring(0, 8)}`)
    },
    clientConfig: { region }
  })

  const creds = await cred_provider()

  /* ---------- 3 · inject env vars + creds ---------- */
  // Remove AWS_PROFILE to prevent the SDK from preferring profile credentials
  // over the assumed role credentials we explicitly set below.
  // The SDK warns: "This SDK will proceed with the AWS_PROFILE value"
  // which bypasses the Lambda execution role we need for SSM access, etc.
  delete process.env.AWS_PROFILE
  delete process.env.AWS_SHARED_CREDENTIALS_FILE

  Object.assign(process.env, config.Environment?.Variables ?? {}, {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
    AWS_SESSION_TOKEN: creds.sessionToken,
    // AWS_REGION is set by the Lambda runtime automatically, not as a
    // configured env var. We must set it explicitly for local execution.
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region
  })

  /* ---------- 4 · load & run the handler ------------ */
  try {
    const abs_path = path.isAbsolute(handler_path)
      ? handler_path
      : path.resolve(process.cwd(), handler_path)

    let handler_module: Record<string, unknown>

    if (is_typescript) {
      logger.info(`Loading TypeScript source: ${abs_path}`)

      // Transform TypeScript to JavaScript using esbuild
      const result = await esbuild.build({
        entryPoints: [abs_path],
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        write: false,
        sourcemap: 'inline',
        external: ['@aws-sdk/*', 'aws-lambda']
      })

      // Write to temp file and import
      const temp_dir = os.tmpdir()
      const temp_file = path.join(
        temp_dir,
        `live-lambda-handler-${Date.now()}.mjs`
      )
      fs.writeFileSync(temp_file, result.outputFiles[0].text)

      logger.debug(`Transformed to: ${temp_file}`)
      handler_module = await import(temp_file)

      // Clean up temp file
      fs.unlinkSync(temp_file)
    } else {
      logger.info(`Loading compiled handler: ${abs_path}`)
      handler_module = await import(abs_path)
    }
    const handler = handler_module[handler_name]

    if (typeof handler !== 'function') {
      throw new Error(
        `Expected ${abs_path} to export a function named "${handler_name}".`
      )
    }

    return await handler(event, context)
  } finally {
    // Restore original environment to prevent credential leakage.
    // Without this, a subsequent handler invocation would try to use
    // this handler's role for STS:AssumeRole, which would fail.
    restore_env(original_env!)
  }
}
