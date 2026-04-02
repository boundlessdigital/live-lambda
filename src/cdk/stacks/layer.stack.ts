import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  LAYER_LOGICAL_ID,
  LAYER_DESCRIPTION,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN
} from '../../lib/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface LiveLambdaLayerStackProps extends cdk.StackProps {
  readonly api: appsync.EventApi
  /** Namespaced SSM parameter path for the layer ARN. */
  readonly ssm_parameter_path: string
  /** Namespaced layer version name. */
  readonly layer_version_name: string
  /** Override asset path for testing. If not provided, uses the default dist directory. */
  readonly asset_path?: string
  /** Architectures to include. Defaults to both x86_64 and arm64. */
  readonly architectures?: ('x86_64' | 'arm64')[]
}

export class LiveLambdaLayerStack extends cdk.Stack {
  public readonly layer_arn_ssm_parameter: string
  public readonly layer: lambda.LayerVersion

  constructor(scope: Construct, id: string, props: LiveLambdaLayerStackProps) {
    super(scope, id, props)

    this.layer_arn_ssm_parameter = props.ssm_parameter_path

    // Artifacts are prepared by scripts/build-extension-artifacts.sh in the dist/ directory
    // The root 'dist' directory will contain the necessary 'extensions/' subdirectory
    // and 'live-lambda-runtime-wrapper.sh' for the layer.
    // The asset for the layer is the entire compiled 'dist' directory.
    // After refactoring, __dirname is '.../dist/cdk/stacks', so we go up two levels.
    const extension_path = props.asset_path ?? join(__dirname, '..', '..')

    const arch_config = props.architectures ?? ['x86_64', 'arm64']
    const compatible_architectures = arch_config.map(a =>
      a === 'arm64' ? lambda.Architecture.ARM_64 : lambda.Architecture.X86_64
    )

    const exclude_binaries: string[] = []
    if (!arch_config.includes('x86_64')) exclude_binaries.push('extensions/bin/live-lambda-extension-go-amd64')
    if (!arch_config.includes('arm64')) exclude_binaries.push('extensions/bin/live-lambda-extension-go-arm64')

    this.layer = new lambda.LayerVersion(this, LAYER_LOGICAL_ID, {
      layerVersionName: props.layer_version_name,
      code: lambda.Code.fromAsset(extension_path, {
        exclude: [
          '*.js', '*.d.ts', '*.js.map',
          'cdk/**', 'cli/**', 'lib/**', 'server/**',
          'go_extension.sha256',
          ...exclude_binaries,
        ],
      }),
      compatibleArchitectures: compatible_architectures,
      description: LAYER_DESCRIPTION,
    })

    new cdk.CfnOutput(this, OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN, {
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
