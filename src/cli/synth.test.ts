import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mock_read_file_sync,
  mock_exists_sync,
  mock_write_file_sync,
  mock_exec_sync,
  mock_logger,
} = vi.hoisted(() => ({
  mock_read_file_sync: vi.fn(),
  mock_exists_sync: vi.fn(),
  mock_write_file_sync: vi.fn(),
  mock_exec_sync: vi.fn(),
  mock_logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mock_read_file_sync,
    existsSync: mock_exists_sync,
    writeFileSync: mock_write_file_sync,
  },
  readFileSync: mock_read_file_sync,
  existsSync: mock_exists_sync,
  writeFileSync: mock_write_file_sync,
}))

vi.mock('child_process', () => ({
  execSync: mock_exec_sync,
}))

vi.mock('../lib/logger.js', () => ({
  logger: mock_logger,
}))

import {
  get_cdk_app_entrypoint,
  get_cdk_watch_config,
  run_cdk_synth,
  merge_synth_asset_paths,
  CDK_OUTPUTS_FILE,
  CDK_SYNTH_OUTPUT,
} from './synth.js'

describe('get_cdk_app_entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return the app field from cdk.json', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx ts-node app.ts' }))

    const result = get_cdk_app_entrypoint()

    expect(result).toBe('npx ts-node app.ts')
    expect(mock_read_file_sync).toHaveBeenCalledWith('cdk.json', 'utf-8')
  })

  it('should return undefined when cdk.json has no app field', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ watch: {} }))

    const result = get_cdk_app_entrypoint()

    expect(result).toBeUndefined()
  })

  it('should return undefined when cdk.json does not exist', () => {
    mock_read_file_sync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    const result = get_cdk_app_entrypoint()

    expect(result).toBeUndefined()
  })

  it('should return undefined when cdk.json contains invalid JSON', () => {
    mock_read_file_sync.mockReturnValue('not valid json {{{')

    const result = get_cdk_app_entrypoint()

    expect(result).toBeUndefined()
  })
})

describe('get_cdk_watch_config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return the watch field from cdk.json', () => {
    const watch_config = { exclude: ['**/*.js'], gitignore: true }
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'app.ts', watch: watch_config }))

    const result = get_cdk_watch_config()

    expect(result).toEqual(watch_config)
  })

  it('should return undefined when cdk.json has no watch field', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'app.ts' }))

    const result = get_cdk_watch_config()

    expect(result).toBeUndefined()
  })

  it('should return undefined when cdk.json does not exist', () => {
    mock_read_file_sync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = get_cdk_watch_config()

    expect(result).toBeUndefined()
  })
})

