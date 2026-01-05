import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface LiveLambdaLayerStackProps extends cdk.StackProps {
  readonly api: appsync.EventApi
  /** Override asset path for testing. If not provided, uses the default dist directory. */
  readonly asset_path?: string
}

export class LiveLambdaLayerStack extends cdk.Stack {
  public readonly layer_arn_ssm_parameter: string
  public readonly layer: lambda.LayerVersion

  constructor(scope: Construct, id: string, props: LiveLambdaLayerStackProps) {
    super(scope, id, props)

    this.layer_arn_ssm_parameter = `/live-lambda/layer/arn`

    // Artifacts are prepared by scripts/build-extension-artifacts.sh in the dist/ directory
    // The root 'dist' directory will contain the necessary 'extensions/' subdirectory
    // and 'live-lambda-runtime-wrapper.sh' for the layer.
    // The asset for the layer is the entire compiled 'dist' directory.
    // After refactoring, __dirname is '.../dist/cdk/stacks', so we go up two levels.
    const extension_path = props.asset_path ?? join(__dirname, '..', '..')

    const logical_id = 'LiveLambdaProxyLayer'

    this.layer = new lambda.LayerVersion(this, logical_id, {
      layerVersionName: 'live-lambda-proxy',
      code: lambda.Code.fromAsset(extension_path),
      compatibleArchitectures: [
        lambda.Architecture.ARM_64,
        lambda.Architecture.X86_64
      ],

      description:
        'Conditionally forwards Lambda invocations to AppSync for live development.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaProxyLayerArn', {
      value: this.layer.layerVersionArn,
      description: 'ARN of the Live Lambda Proxy Layer'
    })

    new ssm.StringParameter(this, 'LiveLambdaLayerArnParameter', {
      parameterName: this.layer_arn_ssm_parameter,
      stringValue: this.layer.layerVersionArn,
      description: 'ARN of the Live Lambda Proxy Layer for live-lambda'
    })
  }
}
