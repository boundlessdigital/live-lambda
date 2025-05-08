import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  Runtime,
  Architecture,
  FunctionUrl,
  FunctionUrlAuthType
} from 'aws-cdk-lib/aws-lambda'
import { OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sqs from 'aws-cdk-lib/aws-sqs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface WebLambdaStackProps extends cdk.StackProps {
  readonly queue: sqs.Queue
}

export class WebLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebLambdaStackProps) {
    super(scope, id, props)

    const web_lambda = new NodejsFunction(this, 'WebLambda', {
      entry: join(__dirname, '..', '..', 'code', 'web.handler.ts'),
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: cdk.Duration.seconds(900),
      memorySize: 256,
      environment: {
        QUEUE_URL: props.queue.queueUrl
      },
      bundling: {
        format: OutputFormat.ESM,
        minify: false,
        sourceMap: true,
        sourcesContent: false,
        target: 'node20'
      }
    })

    props.queue.grantSendMessages(web_lambda)

    const functionUrl = new FunctionUrl(this, 'FunctionUrl', {
      function: web_lambda,
      authType: FunctionUrlAuthType.NONE
    })

    new cdk.CfnOutput(this, 'WebLambdaArn', {
      value: web_lambda.functionArn
    })

    new cdk.CfnOutput(this, 'WebLambdaUrl', {
      value: functionUrl.url
    })
  }
}
