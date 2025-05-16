import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { IConstruct } from 'constructs';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUTPUTS_JSON_PATH = 'outputs.json'; // Relative to the project root where cdk synth is run

interface CdkOutputs {
  [stackName: string]: {
    [outputKey: string]: string;
  };
}

interface LiveLambdaInfo { // Kept for consistency, but represents the ARN string directly now
  layerArn: string;
}

class LiveLambdaLayerAspect implements cdk.IAspect {
  private layerArn: string;

  constructor(layerArn: string) {
    this.layerArn = layerArn;
  }

  public visit(node: IConstruct): void {
    if (node instanceof lambda.Function) {
      const functionPath = node.node.path;
      const stackName = node.stack.stackName;

      // Exclude functions from LiveLambda's own stacks or other explicitly excluded stack prefixes
      const excludedStackPrefixes = ['LiveLambda-', 'SSTBootstrap', 'CDKToolkit']; // CDKToolkit for bootstrap stack
      if (excludedStackPrefixes.some(prefix => stackName.startsWith(prefix))) {
        // console.warn(`LiveLambda Aspect: Skipping layer for function in excluded stack: ${functionPath}`);
        return;
      }

      // Exclude common CDK internal / custom resource / framework Lambda patterns
      const internalFunctionPathPatterns = [
        'CustomResourceHandler', // General custom resources
        'Framework/Resource',    // Often seen with provider framework
        'Providerframework',     // Provider framework handlers
        'LogRetention',          // Log retention handlers
        'SingletonLambda',       // Singleton function handlers
        '/NodejsBuildV1$/Resource', // From @aws-cdk/aws-lambda-nodejs
        '/AssetVersionNotifier$/Resource', // For asset updates
        // Add more known CDK internal patterns if discovered
      ];

      if (internalFunctionPathPatterns.some(pattern => functionPath.includes(pattern))) {
        // console.warn(`LiveLambda Aspect: Skipping layer for internal/framework function: ${functionPath}`);
        return;
      }

      // If we reach here, it's a user-defined Lambda function that's not excluded.
      // Apply the layer and environment variables.
      // Ensure layerArn is valid before attempting to use it
      if (!this.layerArn) {
        // console.warn(`LiveLambda Aspect: Layer ARN is not available for ${functionPath}. Skipping.`);
        return;
      }
      
      node.addLayers(lambda.LayerVersion.fromLayerVersionArn(node, `LiveLambdaProxyLayerImport-${node.node.id}`, this.layerArn));
      node.addEnvironment('AWS_LAMBDA_EXEC_WRAPPER', '/opt/live-lambda-extension');
      node.addEnvironment('LIVE_LAMBDA_DEBUG', 'true'); // Or some other configurable value
      // console.log(`LiveLambda Aspect: Applied layer to ${functionPath} in stack ${stackName}`);
    }
  }
}

export class LiveLambda {
  private static getLayerArn(): string | undefined {
    try {
      const appRoot = process.cwd();
      const filePath = path.resolve(appRoot, OUTPUTS_JSON_PATH);
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const outputs: CdkOutputs = JSON.parse(fileContent);
        const layerStackOutputs = outputs['LiveLambda-LayerStack'];
        if (layerStackOutputs && layerStackOutputs.LiveLambdaProxyLayerArn) {
          return layerStackOutputs.LiveLambdaProxyLayerArn;
        }
        console.warn(`LiveLambda: LiveLambdaProxyLayerArn not found in ${OUTPUTS_JSON_PATH} under 'LiveLambda-LayerStack'.`);
      }
      return undefined;
    } catch (error) {
      console.warn(`LiveLambda: Error reading or parsing ${OUTPUTS_JSON_PATH}:`, error);
      return undefined;
    }
  }

  public static install(app: cdk.App): void {
    const layerArn = LiveLambda.getLayerArn();
    if (!layerArn) {
      console.warn(`LiveLambda: Layer ARN not found. Live Lambda features will not be automatically applied.`);
      return;
    }
    cdk.Aspects.of(app).add(new LiveLambdaLayerAspect(layerArn));
  }
}
