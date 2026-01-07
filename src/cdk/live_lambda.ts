import * as cdk from 'aws-cdk-lib'
import { LiveLambdaLayerAspect } from './aspects/live-lambda-layer.aspect.js'
import { StackNamingAspect } from './aspects/stack-naming.aspect.js'
import {
  format_app_name,
  format_stage,
  get_default_ssm_prefix,
  get_stack_prefix
} from '../lib/constants.js'

/**
 * Configuration for LiveLambda.
 */
export interface LiveLambdaConfig {
  /**
   * Deployment stage (e.g., 'dev', 'staging', 'prod').
   * Used for stack naming and SSM parameter namespacing.
   */
  stage: string

  /**
   * Application name for namespace isolation.
   * Combined with stage to create unique resource names.
   */
  app_name: string

  /**
   * Custom SSM parameter prefix.
   * Default: `/live-lambda/{app_name}/{stage}`
   */
  ssm_prefix?: string

  /**
   * Skip applying the layer aspect. Useful for production deployments
   * where you don't want the live-lambda layer attached.
   */
  skip_layer?: boolean

  /**
   * Additional IAM principal ARNs that should be allowed to assume Lambda execution roles.
   * By default, any principal in the same AWS account can assume the role (using account root).
   * Use this to add cross-account principals if needed.
   * Example: ['arn:aws:iam::OTHER_ACCOUNT:user/developer']
   */
  developer_principal_arns?: string[]

  /**
   * Patterns to include specific functions. If specified, only functions
   * matching at least one pattern will have the layer applied.
   */
  include_patterns?: string[]

  /**
   * Patterns to exclude specific functions from having the layer applied.
   */
  exclude_patterns?: string[]
}

/**
 * Resolved configuration with computed values.
 */
export interface ResolvedLiveLambdaConfig extends LiveLambdaConfig {
  /**
   * Formatted app_name (lowercase, dashes).
   */
  formatted_app_name: string

  /**
   * Formatted stage (lowercase, dashes).
   */
  formatted_stage: string

  /**
   * Resolved SSM prefix (either custom or default).
   */
  resolved_ssm_prefix: string

  /**
   * Stack name prefix: {app_name}-{stage}-
   */
  stack_prefix: string
}

/**
 * LiveLambda enables real-time Lambda development by proxying invocations
 * to a local development server.
 *
 * ## Usage
 *
 * ```typescript
 * import { LiveLambda } from 'live-lambda'
 *
 * const app = new cdk.App()
 *
 * // Configure LiveLambda with app name and stage
 * // All stacks will be prefixed with {app_name}-{stage}-
 * LiveLambda.configure(app, {
 *   app_name: 'my-app',
 *   stage: 'dev',
 * })
 *
 * // Stack will be named 'my-app-dev-ApiStack' in CloudFormation
 * new MyLambdaStack(app, 'ApiStack', { env })
 * ```
 *
 * The configuration automatically:
 * - Prefixes all stack names with {app_name}-{stage}-
 * - Configures all NodejsFunction constructs with the live-lambda layer
 * - Sets up required environment variables and IAM permissions
 */
export class LiveLambda {
  private static _config: ResolvedLiveLambdaConfig | null = null

  /**
   * Configure LiveLambda on a CDK app.
   *
   * This adds aspects that:
   * 1. Prefix all stack names with {app_name}-{stage}-
   * 2. Configure all NodejsFunction constructs for live development
   *
   * @param app The CDK app to configure
   * @param config Configuration including required app_name and stage
   */
  public static configure(app: cdk.App, config: LiveLambdaConfig): void {
    // Format and validate inputs
    const formatted_app_name = format_app_name(config.app_name)
    const formatted_stage = format_stage(config.stage)

    if (!formatted_app_name) {
      throw new Error(
        `Invalid app_name: "${config.app_name}". Must contain at least one alphanumeric character.`
      )
    }

    if (!formatted_stage) {
      throw new Error(
        `Invalid stage: "${config.stage}". Must contain at least one alphanumeric character.`
      )
    }

    // Compute derived values
    const resolved_ssm_prefix = config.ssm_prefix ?? get_default_ssm_prefix(config.app_name, config.stage)
    const stack_prefix_value = get_stack_prefix(config.app_name, config.stage)

    // Store resolved config
    LiveLambda._config = {
      ...config,
      formatted_app_name,
      formatted_stage,
      resolved_ssm_prefix,
      stack_prefix: stack_prefix_value
    }

    // Add stack naming aspect (prefixes all stacks with {app_name}-{stage}-)
    cdk.Aspects.of(app).add(new StackNamingAspect({
      prefix: stack_prefix_value
    }))

    // Add layer aspect unless skipped
    if (!config.skip_layer) {
      const layer_aspect = new LiveLambdaLayerAspect({
        ssm_prefix: resolved_ssm_prefix,
        stack_prefix: stack_prefix_value,
        developer_principal_arns: config.developer_principal_arns,
        include_patterns: config.include_patterns,
        exclude_patterns: config.exclude_patterns
      })

      cdk.Aspects.of(app).add(layer_aspect)
    }
  }

  /**
   * Get the current LiveLambda configuration.
   *
   * @throws Error if configure() has not been called
   */
  public static get_config(): ResolvedLiveLambdaConfig {
    if (!LiveLambda._config) {
      throw new Error(
        'LiveLambda.configure() must be called before get_config(). ' +
        'Ensure your CDK app calls LiveLambda.configure() before synthesis.'
      )
    }
    return LiveLambda._config
  }

  /**
   * Check if LiveLambda has been configured.
   */
  public static is_configured(): boolean {
    return LiveLambda._config !== null
  }

  /**
   * Reset the configuration (primarily for testing).
   */
  public static reset(): void {
    LiveLambda._config = null
  }
}
