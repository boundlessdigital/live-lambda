import {
  LambdaClient,
  GetFunctionConfigurationCommand
} from '@aws-sdk/client-lambda'
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers'
import * as path from 'path'
import { LambdaContext } from './types.js'
import * as fs from 'fs'
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

/**
 * Resolves handler path and export name from outputs.json based on function ARN
 */
function resolve_handler_from_outputs(
  outputs: OutputsJson,
  function_arn: string
): { handler_path: string; handler_name: string } | undefined {
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

      // Try both .mjs (ESM) and .js extensions - CDK's NodejsFunction uses .mjs by default
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

      console.log(`[live-lambda] Resolved handler for ${function_arn}:`)
      console.log(`  handler_path: ${handler_path}`)
      console.log(`  handler_name: ${export_name}`)

      return { handler_path, handler_name: export_name }
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

  const { handler_path, handler_name } = resolved_handler

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

  const handler_module = await import(abs_path)
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
