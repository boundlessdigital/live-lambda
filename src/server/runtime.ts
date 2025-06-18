import {
  LambdaClient,
  GetFunctionConfigurationCommand
} from '@aws-sdk/client-lambda'
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers'
import * as path from 'path'

export interface ExecuteHandlerOptions {
  region?: string
  event: AWSLambda.APIGatewayProxyEventV2
  session_name?: string
  context?: unknown
}

export async function execute_module_handler(
  function_name: string,
  handler_name: string,
  handler_path: string,
  options: ExecuteHandlerOptions
): Promise<unknown> {
  /* ---------- 1 · fetch live configuration ---------- */
  const region = options.region ?? process.env.AWS_REGION ?? 'us-east-1'

  const assume_role_session_name = `live-lambda-${function_name}`
    .replace(/[^a-zA-Z0-9_=,.@-]/g, '_')
    .substring(0, 50)
    .concat(`-${Date.now().toString(36).substring(0, 8)}`)

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
  const handler = handler_module[handler_name] // Use dynamically determined export name

  if (typeof handler !== 'function') {
    throw new Error(
      `Expected ${abs_path} to export a function named "${handler_name}".`
    )
  }

  const { event, context } = options

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
