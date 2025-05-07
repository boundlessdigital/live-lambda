import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as path from 'path'
import {
  NodejsFunction,
  BundlingOptions,
  OutputFormat
} from 'aws-cdk-lib/aws-lambda-nodejs'
import {
  Runtime,
  FunctionUrlAuthType,
  Architecture
} from 'aws-cdk-lib/aws-lambda'

export interface SampleInfrastructureStackProps extends cdk.StackProps {
  // Define any stack-specific props here
}

export class SampleInfrastructureStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: SampleInfrastructureStackProps
  ) {
    super(scope, id, props)

    const common_bundling_options: BundlingOptions = {
      externalModules: ['aws-sdk'], // Exclude AWS SDK v2
      target: 'node20',
      minify: false, // Optional: set to true for production
    }

    const my_url_lambda = new NodejsFunction(this, 'MyUrlLambda', {
      projectRoot: path.join(__dirname, '../..'), // projectRoot is now live-lambda/sample-app/
      entry: path.join(__dirname, '../../backend/handlers/my-url-handler.ts'),
      depsLockFilePath: path.join(__dirname, '../../pnpm-lock.yaml'), // This is now inside projectRoot
      handler: 'handler', // Name of the exported function in the handler file
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64, // Or X86_64 if preferred
      bundling: common_bundling_options,
      format: OutputFormat.ESM,
      environment: {
        NODE_OPTIONS: '--enable-source-maps' // Recommended for better debugging
      }
    })

    const function_url = my_url_lambda.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM
      // cors: { // Optional: Configure CORS if you need to call it from a browser
      //   allowedOrigins: ['*'],
      //   allowedMethods: ['GET', 'POST'],
      // }
    })

    new cdk.CfnOutput(this, 'MyUrlLambdaFunctionUrl', {
      value: function_url.url,
      description: 'The URL of the MyUrlLambda function'
    })
  }
}
