import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface LiveLambdaLayerStackProps extends cdk.StackProps {
  readonly api: appsync.EventApi
}

export class LiveLambdaLayerStack extends cdk.Stack {
  public readonly layer: lambda.LayerVersion

  constructor(scope: Construct, id: string, props: LiveLambdaLayerStackProps) {
    super(scope, id, props)

    // Artifacts are prepared by scripts/build-extension-artifacts.sh in the dist/ directory
    // The root 'dist' directory will contain the necessary 'extensions/' subdirectory
    // and 'live-lambda-runtime-wrapper.sh' for the layer.
    // The asset for the layer is the entire compiled 'dist' directory.
    // After refactoring, __dirname is '.../dist/cdk/stacks', so we go up two levels.
    const extension_path = join(__dirname, '..', '..')

    const logical_id = 'LiveLambdaProxyLayer'

    this.layer = new lambda.LayerVersion(this, logical_id, {
      layerVersionName: 'live-lambda-proxy',
      // The assets are pre-built by scripts/build-extension-artifacts.sh
      // So, we point directly to the directory containing the prepared layer structure
      // and do not need CDK's bundling.
      code: lambda.Code.fromAsset(extension_path),
      compatibleRuntimes: [
        lambda.Runtime.PROVIDED_AL2023,
        lambda.Runtime.NODEJS_18_X,
        lambda.Runtime.NODEJS_LATEST
      ],
      description:
        'Layer to conditionally forward Lambda invocations to AppSync for live development.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaProxyLayerArn', {
      value: this.layer.layerVersionArn,
      description: 'ARN of the Live Lambda Proxy Layer'
    })
  }
}
