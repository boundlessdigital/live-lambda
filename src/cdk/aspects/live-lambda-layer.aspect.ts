import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { CfnOutput, Stack } from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'
import path from 'node:path'
import { LiveLambdaLayerStack } from '../stacks/layer.stack.js'
import { AppSyncStack } from '../stacks/appsync.stack.js'
import { logger } from '../../lib/logger.js'
import {
  ENV_KEY_LAMBDA_EXEC_WRAPPER,
  ENV_KEY_LRAP_LISTENER_PORT,
  ENV_KEY_EXTENSION_NAME,
  ENV_KEY_APPSYNC_REGION,
  ENV_KEY_APPSYNC_REALTIME_HOST,
  ENV_KEY_APPSYNC_HTTP_HOST,
  ENV_LAMBDA_EXEC_WRAPPER,
  ENV_LRAP_LISTENER_PORT,
  ENV_EXTENSION_NAME,
} from '../../lib/constants.js'

export interface LiveLambdaLayerAspectProps {
  readonly layer_stack: LiveLambdaLayerStack
  readonly appsync_stack: AppSyncStack
  include_patterns?: string[]
  exclude_patterns?: string[]
  /**
   * Additional IAM principal ARNs that should be allowed to assume Lambda execution roles.
   * By default, any principal in the same AWS account can assume the role (using account root).
   * Use this to add cross-account principals if needed.
   * Example: ['arn:aws:iam::OTHER_ACCOUNT:user/developer']
   */
  developer_principal_arns?: string[]
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
      stack.addDependency(this.props.appsync_stack)

      const cfn_function = node.node.defaultChild as lambda.CfnFunction // L1 construct

      if (should_skip_function(this.props, function_path, stack_name)) {
        return
      }

      // Use a unique ID derived from the full construct path for the imported layer version
      const path_suffix = node.node.path.replace(/[^a-zA-Z0-9-]/g, '-')
      const layer_import_id =
        `LiveLambdaProxyLayerImport-${path_suffix}`.slice(0, 255)

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

      // Read AppSync values from SSM to avoid cross-stack CloudFormation exports.
      // This uses dynamic references ({{resolve:ssm:...}}) resolved at deploy time,
      // which don't create Fn::ImportValue dependencies between stacks.
      const api_arn = ssm.StringParameter.valueForStringParameter(
        stack,
        this.props.appsync_stack.ssm_paths.api_arn
      )

