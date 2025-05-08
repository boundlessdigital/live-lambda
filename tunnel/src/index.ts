import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps, BundlingOptions, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * @internal
 */
const DEFAULT_BUNDLING_OPTIONS: BundlingOptions = {
  target: 'node20',
  format: OutputFormat.ESM, // Ensure ESM output
  // externalModules: ['@aws-sdk/*'], // Example: if you want to use AWS SDK provided by Lambda runtime
};

/**
 * Properties for the LiveLambdaTunnel construct.
 */
export interface LiveLambdaTunnelProps {
  /**
   * The original Lambda function that this construct might replace with a stub.
   */
  readonly lambda_to_proxy: lambda.IFunction // Use IFunction for broader compatibility

  /**
   * Flag to determine if the live lambda stub should be deployed.
   * If true, a stub Lambda is deployed.
   * If false (or undefined), the original lambda_function is expected to be used as-is.
   */
  readonly live_mode_active?: boolean

  /**
   * URL for the AppSync Event API HTTP endpoint (e.g., https://<id>.appsync-api.<region>.amazonaws.com/event)
   */
  readonly appsync_event_api_url?: string

  /**
   * The ID of the AppSync Event API
   */
  readonly appsync_api_id: string

  /**
   * Namespace for AppSync channels (e.g., 'liveLambda')
   */
  readonly appsync_channel_namespace?: string

  /**
   * Optional NodejsFunctionProps to customize the stub Lambda.
   * Properties like 'runtime', 'handler', 'entry' will be overridden IF NOT EXPLICITLY PROVIDED BELOW.
   */
  readonly stub_lambda_props?: NodejsFunctionProps

  /**
   * Optional explicit entry file for the stub Lambda, relative to projectRoot.
   * If not provided, calculated based on default tunnel structure.
   */
  readonly stub_lambda_entry_path?: string;

  /**
   * Optional explicit project root for the stub Lambda bundling.
   * If not provided, calculated based on default tunnel structure.
   */
  readonly stub_lambda_project_root?: string;

  /**
   * Optional explicit deps lock file path for the stub Lambda bundling.
   * If not provided, calculated based on default tunnel structure.
   */
  readonly stub_lambda_deps_lock_file_path?: string;
}

/**
 * The LiveLambdaTunnel construct.
 *
 * When `live_mode_active` is true, this construct provisions a "stub" Lambda function
 * that proxies requests to a local development server via an AppSync Event API channel.
 * The Function URL will point to this stub.
 *
 * When `live_mode_active` is false, the Function URL will point directly to the original `lambda_to_proxy`.
 * For now, it deploys a simple stub that logs the event and returns a message.
 */
export class LiveLambdaTunnel extends Construct {
  public readonly active_lambda_target: lambda.IFunction;
  public readonly stub_lambda?: NodejsFunction; // Make it public if stack needs to access it (e.g., for grantPublish)

