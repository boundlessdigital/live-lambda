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
export async function execute_module_handler({
  region,
  function_arn,
  event,
  context
}: ExecuteHandlerOptions): Promise<unknown> {
  /* ---------- 1 · fetch live configuration ---------- */
  const { function_name } = context
  const outputs = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'cdk.out', 'outputs.json'),
      'utf-8'
    )
  )

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
  const abs_path = path.isAbsolute(context.handler_path)
    ? context.handler_path
    : path.resolve(process.cwd(), context.handler_path)

  const handler_module = await import(abs_path)
  const handler = handler_module[context.handler_name] // Use dynamically determined export name

  if (typeof handler !== 'function') {
    throw new Error(
      `Expected ${abs_path} to export a function named "${context.handler_name}".`
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
