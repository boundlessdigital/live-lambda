import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'

interface LiveLambdaLayerAspectProps {
  api: appsync.EventApi
  layer_arn: string
}

export class LiveLambdaLayerAspect implements cdk.IAspect {
  private readonly props: LiveLambdaLayerAspectProps

  constructor(props: LiveLambdaLayerAspectProps) {
    this.props = props
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
          this.props.layer_arn
        )
      )

      node.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'appsync:EventConnect',
            'appsync:EventPublish',
            'appsync:EventSubscribe'
          ],
          resources: [`${this.props.api.apiArn}/*`]
        })
      )

      node.addEnvironment(
        'AWS_LAMBDA_EXEC_WRAPPER',
        '/opt/live-lambda-extension'
      )
      node.addEnvironment('LIVE_LAMBDA_DEBUG', 'true')
    }
  }
}
