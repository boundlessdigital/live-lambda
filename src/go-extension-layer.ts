import { aws_lambda as lambda, Stack } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as path from 'path'

export class AppSyncExtensionLayer extends lambda.LayerVersion {
  /** Returns a singleton layer per stack */
  public static get_or_create(scope: Construct): lambda.ILayerVersion {
    const stack = Stack.of(scope)
    const id = 'AppSyncEventsLayer'
    return (
      (stack.node.tryFindChild(id) as lambda.ILayerVersion) ??
      new AppSyncExtensionLayer(stack, id)
    )
  }

  private constructor(scope: Construct, id: string) {
    super(scope, id, {
      code: lambda.Code.fromAsset(path.resolve(__dirname, '..', 'layer'), {
        bundling: {
          image: lambda.Runtime.PROVIDED_AL2023.bundlingImage,
          command: [
            'bash',
            '-c',
            [
              // Build static binary to /asset-output/extensions/
              'GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o /asset-output/extensions/appsync-extension ./cmd/extension',
              'chmod +x /asset-output/extensions/appsync-extension'
            ].join(' && ')
          ]
        }
      }),
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_22_X,
        lambda.Runtime.PYTHON_3_12
      ],
      description: 'Go Lambda extension for AppSync Events'
    })
  }
}
