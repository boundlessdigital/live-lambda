import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction, NodejsFunctionProps, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as path from 'path'

/**
 * Properties for the LiveLambdaTunnel construct.
 */
export interface LiveLambdaTunnelProps {
  /**
   * The original Lambda function that this construct might replace with a stub.
   */
  readonly lambda_function: lambda.IFunction // Use IFunction for broader compatibility

  /**
   * Flag to determine if the live lambda stub should be deployed.
   * If true, a stub Lambda is deployed.
   * If false (or undefined), the original lambda_function is expected to be used as-is.
   */
  readonly is_live?: boolean

  /**
   * Optional NodejsFunctionProps to customize the stub Lambda.
   * Properties like 'runtime', 'handler', 'entry' will be overridden.
   */
  readonly stub_lambda_props?: Omit<NodejsFunctionProps, 'runtime' | 'handler' | 'entry'>
}

/**
 * The LiveLambdaTunnel construct.
 *
 * When `is_live` is true, this construct provisions a "stub" Lambda function
 * that will eventually proxy requests to a local development server.
 * For now, it deploys a simple stub that logs the event and returns a message.
 */
export class LiveLambdaTunnel extends Construct {
  public readonly stub_function?: NodejsFunction
  public readonly stub_function_arn?: string;

  constructor(scope: Construct, id: string, props: LiveLambdaTunnelProps) {
    super(scope, id)

    if (props.is_live) {
      // Define the entry point for the stub Lambda handler
      // __dirname will be tunnel/dist/ at runtime, so we point to the compiled .js file
      const stub_entry_path = path.join(__dirname, 'lambda-proxy', 'handler.js')

      // Default props for the stub Lambda, can be overridden by props.stub_lambda_props
      const default_stub_props: NodejsFunctionProps = {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: stub_entry_path,
        bundling: {
          format: OutputFormat.ESM,
          minify: false,
          sourceMap: true,
          externalModules: ['aws-sdk'], // Standard practice
        },
        environment: {
          ORIGINAL_FUNCTION_ARN: props.lambda_function.functionArn,
          // Add other relevant environment variables for the stub later
        },
        // It's crucial the stub has necessary permissions.
        // For now, we assume it might need similar permissions to the original,
        // or specific permissions to communicate (e.g., with AppSync).
        // This will be refined.
        // Example: props.lambda_function.role?.grantInvoke(this.stub_function) (careful with circular dependencies)
      }

      this.stub_function = new NodejsFunction(this, 'StubProxyLambda', {
        ...default_stub_props,
        ...props.stub_lambda_props, // User-provided props override defaults
        // Ensure critical props are not overridden if they are essential for the stub's operation
        runtime: default_stub_props.runtime, // Re-assert critical props
        handler: default_stub_props.handler,
        entry: default_stub_props.entry,
        bundling: { // Deep merge bundling if necessary, or re-assert
          ...default_stub_props.bundling,
          ...(props.stub_lambda_props?.bundling || {}),
        },
      })

      this.stub_function_arn = this.stub_function.functionArn;

      // TODO: In a later step, we need to handle how the original Lambda's triggers
      // (e.g., API Gateway integration) are pointed to this stub_function instead of
      // props.lambda_function. This is a complex part of making the live mode seamless.
      // For now, the stub_function is created, but not automatically wired up to triggers.

      // Also, consider if the original props.lambda_function should be prevented from deploying
      // its full code when is_live is true, to save on deployment time/resources.
      // This might involve modifying the CfnFunction resource associated with props.lambda_function.
    } else {
      // If not is_live, this construct currently does nothing.
      // The original lambda_function defined by the user is expected to deploy as usual.
    }
  }
}
