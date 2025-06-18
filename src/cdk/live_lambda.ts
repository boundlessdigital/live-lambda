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
    const { env } = props ?? {}

    const { api } = new AppSyncStack(app, 'AppSyncStack', { env })

    const layer_stack = new LiveLambdaLayerStack(app, 'LiveLambda-LayerStack', {
      api,
      env
    })

    const aspect = new LiveLambdaLayerAspect({ api, layer_stack })

    if (!props?.skip_layer) {
      cdk.Aspects.of(app).add(aspect)

      // // Ensure all other stacks depend on the layerStack so that the SSM parameter
      // // it creates is available when other stacks are deployed and the aspect tries to read it.
      // for (const child of app.node.children) {
      //   if (child instanceof cdk.Stack && child !== layer_stack) {
      //     child.addDependency(layer_stack)
      //   }
      // }
    }
  }
}
