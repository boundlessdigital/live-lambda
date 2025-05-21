import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from '../stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from '../stacks/layer.stack.js'
import { LiveLambdaLayerAspect } from './live-lambda-layer.aspect.js'

export interface LiveLambdaInstallProps {
  env: cdk.Environment
  skip_layer?: boolean
}

export class LiveLambda {
  public static install(app: cdk.App, props?: LiveLambdaInstallProps): void {
    const { api } = new AppSyncStack(app, 'AppSyncStack', {
      env: props?.env
    })

    const { layer } = new LiveLambdaLayerStack(app, 'LiveLambda-LayerStack', {
      api,
      env: props?.env
    })

    console.log(
      `LiveLambda: Installing aspect with Layer ARN: ${layer.layerVersionArn}`
    )

    const aspect = new LiveLambdaLayerAspect({
      api,
      layer_arn: layer.layerVersionArn
    })

    if (!props?.skip_layer) {
      cdk.Aspects.of(app).add(aspect)
    }
  }
}
