import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { CfnOutput, Stack } from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'
import path from 'node:path'
import { LiveLambdaLayerStack } from '../stacks/layer.stack.js'

export interface LiveLambdaLayerAspectProps {
  readonly layer_stack: LiveLambdaLayerStack
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
interface ManifestRow {
  stack: string
  logical_id: string
  source_path: string
  handler: string
  arn_output: string // CloudFormation output logical ID
}

const rows: ManifestRow[] = []

export class LiveLambdaLayerAspect implements cdk.IAspect {
  private readonly props: LiveLambdaLayerAspectProps
  public static readonly function_mappings: {
    [deployedFunctionName: string]: LiveLambdaMapEntryForCDK
  } = {}

  constructor(props: LiveLambdaLayerAspectProps) {
    this.props = props
  }

  public visit(node: IConstruct): void {
    if (node instanceof NodejsFunction) {
      const function_path = node.node.path
      const stack_name = node.stack.stackName

      const stack = cdk.Stack.of(node)
      stack.addDependency(this.props.layer_stack)

      const cfn_function = node.node.defaultChild as lambda.CfnFunction // L1 construct

      if (should_skip_function(this.props, function_path, stack_name)) {
        return
      }

      // Try to recover the original code path
      const source_path = resolve_source_path(node)

      if (!source_path) {
        console.error(
          `Could not determine source path for Lambda function ${node.node.path}`
        )
      } else {
        console.log(`Adding function mapping for ${function_path}`)
        console.log(`Source path: ${source_path}`)
        console.log(`Handler: ${cfn_function.handler}`)
        console.log(`Role ARN: ${cfn_function.role}`)

        new cdk.CfnOutput(node.stack, `${node.node.id}SourcePath`, {
          value: path.relative(process.cwd(), source_path),
          description: `Source path of the Lambda function ${node.node.path}`,
          exportName: `${node.stack.stackName}-${node.node.id}-SourcePath`
        })
      }

      // Use a more unique ID for the imported layer version per function to avoid conflicts
      const layer_import_id =
        `LiveLambdaProxyLayerImport-${node.node.id.replace(
          /[^a-zA-Z0-9-]/g,
          ''
        )}`.slice(0, 255)

      const layer_arn = ssm.StringParameter.valueForStringParameter(
        stack,
        this.props.layer_stack.layer_arn_ssm_parameter
      )

      const imported_layer = lambda.LayerVersion.fromLayerVersionArn(
        node,
        layer_import_id,
        layer_arn
      )
      node.addLayers(imported_layer)

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
        new CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
          value: path.join('cdk.out', asset_path_from_cfn_options),
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
          new CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
            value: path.join('cdk.out', asset_metadata_entry.data),
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

function should_skip_function(
  props: LiveLambdaLayerAspectProps,
  function_path: string,
  stack_name: string
): boolean {
  if (
    props.include_patterns &&
    !props.include_patterns.some((pattern) => function_path.includes(pattern))
  ) {
    return true
  }

  const excludedStackPrefixes = ['LiveLambda-', 'SSTBootstrap', 'CDKToolkit']

  if (excludedStackPrefixes.some((prefix) => stack_name.startsWith(prefix))) {
    return true
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
    return true
  }

  return false
}

function resolve_source_path(fn: lambda.Function): string | undefined {
  // ① specialised constructs that expose '.entry'
  if ('entry' in fn && typeof (fn as any).entry === 'string') {
    return (fn as any).entry
  }

  // ② plain AssetCode keeps 'path' (older CDK) or 'assetPath' (CDK ≥2.130)
  // @ts-ignore
  const code = fn.code as any
  if (typeof code?.path === 'string') return code.path
  if (typeof code?.assetPath === 'string') return code.assetPath

  // ③ look at metadata injected by CDK synth (always exists for asset-based code)
  const cfn = fn.node.defaultChild as lambda.CfnFunction
  console.log(JSON.stringify(fn.node.metadata, null, 2))
  console.log(JSON.stringify(cfn.node.metadata, null, 2))
  for (const meta of cfn.node.metadata) {
    if (
      meta.type === 'aws:asset:path' &&
      typeof meta.data === 'string' &&
      meta.data.trim() !== ''
    ) {
      return meta.data
    }
  }

  return undefined
}
