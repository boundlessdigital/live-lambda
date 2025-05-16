import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { IConstruct } from 'constructs'

export class LiveLambdaLayerAspect implements cdk.IAspect {
  private layer_arn: string

  constructor(layer_arn: string) {
    this.layer_arn = layer_arn
  }

  public visit(node: IConstruct): void {
    if (node instanceof lambda.Function) {
      const functionPath = node.node.path
      const stackName = node.stack.stackName

      const excludedStackPrefixes = [
        'LiveLambda-',
        'SSTBootstrap',
        'CDKToolkit'
      ]
      if (
        excludedStackPrefixes.some((prefix) => stackName.startsWith(prefix))
      ) {
        return
      }

      const internalFunctionPathPatterns = [
        'CustomResourceHandler',
        'Framework/Resource',
        'Providerframework',
        'LogRetention',
        'SingletonLambda',
        '/NodejsBuildV1$/Resource',
        '/AssetVersionNotifier$/Resource'
      ]
      if (
        internalFunctionPathPatterns.some((pattern) =>
          functionPath.includes(pattern)
        )
      ) {
        return
      }

      // Use a more unique ID for the imported layer version per function to avoid conflicts
      const layer_import_id =
        `LiveLambdaProxyLayerImport-${node.node.id.replace(
          /[^a-zA-Z0-9-]/g,
          ''
        )}`.slice(0, 255)
      node.addLayers(
        lambda.LayerVersion.fromLayerVersionArn(
          node,
          layer_import_id,
          this.layer_arn
        )
      )
      node.addEnvironment(
        'AWS_LAMBDA_EXEC_WRAPPER',
        '/opt/live-lambda-extension'
      )
      node.addEnvironment('LIVE_LAMBDA_DEBUG', 'true')
    }
  }
}
