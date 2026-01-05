import {
  LambdaClient,
  GetFunctionConfigurationCommand
} from '@aws-sdk/client-lambda'
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers'
import * as path from 'path'
import { LambdaContext } from './types.js'
import * as fs from 'fs'
import * as esbuild from 'esbuild'
import * as os from 'os'
export interface ExecuteHandlerOptions {
  region: string
  function_arn: string
  event: AWSLambda.APIGatewayProxyEventV2
  context: LambdaContext
}

export async function execute_handler(
  event: AWSLambda.APIGatewayProxyEventV2,
  context: LambdaContext
) {
  console.log(JSON.stringify(event))

  return execute_module_handler({
    region: context.aws_region as string,
    function_arn: context.invoked_function_arn as string,
    event,
    context
  })
}
interface OutputsJson {
  [stack_name: string]: {
    FunctionArn?: string
    FunctionHandler?: string
    FunctionCdkOutAssetPath?: string
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
    console.log(`[live-lambda] No source map found at ${mjs_map_path} or ${js_map_path}`)
    return undefined
  }

  try {
    const sourcemap: SourceMap = JSON.parse(fs.readFileSync(sourcemap_path, 'utf-8'))

    // Find the source that's a .ts file and not in node_modules (the user's handler file)
    const user_source = sourcemap.sources.find(
      (s: string) => s.endsWith('.ts') && !s.includes('node_modules')
    )

    if (!user_source) {
      console.log(`[live-lambda] No user TypeScript source found in source map`)
      return undefined
    }

    // Resolve relative path from asset directory
    const resolved_path = path.resolve(asset_path, user_source)
    console.log(`[live-lambda] Found source from source map: ${user_source}`)
    console.log(`[live-lambda] Resolved to: ${resolved_path}`)

    return resolved_path
  } catch (error) {
    console.warn(`[live-lambda] Error parsing source map: ${error}`)
    return undefined
  }
}

/**
 * Resolves handler path and export name from outputs.json based on function ARN.
 * Prefers TypeScript source files (via source map) over compiled .mjs files.
 */
function resolve_handler_from_outputs(
  outputs: OutputsJson,
  function_arn: string
): { handler_path: string; handler_name: string; is_typescript: boolean } | undefined {
  // Search through all stacks to find the matching function ARN
  for (const stack_name of Object.keys(outputs)) {
    const stack_outputs = outputs[stack_name]
    if (stack_outputs.FunctionArn === function_arn) {
      const handler_string = stack_outputs.FunctionHandler
      const asset_path = stack_outputs.FunctionCdkOutAssetPath

      if (!handler_string || !asset_path) {
        console.warn(
          `[live-lambda] Found matching stack ${stack_name} but missing FunctionHandler or FunctionCdkOutAssetPath`
        )
        continue
      }

      // Parse handler string like "index.handler" → file="index", export="handler"
      const last_dot_index = handler_string.lastIndexOf('.')
      if (last_dot_index === -1) {
        console.warn(
          `[live-lambda] Invalid handler format: ${handler_string}. Expected format: "file.export"`
        )
        continue
      }

      const file_name = handler_string.substring(0, last_dot_index)
      const export_name = handler_string.substring(last_dot_index + 1)

      // First, try to get the original TypeScript source from source map
      const source_path = extract_source_from_sourcemap(asset_path, file_name)
      if (source_path && fs.existsSync(source_path)) {
        console.log(`[live-lambda] ✨ Using TypeScript source for ${function_arn}:`)
        console.log(`  handler_path: ${source_path}`)
        console.log(`  handler_name: ${export_name}`)
        return { handler_path: source_path, handler_name: export_name, is_typescript: true }
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
        console.warn(
          `[live-lambda] Could not find handler file at ${mjs_path} or ${js_path}`
        )
        continue
      }

      console.log(`[live-lambda] Resolved handler for ${function_arn} (compiled):`)
      console.log(`  handler_path: ${handler_path}`)
      console.log(`  handler_name: ${export_name}`)

      return { handler_path, handler_name: export_name, is_typescript: false }
    }
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
  Object.assign(process.env, config.Environment?.Variables ?? {}, {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
    AWS_SESSION_TOKEN: creds.sessionToken
  })

  /* ---------- 4 · load & run the handler ------------ */
  const abs_path = path.isAbsolute(handler_path)
    ? handler_path
    : path.resolve(process.cwd(), handler_path)

  let handler_module: Record<string, unknown>

  if (is_typescript) {
    console.log(`[live-lambda] ✨ Loading TypeScript source directly: ${abs_path}`)

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
    const temp_file = path.join(temp_dir, `live-lambda-handler-${Date.now()}.mjs`)
    fs.writeFileSync(temp_file, result.outputFiles[0].text)

    console.log(`[live-lambda] Transformed to: ${temp_file}`)
    handler_module = await import(temp_file)

    // Clean up temp file
    fs.unlinkSync(temp_file)
  } else {
    console.log(`[live-lambda] Loading compiled handler: ${abs_path}`)
    handler_module = await import(abs_path)
  }
  const handler = handler_module[handler_name]

  if (typeof handler !== 'function') {
    throw new Error(
      `Expected ${abs_path} to export a function named "${handler_name}".`
    )
  }

  return handler(event, context)
}
// const handlers = {
//   'web-handler': './src/code/web.handler.ts',
//   'listener-handler': './src/code/listener.handler.ts'
// }

//   const function_name = 'web-handler'
//   const execution_role_arn =
//     'arn:aws:iam::942189704687:role/WebLambda-WebLambdaConstructFunctionServiceRoleBFCE-NqyWgyqPfh32'
//   const region = 'us-west-1'
