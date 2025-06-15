import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts'
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  GetFunctionConfigurationCommandOutput
} from '@aws-sdk/client-lambda'

// --- Types for the manifest file ---
interface LocalFunctionMapping {
  local_path: string // Path to the handler file relative to project_root (e.g., "src/lambdas/myHandler.ts")
  handler_export: string // The name of the exported handler function (e.g., "handler")
  role_arn: string // IAM role ARN of the deployed function (mandatory for this implementation)
  project_root?: string // Optional: If not project root where manifest is, specify one.
}

interface LiveLambdaMap {
  [deployedFunctionName: string]: LocalFunctionMapping
}

// --- Helper to load the mapping manifest ---
let live_lambda_map_cache: LiveLambdaMap | null = null

async function load_live_lambda_map(
  manifest_path: string
): Promise<LiveLambdaMap> {
  if (live_lambda_map_cache) {
    return live_lambda_map_cache
  }
  try {
    const map_content = await fs.readFile(manifest_path, 'utf-8')
    live_lambda_map_cache = JSON.parse(map_content) as LiveLambdaMap
    console.log(`[Live Lambda] Loaded function map from ${manifest_path}`)
    return live_lambda_map_cache
  } catch (error) {
    console.error(
      `[Live Lambda] Error reading or parsing map file ${manifest_path}:`,
      error
    )
    throw new Error(`Could not load or parse ${manifest_path}.`)
  }
}

// --- Helper to create a Lambda-like context for the local handler ---
function create_local_handler_context(
  forwarded_context: any,
  remaining_time_override?: () => number
) {
  const deadline_ms = parseInt(forwarded_context.deadline_ms, 10)
  return {
    ...forwarded_context, // Includes aws_request_id, function_name, etc. from Go extension
    getRemainingTimeInMillis:
      remaining_time_override ||
      (() => {
        if (isNaN(deadline_ms)) {
          return 300000 // Default to 5 minutes if deadline_ms is invalid
        }
        return Math.max(0, deadline_ms - Date.now())
      })
    // done, succeed, fail are for callback-style handlers, less common with async/await
  }
}

