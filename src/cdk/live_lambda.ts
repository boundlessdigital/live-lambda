import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { AppSyncStack } from './stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from './stacks/layer.stack.js'
import { LiveLambdaLayerAspect, RegionalInfra } from './aspects/live-lambda-layer.aspect.js'
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
  /**
   * Additional AWS regions that need LiveLambda infrastructure.
   *
   * By default, LiveLambda creates AppSync + Layer stacks only in the primary `env` region.
   * If your CDK app deploys Lambda functions to other regions (e.g., global stacks in us-east-1
   * while regional stacks are in us-east-2), those Lambdas need their own LiveLambda infra
   * because Lambda layers are region-specific and SSM parameters resolve per-region.
   *
   * Provide additional region strings here and LiveLambda will create the necessary
   * infrastructure stacks in each region. The aspect will automatically route each Lambda
   * to the correct regional infrastructure.
   *
   * @example
   * LiveLambda.install(app, {
   *   env: { account: '123456789012', region: 'us-east-2' },
   *   additional_regions: ['us-east-1'],  // Global stacks deploy here
   * })
   */
  additional_regions?: string[]
  /**
   * Construct path patterns to exclude from LiveLambda instrumentation.
   * Functions whose construct path contains any of these patterns will not
   * get the LiveLambda layer or environment variables.
   * Example: ['ScheduledConfigSync'] to exclude infrastructure Lambdas.
   */
  exclude_patterns?: string[]
  /**
   * Lambda architectures to include in the layer.
   * Defaults to both ['x86_64', 'arm64']. Set to a single architecture
   * to halve the layer size (~8MB per binary).
   */
  architectures?: ('x86_64' | 'arm64')[]
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

    // Primary region infrastructure
    const appsync_stack = new AppSyncStack(scope, appsync_id, {
      env,
      prefix,
      ssm_paths: appsync_ssm_paths(prefix)
    })

    const layer_stack = new LiveLambdaLayerStack(scope, layer_id, {
      api: appsync_stack.api,
      env,
      ssm_parameter_path: layer_arn_ssm_path(prefix),
      layer_version_name: layer_version_name(prefix),
      architectures: props?.architectures,
    })

    // Build regional infra map (region → { appsync_stack, layer_stack })
    const primary_region = env?.region
    const regional_infra: Map<string, RegionalInfra> = new Map()

    if (primary_region) {
      regional_infra.set(primary_region, { appsync_stack, layer_stack })
    }

    // Create infrastructure for additional regions
    for (const region of props?.additional_regions ?? []) {
      if (region === primary_region) continue

      const region_env: cdk.Environment = { account: env?.account, region }
      const region_short = region.replace(/-/g, '')

      const r_appsync_id = auto_prefix
        ? `${APPSYNC_STACK_NAME}-${region_short}`
        : `${prefix}-${APPSYNC_STACK_NAME}-${region_short}`

      const r_layer_id = auto_prefix
        ? `${LAYER_STACK_NAME}-${region_short}`
        : `${prefix}-${LAYER_STACK_NAME}-${region_short}`

      const r_appsync = new AppSyncStack(scope, r_appsync_id, {
        env: region_env,
        prefix,
        ssm_paths: appsync_ssm_paths(prefix)
      })

      const r_layer = new LiveLambdaLayerStack(scope, r_layer_id, {
        api: r_appsync.api,
        env: region_env,
        ssm_parameter_path: layer_arn_ssm_path(prefix),
        architectures: props?.architectures,
        layer_version_name: layer_version_name(prefix)
      })

      regional_infra.set(region, { appsync_stack: r_appsync, layer_stack: r_layer })
    }

    const aspect = new LiveLambdaLayerAspect({
      appsync_stack,
      layer_stack,
      regional_infra: regional_infra.size > 0 ? regional_infra : undefined,
      developer_principal_arns: props?.developer_principal_arns,
      exclude_patterns: props?.exclude_patterns,
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
