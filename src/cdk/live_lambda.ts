import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from './stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from './stacks/layer.stack.js'
import { LiveLambdaLayerAspect } from './aspects/live-lambda-layer.aspect.js'

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

    const aspect = new LiveLambdaLayerAspect({
      api,
      layer_arn: layer.layerVersionArn
    })

    if (!props?.skip_layer) {
      cdk.Aspects.of(app).add(aspect)
    }
  }
}
