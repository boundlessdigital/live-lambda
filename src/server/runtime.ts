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

// --- Types for parsing cdk.out/outputs.json ---
interface CdkOutput {
  [key: string]: string
}

interface CdkOutputs {
  [stackName: string]: CdkOutput
}

// --- Helper to load and transform the CDK outputs into a mapping manifest ---
let live_lambda_map_cache: LiveLambdaMap | null = null

async function load_live_lambda_map(
  manifest_path: string
): Promise<LiveLambdaMap> {
  if (live_lambda_map_cache) {
    return live_lambda_map_cache
  }

  try {
    const outputs_content = await fs.readFile(manifest_path, 'utf-8')
    const cdk_outputs = JSON.parse(outputs_content) as CdkOutputs

    const live_lambda_map: LiveLambdaMap = {}

    for (const stack_name in cdk_outputs) {
      const outputs = cdk_outputs[stack_name]

      // Find keys for ARN, Role, Handler, and CdkOutAssetPath.
      const function_arn_key = Object.keys(outputs).find((k) =>
        k.endsWith('FunctionArn')
      );
      const role_arn_key = Object.keys(outputs).find((k) => k.endsWith('RoleArn'));
      const handler_key = Object.keys(outputs).find((k) => k.endsWith('Handler'));
      const cdk_out_asset_path_key = Object.keys(outputs).find((k) =>
        k.endsWith('CdkOutAssetPath')
      );

      if (
        !function_arn_key ||
        !role_arn_key ||
        !handler_key ||
        !cdk_out_asset_path_key
      ) {
        // This might be a stack like the layer stack or one missing required outputs.
        continue;
      }

      const function_arn = outputs[function_arn_key];
      const role_arn = outputs[role_arn_key];
      const handler_string = outputs[handler_key];
      const cdk_out_asset_path_value = outputs[cdk_out_asset_path_key]; // e.g., "cdk.out/asset.XYZ"

      const deployed_function_name = function_arn.split(':').pop();
      if (!deployed_function_name) {
        console.warn(
          `[Live Lambda] Could not parse function name from ARN ${function_arn} for stack ${stack_name}. Skipping.`
        );
        continue;
      }

      const handler_parts = handler_string.split('.');
      if (handler_parts.length !== 2) {
        console.warn(
          `[Live Lambda] Invalid handler format "${handler_string}" for stack ${stack_name}. Skipping.`
        );
        continue;
      }
      const [handler_file_name_from_handler, handler_export] = handler_parts;

      const cdk_out_directory_abs_path = path.dirname(manifest_path); // e.g., /path/to/project/cdk.out
      // The cdk_out_asset_path_value is like "cdk.out/asset.XYZ", we only need "asset.XYZ"
      const asset_directory_name_relative_to_cdk_out = path.basename(
        cdk_out_asset_path_value
      );

      // The actual file to load is inside the asset directory, and it's typically .js after bundling by NodejsFunction
      const target_handler_file_in_asset_dir = `${handler_file_name_from_handler}.js`;
      
      // This is the path to the handler file, relative to the cdk.out directory.
      const local_path_relative_to_cdk_out = path.join(
        asset_directory_name_relative_to_cdk_out,
        target_handler_file_in_asset_dir
      ); // e.g., "asset.XYZ/index.js"

      // Full absolute path for fs.access check
      const full_absolute_path_to_handler_in_asset_dir = path.join(
        cdk_out_directory_abs_path,
        local_path_relative_to_cdk_out
      );

      try {
        await fs.access(full_absolute_path_to_handler_in_asset_dir);
        live_lambda_map[deployed_function_name] = {
          local_path: local_path_relative_to_cdk_out, // Path relative to project_root (which is cdk.out)
          handler_export,
          role_arn,
          project_root: cdk_out_directory_abs_path, // Absolute path to cdk.out
        };
      } catch (access_error) {
        console.warn(
          `[Live Lambda] Could not access handler file for ${handler_string} at ${full_absolute_path_to_handler_in_asset_dir}. Error: ${access_error}. Skipping.`
        );
        continue;
      }
    }

    if (Object.keys(live_lambda_map).length === 0) {
      throw new Error(
        `Could not construct any function mappings from ${manifest_path}.`
      )
    }

    live_lambda_map_cache = live_lambda_map
    console.log(
      `[Live Lambda] Loaded and transformed function map from ${manifest_path}`
    )
    console.log(
      '[Live Lambda] Constructed map:',
      JSON.stringify(live_lambda_map, null, 2)
    )
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
