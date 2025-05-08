import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'
import { OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as sqs from 'aws-cdk-lib/aws-sqs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface ListenerLambdaProps extends cdk.StackProps {
  readonly queue: sqs.Queue
}

export class ListenerLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ListenerLambdaProps) {
    super(scope, id, props)

    const listener_lambda = new NodejsFunction(this, 'ListenerLambda', {
      entry: join(__dirname, '..', '..', 'code', 'listener.handler.ts'),
      runtime: Runtime.NODEJS_LATEST,
      architecture: Architecture.ARM_64,
      timeout: cdk.Duration.seconds(900),
      memorySize: 256,
      environment: {
        LISTENER_QUEUE_URL: props.queue.queueUrl
      },
      bundling: {
        format: OutputFormat.ESM,
        minify: false,
        sourceMap: true,
        sourcesContent: false,
        target: 'node20'
      }
    })

    props.queue.grantConsumeMessages(listener_lambda)
  }
}
