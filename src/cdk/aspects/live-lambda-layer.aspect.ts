import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { CfnOutput } from 'aws-cdk-lib'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'
import path from 'node:path'
import { logger } from '../../lib/logger.js'
import {
  get_layer_arn_ssm_parameter,
  get_ssm_param_appsync_api_arn,
  get_ssm_param_appsync_http_host,
  get_ssm_param_appsync_realtime_host,
  get_ssm_param_appsync_region
} from '../../lib/constants.js'

export interface LiveLambdaLayerAspectProps {
  /**
   * The SSM parameter prefix for looking up bootstrap values.
   * Example: /live-lambda/my-app/dev
   */
  ssm_prefix: string
  /**
   * The stack name prefix used for identifying bootstrap stacks.
   * Pattern: {app_name}-{stage}-
   */
  stack_prefix: string
  /**
   * Patterns to include specific functions. If specified, only functions
   * matching at least one pattern will have the layer applied.
   */
  include_patterns?: string[]
  /**
   * Patterns to exclude specific functions from having the layer applied.
   */
  exclude_patterns?: string[]
  /**
   * Additional IAM principal ARNs that should be allowed to assume Lambda execution roles.
   * By default, any principal in the same AWS account can assume the role (using account root).
   * Use this to add cross-account principals if needed.
   * Example: ['arn:aws:iam::OTHER_ACCOUNT:user/developer']
   */
  developer_principal_arns?: string[]
}

// Cache for SSM parameter lookups per stack to avoid duplicate resources
interface StackSsmCache {
  layer_arn: string
  api_arn: string
  http_host: string
  realtime_host: string
  region: string
}

const stack_ssm_cache = new WeakMap<cdk.Stack, StackSsmCache>()

/**
 * CDK Aspect that configures NodejsFunction constructs for LiveLambda.
 *
 * This aspect reads configuration from SSM parameters created during
 * the bootstrap process and applies:
 * - Lambda layer for the extension
 * - Environment variables for AppSync connection
 * - IAM permissions for AppSync
 * - Role trust relationships for local development
 * - CloudFormation outputs for handler discovery
 */
export class LiveLambdaLayerAspect implements cdk.IAspect {
  private readonly props: LiveLambdaLayerAspectProps
  private readonly bootstrap_stack_prefix: string

  constructor(props: LiveLambdaLayerAspectProps) {
    this.props = props
    // Bootstrap stacks are named {stack_prefix}LiveLambda*
    this.bootstrap_stack_prefix = `${props.stack_prefix}LiveLambda`
  }

  public visit(node: IConstruct): void {
    if (!(node instanceof NodejsFunction)) {
      return
    }

    const function_path = node.node.path
    const stack_name = node.stack.stackName

    if (should_skip_function(this.props, function_path, stack_name, this.bootstrap_stack_prefix)) {
      return
    }

    const stack = cdk.Stack.of(node)
    const cfn_function = node.node.defaultChild as lambda.CfnFunction

    // Get or create SSM parameter lookups for this stack
    const ssm_params = this.get_ssm_params(stack)

    // Add the Lambda layer
    this.add_layer(node, ssm_params.layer_arn)

    // Add IAM permissions for AppSync
    this.add_appsync_permissions(node, ssm_params.api_arn)

    // Add trust relationship for local development
    this.add_role_trust(node)

    // Add environment variables
    this.add_environment_variables(node, ssm_params)

    // Add CloudFormation outputs
    this.add_outputs(node, cfn_function)
  }

  /**
   * Get or create SSM parameter lookups for a stack
   */
  private get_ssm_params(stack: cdk.Stack): StackSsmCache {
    let cache = stack_ssm_cache.get(stack)
    if (cache) {
      return cache
    }

    const ssm_prefix = this.props.ssm_prefix

    cache = {
      layer_arn: ssm.StringParameter.valueForStringParameter(
        stack,
        get_layer_arn_ssm_parameter(ssm_prefix)
      ),
      api_arn: ssm.StringParameter.valueForStringParameter(
        stack,
        get_ssm_param_appsync_api_arn(ssm_prefix)
      ),
      http_host: ssm.StringParameter.valueForStringParameter(
        stack,
        get_ssm_param_appsync_http_host(ssm_prefix)
      ),
      realtime_host: ssm.StringParameter.valueForStringParameter(
        stack,
        get_ssm_param_appsync_realtime_host(ssm_prefix)
      ),
      region: ssm.StringParameter.valueForStringParameter(
        stack,
        get_ssm_param_appsync_region(ssm_prefix)
      )
    }

    stack_ssm_cache.set(stack, cache)
    return cache
  }

  /**
   * Add the live-lambda layer to the function
   */
  private add_layer(node: NodejsFunction, layer_arn: string): void {
    const layer_import_id = `LiveLambdaLayer-${node.node.id.replace(
      /[^a-zA-Z0-9-]/g,
      ''
    )}`.slice(0, 255)

    const imported_layer = lambda.LayerVersion.fromLayerVersionArn(
      node,
      layer_import_id,
      layer_arn
    )
    node.addLayers(imported_layer)
  }

