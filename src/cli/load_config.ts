import * as path from 'path'
import { pathToFileURL } from 'url'
import { logger } from '../lib/logger.js'
import { LiveLambda, ResolvedLiveLambdaConfig } from '../cdk/live_lambda.js'

/**
 * Import and execute the user's CDK app to get LiveLambda configuration.
 * This runs the app which calls LiveLambda.configure(), setting the static config.
 */
export async function load_cdk_app_config(entrypoint: string): Promise<ResolvedLiveLambdaConfig> {
  // Reset any previous config
  LiveLambda.reset()

  // Parse the entrypoint command to extract the script path
  // Common patterns: "npx tsx app.ts", "npx ts-node app.ts", "node app.js"
  const parts = entrypoint.split(' ')
  let script_path: string | undefined

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.endsWith('.ts') || part.endsWith('.js') || part.endsWith('.mjs')) {
      script_path = part
      break
    }
  }

  if (!script_path) {
    throw new Error(
      `Could not determine CDK app script from entrypoint: "${entrypoint}". ` +
      `Expected a command ending with .ts, .js, or .mjs file.`
    )
  }

  // Resolve to absolute path and import
  const absolute_path = path.resolve(process.cwd(), script_path)
  const file_url = pathToFileURL(absolute_path).href

  logger.debug(`Loading CDK app from: ${absolute_path}`)

  try {
    await import(file_url)
  } catch (error) {
    throw new Error(
      `Failed to load CDK app from "${script_path}": ${error instanceof Error ? error.message : error}`
    )
  }

  // Get the config that was set by LiveLambda.configure()
  if (!LiveLambda.is_configured()) {
    throw new Error(
      'LiveLambda.configure() was not called in your CDK app. ' +
      'Add LiveLambda.configure(app, { app_name, stage }) to your app.ts.'
    )
  }

  return LiveLambda.get_config()
}
