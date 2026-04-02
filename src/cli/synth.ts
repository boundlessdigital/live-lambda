import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../lib/logger.js'

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
const CDK_SYNTH_OUTPUT = 'cdk.out/application'

export function get_cdk_app_entrypoint(): string | undefined {
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    return cdk_json.app as string | undefined
  } catch {
    return undefined
  }
}

export function get_cdk_watch_config(): { exclude?: string[]; gitignore?: boolean } | undefined {
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    return cdk_json.watch as { exclude?: string[]; gitignore?: boolean } | undefined
  } catch {
    return undefined
  }
}

export function run_cdk_synth(): void {
  const entrypoint = get_cdk_app_entrypoint()
  if (!entrypoint) {
    logger.warn('No cdk.json found — skipping synth. Handler assets may not be available.')
    return
  }

  logger.info('Running CDK synth to generate handler assets...')
  try {
    execSync(
      `npx cdk synth --all --quiet --output ${CDK_SYNTH_OUTPUT} --app '${entrypoint}'`,
      { stdio: 'inherit', env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error' } }
    )
    logger.info('CDK synth complete — handler assets ready.')
    merge_synth_asset_paths()
  } catch (error) {
    logger.error(`CDK synth failed: ${error}`)
    logger.warn('Handler assets may be missing. Local handler execution will fail for uncompiled functions.')
  }
}

export function merge_synth_asset_paths(): void {
  const outputs_path = path.join(process.cwd(), CDK_OUTPUTS_FILE)
  const manifest_path = path.join(process.cwd(), CDK_SYNTH_OUTPUT, 'manifest.json')

  if (!fs.existsSync(outputs_path) || !fs.existsSync(manifest_path)) return

  try {
    const outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf-8'))
    const manifest = JSON.parse(fs.readFileSync(manifest_path, 'utf-8'))

    let updated = 0

    for (const [artifact_id, artifact] of Object.entries(manifest.artifacts ?? {})) {
      const art = artifact as { type?: string; properties?: { stackName?: string; templateFile?: string } }
      if (art.type !== 'aws:cloudformation:stack') continue

      const cf_stack_name = art.properties?.stackName
      const template_file = art.properties?.templateFile
      if (!cf_stack_name || !template_file) continue

      const template_path = path.join(process.cwd(), CDK_SYNTH_OUTPUT, template_file)
      if (!fs.existsSync(template_path)) continue

      const template = JSON.parse(fs.readFileSync(template_path, 'utf-8'))
      const template_outputs = template.Outputs ?? {}

      if (!outputs[cf_stack_name]) continue

      for (const [key, value] of Object.entries(template_outputs)) {
        if (!key.includes('CdkOutAssetPath')) continue
        const val = (value as { Value?: string }).Value
        if (!val) continue

        const existing = outputs[cf_stack_name][key]
        if (existing !== val) {
          outputs[cf_stack_name][key] = val
          updated++
        }
      }
    }

    if (updated > 0) {
      fs.writeFileSync(outputs_path, JSON.stringify(outputs, null, 2))
      logger.info(`Updated ${updated} asset path(s) in outputs.json from synth`)
    }
  } catch (error) {
    logger.debug(`Failed to merge synth asset paths: ${error}`)
  }
}

export { CDK_OUTPUTS_FILE, CDK_SYNTH_OUTPUT }
