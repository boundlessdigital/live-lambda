import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { AppSyncStack } from './stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from './stacks/layer.stack.js'
import { LiveLambdaLayerAspect } from './aspects/live-lambda-layer.aspect.js'
import {
  CONTEXT_APP_NAME,
  CONTEXT_ENVIRONMENT,
  CONTEXT_APP_ID,
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
  compute_prefix,
  layer_arn_ssm_path,
  layer_version_name,
  appsync_ssm_paths
} from '../lib/constants.js'

export interface LiveLambdaInstallProps {
  env: cdk.Environment
  skip_layer?: boolean
  /**
   * Override the computed prefix for stack naming.
   * Default: `{app_name}-{environment}[-{app_id}]` from cdk.json context.
   */
  prefix?: string
  /**
   * Automatically prefix all stack names (consumer + internal) using a CDK Stage.
   * When true (default), install() returns a Stage scope — create your stacks under it.
   * When false, only internal stacks get prefixed. Consumer stacks are unaffected.
   */
  auto_prefix_stacks?: boolean
  /**
   * Additional IAM principal ARNs that should be allowed to assume Lambda execution roles.
   * By default, any principal in the same AWS account can assume the role (using account root).
   * Use this to add cross-account principals if needed.
   * Example: ['arn:aws:iam::OTHER_ACCOUNT:user/developer']
   */
  developer_principal_arns?: string[]
}

export class LiveLambda {
  /**
   * Install live-lambda infrastructure into a CDK app.
   * Returns a scope (Stage or App) under which consumer stacks should be created.
   *
   * Reads `app_name`, `environment`, and optional `app_id` from CDK context (cdk.json).
   * These are used to compute a prefix that namespaces all stack names.
   */
  public static install(app: cdk.App, props?: LiveLambdaInstallProps): Construct {
    const { env } = props ?? {}

    const prefix = resolve_prefix(app, props?.prefix)
    const auto_prefix = props?.auto_prefix_stacks !== false

    // Create scope: a Stage for auto-prefixing, or the app itself
    const scope: Construct = auto_prefix
      ? new cdk.Stage(app, prefix, { env })
      : app

    // Internal stack IDs — when using a Stage, the Stage name auto-prefixes.
    // When not using a Stage, we manually prefix the construct IDs.
    const appsync_id = auto_prefix ? APPSYNC_STACK_NAME : `${prefix}-${APPSYNC_STACK_NAME}`
    const layer_id = auto_prefix ? LAYER_STACK_NAME : `${prefix}-${LAYER_STACK_NAME}`

    const appsync_stack = new AppSyncStack(scope, appsync_id, {
      env,
      prefix,
      ssm_paths: appsync_ssm_paths(prefix)
    })

    const layer_stack = new LiveLambdaLayerStack(scope, layer_id, {
      api: appsync_stack.api,
      env,
      ssm_parameter_path: layer_arn_ssm_path(prefix),
      layer_version_name: layer_version_name(prefix)
    })

    const aspect = new LiveLambdaLayerAspect({
      appsync_stack,
      layer_stack,
      developer_principal_arns: props?.developer_principal_arns
    })

    if (!props?.skip_layer) {
      cdk.Aspects.of(scope).add(aspect)
    }

    return scope
  }
}

function resolve_prefix(app: cdk.App, override?: string): string {
  if (override) return override

  const app_name = app.node.tryGetContext(CONTEXT_APP_NAME) as string | undefined
  const environment = app.node.tryGetContext(CONTEXT_ENVIRONMENT) as string | undefined
  const app_id = app.node.tryGetContext(CONTEXT_APP_ID) as string | undefined

  if (!app_name) {
    throw new Error(
      `Missing required CDK context '${CONTEXT_APP_NAME}'. ` +
      `Set it in cdk.json: { "context": { "${CONTEXT_APP_NAME}": "my-app" } }`
    )
  }
  if (!environment) {
    throw new Error(
      `Missing required CDK context '${CONTEXT_ENVIRONMENT}'. ` +
      `Set it in cdk.json: { "context": { "${CONTEXT_ENVIRONMENT}": "development" } }`
    )
  }

  return compute_prefix(app_name, environment, app_id)
}
