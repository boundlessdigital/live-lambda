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
      if (node.node.path.includes('CustomResource') || node.node.path.includes('SingletonLambda')) {
        return;
      }
      if (node.stack.stackName.startsWith('AwsCdkKms')) {
        return;
      }

      const liveLayer = lambda.LayerVersion.fromLayerVersionArn(
        node, 
        'ImportedLiveLambdaLayer', 
        this.layerArn
      );
      node.addLayers(liveLayer);
      node.addEnvironment('AWS_LAMBDA_EXEC_WRAPPER', '/opt/live-lambda-extension');
      node.addEnvironment('LIVE_LAMBDA_DEBUG', 'true');
    }
  }
}

export class LiveLambda {
  private static getLayerArn(): string | undefined {
    try {
      const appRoot = process.cwd();
      const filePath = path.resolve(appRoot, OUTPUTS_JSON_PATH);
      console.log(`LiveLambda Aspect: Attempting to read Layer ARN from: ${filePath}`);
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