  /**
   * Add IAM permissions for AppSync Event API
   */
  private add_appsync_permissions(node: NodejsFunction, api_arn: string): void {
    node.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'appsync:EventConnect',
          'appsync:EventPublish',
          'appsync:EventSubscribe'
        ],
        resources: [`${api_arn}/*`, api_arn]
      })
    )
  }

  /**
   * Add trust relationship for local development
   */
  private add_role_trust(node: NodejsFunction): void {
    if (!node.role) {
      return
    }

    const role = node.role as iam.Role
    const account_id = cdk.Stack.of(node).account

    // Allow any principal in the same account to assume the role
    const account_root_principal = `arn:aws:iam::${account_id}:root`

    role.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(account_root_principal)],
        actions: ['sts:AssumeRole']
      })
    )

    // Add specific developer principals if provided
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

  /**
   * Add environment variables for the extension
   */
  private add_environment_variables(
    node: NodejsFunction,
    ssm_params: StackSsmCache
  ): void {
    node.addEnvironment(
      'AWS_LAMBDA_EXEC_WRAPPER',
      '/opt/live-lambda-runtime-wrapper.sh'
    )
    node.addEnvironment('LRAP_LISTENER_PORT', '8082')
    node.addEnvironment('AWS_LAMBDA_EXTENSION_NAME', 'live-lambda-extension')
    node.addEnvironment('LIVE_LAMBDA_APPSYNC_REGION', ssm_params.region)
    node.addEnvironment(
      'LIVE_LAMBDA_APPSYNC_REALTIME_HOST',
      ssm_params.realtime_host
    )
    node.addEnvironment(
      'LIVE_LAMBDA_APPSYNC_HTTP_HOST',
      ssm_params.http_host
    )
  }

  /**
   * Add CloudFormation outputs for handler discovery
   */
  private add_outputs(
    node: NodejsFunction,
    cfn_function: lambda.CfnFunction
  ): void {
    // Function ARN
    new CfnOutput(node.stack, `${node.node.id}Arn`, {
      value: node.functionArn,
      description: `ARN of the Lambda function ${node.node.path}`,
      exportName: `${node.stack.stackName}-${node.node.id}-FunctionArn`
    })

    // Role ARN
    if (node.role) {
      new CfnOutput(node.stack, `${node.node.id}RoleArn`, {
        value: node.role.roleArn,
        description: `ARN of the execution role for Lambda function ${node.node.path}`,
        exportName: `${node.stack.stackName}-${node.node.id}-RoleArn`
      })
    }

    // Handler string
    if (cfn_function.handler) {
      new CfnOutput(node.stack, `${node.node.id}Handler`, {
        value: cfn_function.handler,
        description: `Handler string for function ${node.node.path}.`,
        exportName: `${node.stack.stackName}-${node.node.id}-Handler`
      })
    } else {
      logger.warn(
        `Handler string not found for ${node.node.path}. Cannot output Handler.`
      )
    }

    // Asset path
    const cfn_options_metadata = cfn_function.cfnOptions?.metadata
    const asset_path_from_cfn_options = cfn_options_metadata?.['aws:asset:path']

    if (typeof asset_path_from_cfn_options === 'string') {
      new CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
        value: path.join('cdk.out', asset_path_from_cfn_options),
        description: `Path to the function's code asset within the cdk.out directory.`,
        exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`
      })
    } else {
      // Fallback to node.metadata
      const asset_metadata_entry = cfn_function.node.metadata.find(
        (m: any) => m.type === 'aws:asset:path'
      )

      if (
        asset_metadata_entry &&
        typeof asset_metadata_entry.data === 'string'
      ) {
        new CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
          value: path.join('cdk.out', asset_metadata_entry.data),
          description: `Path to the function's code asset within the cdk.out directory.`,
          exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`
        })
      } else {
        logger.warn(
          `Could not find 'aws:asset:path' metadata for ${node.node.path}. Cannot output cdk.out asset path.`
        )
      }
    }
  }
}

function should_skip_function(
  props: LiveLambdaLayerAspectProps,
  function_path: string,
  stack_name: string,
  bootstrap_stack_prefix: string
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

  // Skip bootstrap stacks (stacks that start with {app_name}-{stage}-LiveLambda)
  if (stack_name.startsWith(bootstrap_stack_prefix)) {
    return true
  }

  // Skip other infrastructure stacks by prefix
  const excluded_stack_prefixes = ['SSTBootstrap', 'CDKToolkit']

  if (excluded_stack_prefixes.some((prefix) => stack_name.startsWith(prefix))) {
    return true
  }

  // Skip internal/framework functions
  const internal_function_patterns = [
    'CustomResourceHandler',
    'Framework/Resource',
    'Providerframework',
    'LogRetention',
    'SingletonLambda',
    '/NodejsBuildV1$/Resource',
    '/AssetVersionNotifier$/Resource'
  ]

  if (
    internal_function_patterns.some((pattern) => function_path.includes(pattern))
  ) {
    return true
  }

  return false
}