  constructor(scope: Construct, id: string, props: LiveLambdaTunnelProps) {
    super(scope, id);
    console.log(`LiveLambdaTunnel (${id}) CONSTRUCTOR_ENTRY. live_mode_active: ${props.live_mode_active}, lambda_to_proxy defined: ${!!props.lambda_to_proxy}`);

    // Determine which Lambda function is active based on live_mode_active
    if (props.live_mode_active) {
      console.log(`LiveLambdaTunnel (${id}): Live mode is ACTIVE. Stubbing ${props.lambda_to_proxy.functionName}.`);

      // Ensure required props for live mode are present
      if (!props.appsync_event_api_url || !props.appsync_channel_namespace) {
        throw new Error(
          `LiveLambdaTunnel (${id}): In live mode, 'appsync_event_api_url', 'appsync_api_id', and 'appsync_channel_namespace' must be provided.`
        );
      }

      // Path calculations: Use provided props if available, otherwise calculate defaults.
      const monorepo_root = props.stub_lambda_project_root || path.join(__dirname, '../../../'); // Example: /Users/name/repo/
      const stub_entry_relative_to_monorepo = props.stub_lambda_entry_path || 'tunnel/src/lambda-proxy/handler.ts';
      const absolute_stub_entry = path.resolve(monorepo_root, stub_entry_relative_to_monorepo);
      const stub_deps_lock_file_path = props.stub_lambda_deps_lock_file_path || path.join(monorepo_root, 'pnpm-lock.yaml');

      const stub_lambda_description = `Stub Lambda for Live Lambda Tunnel - Deployed: ${Date.now()}`;

      const default_stub_props: NodejsFunctionProps = {
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'handler', // Default handler name in stub_lambda_proxy/handler.ts
        projectRoot: monorepo_root,
        entry: absolute_stub_entry,
        depsLockFilePath: stub_deps_lock_file_path,
        bundling: {
          format: OutputFormat.ESM,
          minify: false,
          sourceMap: true,
          sourcesContent: false, // Set to true if you need to debug into node_modules, otherwise false.
          target: 'node20',
          mainFields: ['module', 'main'], // Recommended for ESM
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);", // For packages that might still use require
          // externalModules: ['@aws-sdk/*'], // AWS SDK v3 provided by Node 20 runtime
        },
        environment: {
          APPSYNC_EVENT_API_URL: props.appsync_event_api_url!, // Safe due to check above
          APPSYNC_CHANNEL_NAMESPACE: props.appsync_channel_namespace!, // Safe due to check above
          ORIGINAL_FUNCTION_ARN: props.lambda_to_proxy.functionArn,
          // NODE_OPTIONS: '--enable-source-maps', // Already in DEFAULT_BUNDLING_OPTIONS banner
        },
        description: stub_lambda_description, // Added unique description
        ...props.stub_lambda_props, // User-provided props override defaults
      };

      this.stub_lambda = new NodejsFunction(this, 'StubProxyLambda', default_stub_props);
      this.active_lambda_target = this.stub_lambda;

      // Clear existing AppSync-related policies before adding new ones to prevent conflicts
      // This is a bit of a hack; ideally, we'd manage the policy resource more directly
      // or ensure SIDs are stable and an update replaces the old statement.
      // For now, to ensure we're testing *only* the new policy structure from docs:
      // this.stub_lambda!.role!.node.tryRemoveChild('DefaultPolicy'); // Cascade: DIAGNOSTIC - Commenting out

      const api_arn = `arn:aws:appsync:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:apis/${props.appsync_api_id}`;
      const channel_namespace_arn = `${api_arn}/channelNamespace/${props.appsync_channel_namespace!}`;

      // Policy based on AWS Docs Example for specific channel namespace
      // https://docs.aws.amazon.com/appsync/latest/eventapi/configure-event-api-auth.html (AWS_IAM authorization section)
      this.stub_lambda!.addToRolePolicy(
        new iam.PolicyStatement({
          sid: `AppSyncConnectPolicy${Date.now()}`,
          actions: ['appsync:connect'],
          effect: iam.Effect.ALLOW,
          resources: [api_arn],
        }),
      );

      /* Cascade: Commenting out this custom policy to rely on EventApi.grantPublish()
      this.stub_lambda!.addToRolePolicy(
        new iam.PolicyStatement({
          sid: `AppSyncPublishToNamespacePolicy${Date.now()}`,
          actions: ['appsync:EventPublish'], // CORRECTED ACTION
          effect: iam.Effect.ALLOW,
          resources: [`${api_arn}/*`], // Broadened resource for diagnostics
        }),
      );
      */

      // TEMPORARY DIAGNOSTIC POLICY: Grant broad AppSync permissions
      this.stub_lambda!.addToRolePolicy(
        new iam.PolicyStatement({
          sid: `TemporaryBroadAppSyncDebugPolicy${Date.now()}`,
          actions: ['appsync:*'],
          effect: iam.Effect.ALLOW,
          resources: ['*'], 
        })
      );

      // Add a dummy policy statement to force CloudFormation to see a change
      const dummy_sid = `DummyPolicyToForceUpdate${Date.now()}`;
      this.stub_lambda!.addToRolePolicy(
        new iam.PolicyStatement({
          sid: dummy_sid,
          actions: ['sts:GetCallerIdentity'], // A simple, harmless action
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        })
      );

      // --- End IAM Policy ---

      // Environment variables are passed via default_stub_props.environment
    } else {
      console.log(`LiveLambdaTunnel (${id}): Live mode is NOT active. Using original Lambda: ${props.lambda_to_proxy.functionName}`);
      this.active_lambda_target = props.lambda_to_proxy;
    }

    // This check is technically no longer needed if logic above is sound, but good as a safeguard.
    if (!this.active_lambda_target) {
      // This state should be unreachable if the constructor logic is correct.
      throw new Error(`LiveLambdaTunnel (${id}): active_lambda_target was not set! This indicates a critical logic error in the construct.`);
    }
  }
}