describe('merge_synth_asset_paths', () => {
  const cwd = process.cwd()
  const outputs_path = `${cwd}/${CDK_OUTPUTS_FILE}`
  const manifest_path = `${cwd}/${CDK_SYNTH_OUTPUT}/manifest.json`

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update CdkOutAssetPath when synth has a different hash than outputs.json', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': {
        SomeCdkOutAssetPathKey: 'asset.old-hash-1234.zip',
        OtherOutput: 'some-value',
      }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: {
            stackName: 'MyStack',
            templateFile: 'MyStack.template.json',
          }
        }
      }
    }

    const template = {
      Outputs: {
        SomeCdkOutAssetPathKey: { Value: 'asset.new-hash-5678.zip' },
        OtherOutput: { Value: 'different-value' },
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).toHaveBeenCalledTimes(1)
    const written = JSON.parse(mock_write_file_sync.mock.calls[0][1])
    expect(written.MyStack.SomeCdkOutAssetPathKey).toBe('asset.new-hash-5678.zip')
    expect(written.MyStack.OtherOutput).toBe('some-value')
    expect(mock_logger.info).toHaveBeenCalledWith('Updated 1 asset path(s) in outputs.json from synth')
  })

  it('should skip non-CdkOutAssetPath outputs', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': {
        RegularOutput: 'old-value',
      }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    const template = {
      Outputs: {
        RegularOutput: { Value: 'new-value' },
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should return early when outputs.json does not exist', () => {
    mock_exists_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return false
      return true
    })

    merge_synth_asset_paths()

    expect(mock_read_file_sync).not.toHaveBeenCalled()
    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should return early when manifest.json does not exist', () => {
    mock_exists_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return true
      if (file_path === manifest_path) return false
      return true
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should skip when a template file does not exist', () => {
    mock_exists_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return true
      if (file_path === manifest_path) return true
      // Template file does not exist
      return false
    })

    const outputs = {
      'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'Missing.template.json' }
        }
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should skip stacks in manifest that are not in outputs.json', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'DifferentStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    const template = {
      Outputs: {
        SomeCdkOutAssetPathKey: { Value: 'asset.new.zip' }
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should count correct number of updated paths across multiple stacks', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'StackA': {
        FooCdkOutAssetPath1: 'asset.old-a1.zip',
        BarCdkOutAssetPath2: 'asset.old-a2.zip',
      },
      'StackB': {
        BazCdkOutAssetPath3: 'asset.old-b1.zip',
      }
    }

    const manifest = {
      artifacts: {
        StackAArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'StackA', templateFile: 'StackA.template.json' }
        },
        StackBArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'StackB', templateFile: 'StackB.template.json' }
        }
      }
    }

    const template_a = {
      Outputs: {
        FooCdkOutAssetPath1: { Value: 'asset.new-a1.zip' },
        BarCdkOutAssetPath2: { Value: 'asset.new-a2.zip' },
      }
    }

    const template_b = {
      Outputs: {
        BazCdkOutAssetPath3: { Value: 'asset.new-b1.zip' },
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('StackA.template.json')) return JSON.stringify(template_a)
      if (file_path.endsWith('StackB.template.json')) return JSON.stringify(template_b)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).toHaveBeenCalledTimes(1)
    expect(mock_logger.info).toHaveBeenCalledWith('Updated 3 asset path(s) in outputs.json from synth')

    const written = JSON.parse(mock_write_file_sync.mock.calls[0][1])
    expect(written.StackA.FooCdkOutAssetPath1).toBe('asset.new-a1.zip')
    expect(written.StackA.BarCdkOutAssetPath2).toBe('asset.new-a2.zip')
    expect(written.StackB.BazCdkOutAssetPath3).toBe('asset.new-b1.zip')
  })

  it('should not write if nothing changed', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': {
        SomeCdkOutAssetPathKey: 'asset.same-hash.zip',
      }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    const template = {
      Outputs: {
        SomeCdkOutAssetPathKey: { Value: 'asset.same-hash.zip' },
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should skip artifacts that are not cloudformation stacks', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        TreeArtifact: {
          type: 'cdk:tree',
          properties: {}
        },
        AssetArtifact: {
          type: 'aws:cloudformation:asset',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should skip artifacts missing stackName or templateFile', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        NoStackName: {
          type: 'aws:cloudformation:stack',
          properties: { templateFile: 'MyStack.template.json' }
        },
        NoTemplateFile: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack' }
        }
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should handle CdkOutAssetPath outputs with no Value field', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    const template = {
      Outputs: {
        SomeCdkOutAssetPathKey: { Description: 'No value here' },
      }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should handle template with no Outputs section', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = {
      'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' }
    }

    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }

    const template = {
      Resources: { SomeResource: {} }
    }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should log debug on JSON parse errors and not crash', () => {
    mock_exists_sync.mockReturnValue(true)

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return 'invalid json'
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to merge synth asset paths')
    )
    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should handle manifest with empty artifacts', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = { 'MyStack': { SomeCdkOutAssetPathKey: 'asset.old.zip' } }
    const manifest = { artifacts: {} }

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should handle manifest with no artifacts key', () => {
    mock_exists_sync.mockReturnValue(true)

    const outputs = { 'MyStack': {} }
    const manifest = {}

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      return ''
    })

    merge_synth_asset_paths()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })
})

