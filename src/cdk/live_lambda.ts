import * as cdk from 'aws-cdk-lib'
import { LiveLambdaLayerAspect } from './aspects/live-lambda-layer.aspect.js'
import {
  format_app_name_for_ssm,
  format_app_name_for_stack
} from '../lib/constants.js'

export interface LiveLambdaInstallProps {
  /**
   * A unique name for this application's live-lambda infrastructure.
   * This isolates the bootstrap infrastructure (AppSync API, Lambda Layer)
   * from other applications using live-lambda in the same account/region.
   *
   * The name will be formatted for use in:
   * - Stack names (CamelCase): "my app" -> "LiveLambdaMyAppAppSyncStack"
   * - SSM parameters (kebab-case): "my app" -> "/live-lambda/my-app/..."
   */
  app_name: string
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
 * // Install the aspect with a unique app name
 * // The infrastructure is automatically bootstrapped when running `live-lambda start`
 * LiveLambda.install(app, { app_name: 'my-app' })
 *
 * // Create your stacks
 * new MyLambdaStack(app, 'MyStack', { env })
 * ```
 *
 * The aspect automatically configures all NodejsFunction constructs with:
 * - The live-lambda layer
 * - Required environment variables
 * - IAM permissions for AppSync
 * - Role trust relationships for local development
 */
export class LiveLambda {
  /**
   * Install the LiveLambda aspect on a CDK app.
   *
   * This adds an aspect that configures all NodejsFunction constructs
   * to work with the local development server. The aspect reads
   * configuration from SSM parameters created during bootstrap.
   *
   * @param app The CDK app to install on
   * @param props Configuration including required app_name
   */
  public static install(app: cdk.App, props: LiveLambdaInstallProps): void {
    if (props.skip_layer) {
      return
    }

    // Format the app_name for different contexts
    const ssm_namespace = format_app_name_for_ssm(props.app_name)
    const stack_namespace = format_app_name_for_stack(props.app_name)

    if (!ssm_namespace) {
      throw new Error(
        `Invalid app_name: "${props.app_name}". Must contain at least one alphanumeric character.`
      )
    }

    const aspect = new LiveLambdaLayerAspect({
      ssm_namespace,
      stack_namespace,
      developer_principal_arns: props.developer_principal_arns,
      include_patterns: props.include_patterns,
      exclude_patterns: props.exclude_patterns
    })

    cdk.Aspects.of(app).add(aspect)
  }
}
