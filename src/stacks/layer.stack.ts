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

    const extension_path = join(__dirname, '..', 'layer', 'extension')

    const date = Date.now()
    const logical_id = `LiveLambdaProxyLayer-${date}`

    this.layer = new lambda.LayerVersion(this, logical_id, {
      layerVersionName: 'live-lambda-proxy',
      code: lambda.Code.fromAsset(extension_path, {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          user: 'root',
          command: [
            'bash',
            '-c',
            [
              'npm install',
              'npm run build',
              'mkdir -p /asset-output/extensions/bin',
              'cp live-lambda-extension /asset-output/extensions/live-lambda-extension',
              'mv extensions/bin/* /asset-output/extensions/bin/',
              'chmod +x /asset-output/extensions/live-lambda-extension',
              'chmod +x /asset-output/extensions/bin/*'
            ].join(' && ')
          ]
        }
      }),
      compatibleRuntimes: [
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