describe('run_cdk_synth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call execSync with the correct command', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx tsx my-app.ts' }))
    mock_exists_sync.mockReturnValue(false)

    run_cdk_synth()

    expect(mock_exec_sync).toHaveBeenCalledWith(
      `npx cdk synth --all --quiet --output ${CDK_SYNTH_OUTPUT} --app 'npx tsx my-app.ts'`,
      expect.objectContaining({ stdio: 'inherit' })
    )
  })

  it('should skip synth and warn when no cdk.json exists', () => {
    mock_read_file_sync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    run_cdk_synth()

    expect(mock_exec_sync).not.toHaveBeenCalled()
    expect(mock_logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No cdk.json found')
    )
  })

  it('should skip synth when cdk.json has no app field', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ watch: {} }))

    run_cdk_synth()

    expect(mock_exec_sync).not.toHaveBeenCalled()
    expect(mock_logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No cdk.json found')
    )
  })

  it('should call merge_synth_asset_paths after successful synth', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx tsx app.ts' }))
    mock_exec_sync.mockReturnValue(undefined)
    mock_exists_sync.mockReturnValue(true)

    const outputs = { 'MyStack': { FooCdkOutAssetPath: 'asset.old.zip' } }
    const manifest = {
      artifacts: {
        MyStackArtifact: {
          type: 'aws:cloudformation:stack',
          properties: { stackName: 'MyStack', templateFile: 'MyStack.template.json' }
        }
      }
    }
    const template = {
      Outputs: { FooCdkOutAssetPath: { Value: 'asset.new.zip' } }
    }

    // After initial cdk.json read, subsequent reads are for merge
    const cwd = process.cwd()
    const outputs_path = `${cwd}/${CDK_OUTPUTS_FILE}`
    const manifest_path = `${cwd}/${CDK_SYNTH_OUTPUT}/manifest.json`

    mock_read_file_sync.mockImplementation((file_path: string) => {
      if (file_path === 'cdk.json') return JSON.stringify({ app: 'npx tsx app.ts' })
      if (file_path === outputs_path) return JSON.stringify(outputs)
      if (file_path === manifest_path) return JSON.stringify(manifest)
      if (file_path.endsWith('MyStack.template.json')) return JSON.stringify(template)
      return ''
    })

    run_cdk_synth()

    expect(mock_write_file_sync).toHaveBeenCalledTimes(1)
    expect(mock_logger.info).toHaveBeenCalledWith('Updated 1 asset path(s) in outputs.json from synth')
  })

  it('should handle synth failure gracefully without crashing', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx tsx app.ts' }))
    mock_exec_sync.mockImplementation(() => {
      throw new Error('synth process exited with code 1')
    })

    expect(() => run_cdk_synth()).not.toThrow()

    expect(mock_logger.error).toHaveBeenCalledWith(
      expect.stringContaining('CDK synth failed')
    )
    expect(mock_logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Handler assets may be missing')
    )
  })

  it('should not call merge_synth_asset_paths when synth fails', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx tsx app.ts' }))
    mock_exec_sync.mockImplementation(() => {
      throw new Error('synth failed')
    })

    run_cdk_synth()

    expect(mock_write_file_sync).not.toHaveBeenCalled()
  })

  it('should pass NPM_CONFIG_LOGLEVEL=error in env', () => {
    mock_read_file_sync.mockReturnValue(JSON.stringify({ app: 'npx tsx app.ts' }))
    mock_exists_sync.mockReturnValue(false)

    run_cdk_synth()

    const env = mock_exec_sync.mock.calls[0][1].env
    expect(env.NPM_CONFIG_LOGLEVEL).toBe('error')
  })
})