      node.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'appsync:EventConnect',
            'appsync:EventPublish',
            'appsync:EventSubscribe'
          ],
          resources: [`${api_arn}/*`, `${api_arn}`]
        })
      )

      // Add trust relationship to allow assuming the Lambda execution role for local development
      // This enables the local dev server to run handlers with the same permissions as the deployed Lambda
      if (node.role) {
        const role = node.role as iam.Role
        const account_id = cdk.Stack.of(node).account

        // By default, allow any principal in the same account to assume the role
        // This is required for live-lambda local development to work
        const account_root_principal = `arn:aws:iam::${account_id}:root`

        role.assumeRolePolicy?.addStatements(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ArnPrincipal(account_root_principal)],
            actions: ['sts:AssumeRole']
          })
        )

        // If specific developer principals are provided, add those as well
        if (this.props.developer_principal_arns?.length) {
          for (const principal_arn of this.props.developer_principal_arns) {
            role.assumeRolePolicy?.addStatements(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.ArnPrincipal(principal_arn)],
                actions: ['sts:AssumeRole']
              })
            )
          }
        }
      }

      node.addEnvironment(ENV_KEY_LAMBDA_EXEC_WRAPPER, ENV_LAMBDA_EXEC_WRAPPER)
      node.addEnvironment(ENV_KEY_LRAP_LISTENER_PORT, ENV_LRAP_LISTENER_PORT)
      node.addEnvironment(ENV_KEY_EXTENSION_NAME, ENV_EXTENSION_NAME)

      // Add AppSync configuration as environment variables for the extension.
      // httpDns and realtimeDns are read from SSM to avoid cross-stack exports.
      const http_dns = ssm.StringParameter.valueForStringParameter(
        stack,
        this.props.appsync_stack.ssm_paths.http_dns
      )
      const realtime_dns = ssm.StringParameter.valueForStringParameter(
        stack,
        this.props.appsync_stack.ssm_paths.realtime_dns
      )
      node.addEnvironment(ENV_KEY_APPSYNC_REGION, this.props.appsync_stack.region)
      node.addEnvironment(ENV_KEY_APPSYNC_REALTIME_HOST, realtime_dns)
      node.addEnvironment(ENV_KEY_APPSYNC_HTTP_HOST, http_dns)

      // Build a unique output ID from the construct path within the stack.
      // node.node.path = "Stage/StackName/ParentConstruct/Function"
      // We strip the stack prefix to get "ParentConstruct/Function" and
      // collapse to "ParentConstruct-Function" for unique CfnOutput IDs.
      const path_in_stack = node.node.path
        .replace(new RegExp(`^.*?${node.stack.node.id}/`), '')
        .replace(/\//g, '-')
      const output_id = path_in_stack.replace(/[^a-zA-Z0-9-]/g, '')
      const sanitized_stack = node.stack.stackName.replace(/[^a-zA-Z0-9:-]/g, '-')

      // Add CloudFormation outputs for Function ARN and Role ARN
      new cdk.CfnOutput(node.stack, `${output_id}Arn`, {
        value: node.functionArn,
        description: `ARN of the Lambda function ${node.node.path}`,
        exportName: `${sanitized_stack}-${output_id}-FunctionArn`
      })

      if (node.role) {
        new cdk.CfnOutput(node.stack, `${output_id}RoleArn`, {
          value: node.role.roleArn,
          description: `ARN of the execution role for Lambda function ${node.node.path}`,
          exportName: `${sanitized_stack}-${output_id}-RoleArn`
        })
      }

      // Output the Handler String
      if (cfn_function.handler) {
        new cdk.CfnOutput(node.stack, `${output_id}Handler`, {
          value: cfn_function.handler,
          description: `Handler string for function ${node.node.path}.`,
          exportName: `${sanitized_stack}-${output_id}-Handler`
        })
      } else {
        logger.warn(
          `Handler string not found for ${node.node.path}. Cannot output Handler.`
        )
      }

      // Output the path of the asset within cdk.out (Staged Asset Path)
      const cfnOptionsMetadata = cfn_function.cfnOptions?.metadata
      const asset_path_from_cfn_options = cfnOptionsMetadata?.['aws:asset:path']

      if (typeof asset_path_from_cfn_options === 'string') {
        // With CDK Stages, asset paths are relative to the nested assembly
        // (e.g., "../asset.abc123") rather than the cdk.out root. Using
        // path.basename extracts just the asset directory name so we always
        // produce "cdk.out/asset.abc123" regardless of nesting depth.
        new CfnOutput(node.stack, `${output_id}CdkOutAssetPath`, {
          value: path.join('cdk.out', path.basename(asset_path_from_cfn_options)),
          description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
          exportName: `${sanitized_stack}-${output_id}-CdkOutAssetPath`
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
          new CfnOutput(node.stack, `${output_id}CdkOutAssetPath`, {
            value: path.join('cdk.out', path.basename(asset_metadata_entry.data)),
            description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
            exportName: `${sanitized_stack}-${output_id}-CdkOutAssetPath`
          })
        } else {
          // If both methods fail, log the warning.
          logger.warn(
            `Could not find 'aws:asset:path' metadata for ${node.node.path} using cfnOptions.metadata or node.metadata. Cannot output cdk.out asset path.`
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
  // Check include patterns first - if specified, function must match at least one
  if (
    props.include_patterns &&
    !props.include_patterns.some((pattern) => function_path.includes(pattern))
  ) {
    return true
  }

  // Check user-defined exclude patterns - if function matches any, skip it
  if (
    props.exclude_patterns &&
    props.exclude_patterns.some((pattern) => function_path.includes(pattern))
  ) {
    return true
  }

  const excluded_stack_patterns = ['LiveLambda-', 'SSTBootstrap', 'CDKToolkit']

  if (excluded_stack_patterns.some((pattern) => stack_name.includes(pattern))) {
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
