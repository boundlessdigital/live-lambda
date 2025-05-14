import * as cdk from 'aws-cdk-lib'
import { EventApi } from 'aws-cdk-lib/aws-appsync'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { Construct } from 'constructs'
import {
  NodejsFunction,
  NodejsFunctionProps,
  OutputFormat
} from 'aws-cdk-lib/aws-lambda-nodejs'
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface LambdaStubStackProps extends cdk.StackProps {
  readonly api: EventApi
  readonly live_lambda_enabled?: boolean
}

export class LambdaStubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LambdaStubStackProps) {
    super(scope, id, props)

    const { api } = props

    const stub_lambda = new NodejsFunction(this, 'StubLambda', {
      entry: join(__dirname, '..', 'lambda', 'stub.handler.ts'),
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: cdk.Duration.seconds(900),
      memorySize: 1024,
      bundling: {
        format: OutputFormat.ESM,
        minify: false,
        sourceMap: true,
        sourcesContent: false,
        target: 'node20'
      }
    })

    api.grantPublish(stub_lambda)
  }
}
