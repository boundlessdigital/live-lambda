import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from './appsync.stack.js'
import { LiveLambdaLayerStack } from './layer.stack.js'
import { LiveLambdaLayerAspect } from './live-lambda-layer.aspect.js'
import * as path from 'node:path'
import * as fs from 'node:fs'

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

      // --- Output the collected mappings ---
      console.log('Collected function mappings:'.green)
      for (const [name, mapping] of Object.entries(
        LiveLambdaLayerAspect.function_mappings
      )) {
        console.log(`Function: ${name}`)
        console.log(`  local_path: ${mapping.local_path}`)
        console.log(`  handler: ${mapping.handler_export}`)
        console.log(`  role_arn: ${mapping.role_arn}`)
      }

      const { function_mappings } = LiveLambdaLayerAspect

      if (Object.keys(function_mappings).length > 0) {
        // Determine project root (usually where cdk.json is)
        // Assuming this script itself is in 'src/cdk/' relative to project root
        const project_root_directory = path.resolve(__dirname, '../../')
        const map_file_output_path = path.join(
          project_root_directory,
          'live-lambda-map.json'
        )

        try {
          fs.writeFileSync(
            map_file_output_path,
            JSON.stringify(function_mappings, null, 2)
          )
          console.log(
            `[Live Lambda CDK] Successfully wrote function map to: ${map_file_output_path}`
          )
        } catch (err) {
          console.error('[Live Lambda CDK] Error writing function map:', err)
        }
      } else {
        console.log(
          '[Live Lambda CDK] No function mappings collected by the aspect. Map file not written.'
        )
      }
    }
  }
}
