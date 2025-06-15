import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'
import path from 'node:path'

export interface LiveLambdaLayerAspectProps {
  readonly layer_arn: string
  readonly api: appsync.EventApi
  include_patterns?: string[]
  exclude_patterns?: string[]
}

interface LiveLambdaMapEntryForCDK {
  local_path: string // Path to TS source file, relative to project root
  handler_export: string // Exported handler name
  role_arn: string
  // project_root is implicitly where cdk.json is, or can be configured
}

export class LiveLambdaLayerAspect implements cdk.IAspect {
  private readonly props: LiveLambdaLayerAspectProps
  public static readonly function_mappings: {
    [deployedFunctionName: string]: LiveLambdaMapEntryForCDK
  } = {}

  constructor(props: LiveLambdaLayerAspectProps) {
    this.props = props
  }

  public visit(node: IConstruct): void {
    if (node instanceof lambda.Function) {
      const function_path = node.node.path
      const stack_name = node.stack.stackName

      const cfn_function = node.node.defaultChild as lambda.CfnFunction // L1 construct

      if (
        this.props.include_patterns &&
        !this.props.include_patterns.some((pattern) =>
          function_path.includes(pattern)
        )
      ) {
        return
      }

      const excludedStackPrefixes = [
        'LiveLambda-',
        'SSTBootstrap',
        'CDKToolkit'
      ]
      if (
        excludedStackPrefixes.some((prefix) => stack_name.startsWith(prefix))
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
          function_path.includes(pattern)
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
          resources: [`${this.props.api.apiArn}/*`, `${this.props.api.apiArn}`]
        })
      )

      node.addEnvironment(
        'AWS_LAMBDA_EXEC_WRAPPER',
        '/opt/live-lambda-runtime-wrapper.sh'
      )

      // Set the listener port for the extension's Runtime API Proxy
      node.addEnvironment('LRAP_LISTENER_PORT', '8082')

      // Set the official extension name, required by the Go extension to register itself
      node.addEnvironment('AWS_LAMBDA_EXTENSION_NAME', 'live-lambda-extension')

      // Add AppSync configuration as environment variables for the extension
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_REGION',
        this.props.api.env.region
      )
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_REALTIME_HOST',
        this.props.api.realtimeDns
      )
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_HTTP_HOST',
        this.props.api.httpDns
      )

      // Add CloudFormation outputs for Function ARN and Role ARN
      new cdk.CfnOutput(node.stack, `${node.node.id}FunctionArn`, {
        value: node.functionArn,
        description: `ARN of the Lambda function ${node.node.path}`,
        exportName: `${node.stack.stackName}-${node.node.id}-FunctionArn`
      })

      if (node.role) {
        new cdk.CfnOutput(node.stack, `${node.node.id}RoleArn`, {
          value: node.role.roleArn,
          description: `ARN of the execution role for Lambda function ${node.node.path}`,
          exportName: `${node.stack.stackName}-${node.node.id}-RoleArn`
        })
      }

      // Output the Handler String
      if (cfn_function.handler) {
        new cdk.CfnOutput(node.stack, `${node.node.id}Handler`, {
          value: cfn_function.handler,
          description: `Handler string for function ${node.node.path}.`,
          exportName: `${node.stack.stackName}-${node.node.id}-Handler`
        })
      } else {
        console.warn(
          `[Live Lambda Aspect] Handler string not found for ${node.node.path}. Cannot output Handler.`
        )
      }

      // Output the path of the asset within cdk.out (Staged Asset Path)
      let cdkOutAssetPathValue: string | undefined
      const cfnOptionsMetadata = cfn_function.cfnOptions?.metadata
      const asset_path_from_cfn_options = cfnOptionsMetadata?.['aws:asset:path']

      if (typeof asset_path_from_cfn_options === 'string') {
        cdkOutAssetPathValue = path.join('cdk.out', asset_path_from_cfn_options)
        new cdk.CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
          value: cdkOutAssetPathValue,
          description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
          exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`
        })
      } else {
        // Fallback to trying node.metadata if cfnOptions didn't work
        const asset_metadata_entry = cfn_function.node.metadata.find(
          (m: any) => m.type === 'aws:asset:path'
        )
        if (
          asset_metadata_entry &&
          typeof asset_metadata_entry.data === 'string'
        ) {
          cdkOutAssetPathValue = path.join('cdk.out', asset_metadata_entry.data)
          new cdk.CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
            value: cdkOutAssetPathValue,
            description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
            exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`
          })
        } else {
          // If both methods fail, log the warning.
          console.warn(
            `[Live Lambda Aspect] Could not find 'aws:asset:path' metadata for ${node.node.path} using cfnOptions.metadata or node.metadata. Cannot output cdk.out asset path.`
          )
        }
      }
    }
  }
}