export async function execute_proxied_request_locally(
  proxied_request_data: {
    event_payload: any
    context: any /* from Go extension */
  },
  project_root_dir: string // Absolute path to the project root where manifest and code reside
) {
  const { event_payload, context: remote_context } = proxied_request_data
  const deployed_function_name = remote_context.function_name

  if (!deployed_function_name) {
    throw new Error(
      '[Live Lambda] Deployed function name not found in remote context.'
    )
  }

  console.log(
    `[Live Lambda] Processing request for deployed function: ${deployed_function_name}`
  )

  const manifest_file_path = path.join(project_root_dir, 'live-lambda-map.json')
  const function_map = await load_live_lambda_map(manifest_file_path)
  const mapping_details = function_map[deployed_function_name]

  if (!mapping_details) {
    throw new Error(
      `[Live Lambda] No local mapping found for function: ${deployed_function_name} in ${manifest_file_path}`
    )
  }
  if (!mapping_details.role_arn) {
    throw new Error(
      `[Live Lambda] 'role_arn' is missing in mapping for ${deployed_function_name}. It is required.`
    )
  }

  const { local_path, handler_export, role_arn } = mapping_details
  const effective_project_root =
    mapping_details.project_root || project_root_dir
  const absolute_handler_path = path.resolve(effective_project_root, local_path)

  // 1. Assume the IAM role
  const sts_client = new STSClient({ region: remote_context.aws_region })
  const assume_role_session_name = `live-lambda-${deployed_function_name
    .replace(/[^a-zA-Z0-9_=,.@-]/g, '_')
    .substring(0, 50)}-${remote_context.request_id.substring(0, 8)}`

  console.log(
    `[Live Lambda] Assuming role: ${role_arn} with session name: ${assume_role_session_name}`
  )
  const assume_role_command = new AssumeRoleCommand({
    RoleArn: role_arn,
    RoleSessionName: assume_role_session_name,
    DurationSeconds: 900 // 15 minutes
  })

  let temporary_credentials: Credentials
  try {
    const assumed_role_response = await sts_client.send(assume_role_command)
    if (!assumed_role_response.Credentials) {
      throw new Error('Credentials not returned from AssumeRole call.')
    }
    temporary_credentials = assumed_role_response.Credentials
    console.log(`[Live Lambda] Successfully assumed role: ${role_arn}`)
  } catch (err) {
    console.error(`[Live Lambda] Error assuming role ${role_arn}:`, err)
    throw new Error(
      `Failed to assume role ${role_arn}: ${(err as Error).message}`
    )
  }

  // TODO: Should be forwarded from context - to verify
  // 2. Fetch deployed Lambda's environment variables
  const lambda_client_for_config = new LambdaClient({
    region: remote_context.aws_region,
    credentials: {
      accessKeyId: temporary_credentials.AccessKeyId!,
      secretAccessKey: temporary_credentials.SecretAccessKey!,
      sessionToken: temporary_credentials.SessionToken!
    }
  })

  let deployed_env_vars: Record<string, string> = {}
  try {
    console.log(
      `[Live Lambda] Fetching configuration for: ${deployed_function_name}`
    )
    const config_response: GetFunctionConfigurationCommandOutput =
      await lambda_client_for_config.send(
        new GetFunctionConfigurationCommand({
          FunctionName: deployed_function_name
        }) // Use deployed_function_name
      )
    if (config_response.Environment && config_response.Environment.Variables) {
      deployed_env_vars = config_response.Environment.Variables
      console.log(
        `[Live Lambda] Fetched environment variables for ${deployed_function_name}.`
      )
    }
  } catch (err) {
    console.warn(
      `[Live Lambda] Warning: Could not fetch environment variables for ${deployed_function_name} (using assumed role):`,
      err
    )
    // Continue execution, local handler will use its current environment or defaults
  }

  // 3. Prepare environment for local execution
  const original_process_env = { ...process.env }
  const execution_env: Record<string, string | undefined> = {
    ...process.env, // Start with current server's env
    ...deployed_env_vars, // Override with deployed function's env vars
    AWS_ACCESS_KEY_ID: temporary_credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: temporary_credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: temporary_credentials.SessionToken,
    AWS_REGION: remote_context.aws_region, // Ensure AWS_REGION is from the invoked lambda
    // Mimic other standard Lambda env vars using remote_context
    AWS_LAMBDA_FUNCTION_NAME: remote_context.function_name,
    AWS_LAMBDA_FUNCTION_VERSION: remote_context.function_version,
    AWS_LAMBDA_FUNCTION_MEMORY_SIZE: remote_context.memory_size_mb, // from your Go ext context
    AWS_LAMBDA_LOG_GROUP_NAME: remote_context.log_group_name,
    AWS_LAMBDA_LOG_STREAM_NAME: remote_context.log_stream_name
  }

  Object.keys(process.env).forEach((key) => delete process.env[key]) // Clear existing
  Object.assign(process.env, execution_env) // Assign new execution env

  // 4. Load and execute the local handler
  let result
  console.log(`[Live Lambda] Importing local module: ${absolute_handler_path}`)
  try {
    const module_url = pathToFileURL(absolute_handler_path).href
    const handler_module = await import(module_url)
    const handler_function = handler_module[handler_export]

    if (typeof handler_function !== 'function') {
      throw new Error(
        `Handler '${handler_export}' not found or not a function in ${absolute_handler_path}`
      )
    }

    const local_handler_context = create_local_handler_context(remote_context)
    console.log(
      `[Live Lambda] Executing local handler '${handler_export}' for request ID ${remote_context.request_id}`
    )
    result = await handler_function(event_payload, local_handler_context)
    console.log(
      `[Live Lambda] Local handler execution successful for request ID ${remote_context.request_id}.`
    )
  } catch (error: any) {
    console.error(
      `[Live Lambda] Error during local handler execution (request ID ${remote_context.request_id}):`,
      error
    )
    // Format error similar to how Lambda would return it
    result = {
      errorType: error.name || 'Error',
      errorMessage:
        error.message || 'Unknown error in local handler execution.',
      stackTrace: error.stack ? error.stack.split('\n') : []
    }
  } finally {
    // 5. Restore original process environment
    Object.keys(process.env).forEach((key) => delete process.env[key])
    Object.assign(process.env, original_process_env)
    console.log(
      `[Live Lambda] Restored original process environment after request ID ${remote_context.request_id}.`
    )
  }
  return result
}
