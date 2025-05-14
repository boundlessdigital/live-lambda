import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface LiveLambdaLayerStackProps extends cdk.StackProps {
  readonly api: appsync.EventApi
}

export class LiveLambdaLayerStack extends cdk.Stack {
  layer: lambda.LayerVersion

  constructor(scope: Construct, id: string, props: LiveLambdaLayerStackProps) {
    super(scope, id, props)

    this.layer = new lambda.LayerVersion(this, 'LiveLambdaForwarderLayer', {
      code: lambda.Code.fromAsset(
        join(__dirname, '..', 'lambda/live-lambda.layer.ts')
      ),
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_22_X,
        lambda.Runtime.NODEJS_LATEST
      ],
      description:
        'Layer to conditionally forward Lambda invocations to AppSync for live development.',
      layerVersionName: 'live-lambda-forwarder'
    })

    new cdk.CfnOutput(this, 'LiveLambdaForwarderLayerArn', {
      value: this.layer.layerVersionArn,
      description: 'ARN of the Live Lambda Forwarder Layer'
    })
  }
}
