import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from './stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from './stacks/layer.stack.js'
import { LiveLambdaLayerAspect } from './aspects/live-lambda-layer.aspect.js'

export interface LiveLambdaInstallProps {
  env: cdk.Environment
  skip_layer?: boolean
  /**
   * Additional IAM principal ARNs that should be allowed to assume Lambda execution roles.
   * By default, any principal in the same AWS account can assume the role (using account root).
   * Use this to add cross-account principals if needed.
   * Example: ['arn:aws:iam::OTHER_ACCOUNT:user/developer']
   */
  developer_principal_arns?: string[]
}

export class LiveLambda {
  public static install(app: cdk.App, props?: LiveLambdaInstallProps): void {
    const { env } = props ?? {}

    const { api } = new AppSyncStack(app, 'AppSyncStack', { env })

    const layer_stack = new LiveLambdaLayerStack(app, 'LiveLambda-LayerStack', {
      api,
      env
    })

    const aspect = new LiveLambdaLayerAspect({
      api,
      layer_stack,
      developer_principal_arns: props?.developer_principal_arns
    })

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
