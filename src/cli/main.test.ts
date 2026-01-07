import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Command } from 'commander'

// Use vi.hoisted() to ensure mock functions are available when mocks are evaluated
const {
  mock_deploy,
  mock_destroy,
  mock_watch,
  mock_from_cdk_app,
  mock_serve,
  mock_cleanup,
  mock_read_file_sync,
  mock_chokidar_watch,
  mock_watcher_on,
  mock_logger,
  mock_check_bootstrap_status,
  mock_get_bootstrap_config,
  mock_bootstrap
} = vi.hoisted(() => ({
  mock_deploy: vi.fn(),
  mock_destroy: vi.fn(),
  mock_watch: vi.fn(),
  mock_from_cdk_app: vi.fn(),
  mock_serve: vi.fn(),
  mock_cleanup: vi.fn(),
  mock_read_file_sync: vi.fn(),
  mock_chokidar_watch: vi.fn(),
  mock_watcher_on: vi.fn(),
  mock_logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    start: vi.fn(),
    warn: vi.fn()
  },
  mock_check_bootstrap_status: vi.fn(),
  mock_get_bootstrap_config: vi.fn(),
  mock_bootstrap: vi.fn()
}))

// Mock dependencies
vi.mock('@aws-cdk/toolkit-lib', () => {
  return {
    Toolkit: vi.fn().mockImplementation(function () {
      return {
        deploy: mock_deploy,
        destroy: mock_destroy,
        watch: mock_watch,
        fromCdkApp: mock_from_cdk_app
      }
    }),
    StackSelectionStrategy: {
      PATTERN_MATCH: 'PATTERN_MATCH'
    }
  }
})

vi.mock('../server/index.js', () => {
  return {
    serve: mock_serve
  }
})

vi.mock('../cdk/toolkit/iohost.js', () => {
  return {
    CustomIoHost: vi.fn().mockImplementation(function () {
      return {
        cleanup: mock_cleanup
      }
    })
  }
})

vi.mock('../lib/logger.js', () => {
  return {
    logger: mock_logger
  }
})

vi.mock('fs', () => {
  return {
    default: {
      readFileSync: mock_read_file_sync
    },
    readFileSync: mock_read_file_sync
  }
})

vi.mock('chokidar', () => {
  return {
    default: {
      watch: mock_chokidar_watch
    }
  }
})

vi.mock('./bootstrap.js', () => {
  return {
    check_bootstrap_status: mock_check_bootstrap_status,
    get_bootstrap_config: mock_get_bootstrap_config,
    bootstrap: mock_bootstrap
  }
})

// Import after mocks
import { main } from './main.js'
import * as toolkit_lib from '@aws-cdk/toolkit-lib'
import * as iohost_module from '../cdk/toolkit/iohost.js'

describe('main', () => {
  // Mock the ICloudAssemblySource with produce() method
  const mock_dispose = vi.fn()
  function create_mock_assembly(stacks: Array<{ stackName: string; region: string }> = [
    { stackName: 'TestAppStack', region: 'us-east-1' }
  ]) {
    return {
      produce: vi.fn().mockResolvedValue({
        cloudAssembly: {
          stacksRecursively: stacks.map(s => ({
            stackName: s.stackName,
            environment: { region: s.region, account: '123456789012', name: 'test' }
          }))
        },
        dispose: mock_dispose
      })
    }
  }
  let mock_assembly: ReturnType<typeof create_mock_assembly>
  let original_process_on: typeof process.on
  let sigint_handler: (() => Promise<void>) | null = null
  let sigterm_handler: (() => Promise<void>) | null = null

  const default_bootstrap_config = {
    region: 'us-east-1',
    api_arn: 'arn:aws:appsync:us-east-1:123456789012:apis/test-api',
    http_host: 'test-http.appsync-api.us-east-1.amazonaws.com',
    realtime_host: 'test-realtime.appsync-realtime-api.us-east-1.amazonaws.com',
    layer_arn: 'arn:aws:lambda:us-east-1:123456789012:layer:LiveLambdaProxy:1'
  }

  function create_mock_command(name: string, opts: Record<string, any> = {}): Command {
    // Commander.js defaults autoBootstrap to true with --no-auto-bootstrap option
    // Start command requires app and stage options
    const default_opts = name === 'start' ? { autoBootstrap: true, app: 'test-app', stage: 'dev' } : {}
    return {
      name: () => name,
      opts: () => ({ ...default_opts, ...opts })
    } as unknown as Command
  }

  function create_mock_deployment(stacks: any[] = []) {
    return {
      stacks
    }
  }

  function create_default_cdk_json(
    app = 'npx ts-node app.ts',
    watch_config = { include: ['**/*.ts'] }
  ) {
    return JSON.stringify({
      app,
      watch: watch_config
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Capture signal handlers
    original_process_on = process.on
    sigint_handler = null
    sigterm_handler = null

    process.on = vi.fn((signal: string, handler: any) => {
      if (signal === 'SIGINT') sigint_handler = handler
      if (signal === 'SIGTERM') sigterm_handler = handler
      return process
    }) as any

    // Reset mock return values for chokidar
    mock_watcher_on.mockReturnValue({ on: vi.fn() })
    mock_chokidar_watch.mockReturnValue({ on: mock_watcher_on })

    // Default mock implementations
    mock_read_file_sync.mockReturnValue(create_default_cdk_json())
    mock_assembly = create_mock_assembly()
    mock_from_cdk_app.mockResolvedValue(mock_assembly)
    mock_deploy.mockResolvedValue(create_mock_deployment())
    mock_destroy.mockResolvedValue(undefined)
    mock_watch.mockResolvedValue(undefined)
    mock_serve.mockResolvedValue(undefined)

    // Bootstrap mocks
    mock_check_bootstrap_status.mockResolvedValue({ is_bootstrapped: true, version: '1' })
    mock_get_bootstrap_config.mockResolvedValue(default_bootstrap_config)
    mock_bootstrap.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.on = original_process_on
  })

  describe('cdk.json configuration', () => {
    it('should read cdk.json configuration', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_read_file_sync).toHaveBeenCalledWith('cdk.json', 'utf-8')
    })

    it('should parse app entrypoint from cdk.json', async () => {
      const custom_entrypoint = 'npx tsx custom-app.ts'
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({
          app: custom_entrypoint,
          watch: {}
        })
      )
      const command = create_mock_command('start')

      await main(command)

      expect(mock_from_cdk_app).toHaveBeenCalledWith(custom_entrypoint)
    })
  })

  describe('start command', () => {
    it('should check bootstrap status for start command', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_check_bootstrap_status).toHaveBeenCalledWith('us-east-1', '/live-lambda/test-app/dev')
    })

    it('should get bootstrap config for start command', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_get_bootstrap_config).toHaveBeenCalledWith('us-east-1', '/live-lambda/test-app/dev')
    })

    it('should auto-bootstrap by default when not bootstrapped', async () => {
      mock_check_bootstrap_status.mockResolvedValue({ is_bootstrapped: false })
      const command = create_mock_command('start') // autoBootstrap defaults to true

      await main(command)

      expect(mock_bootstrap).toHaveBeenCalledWith({
        region: 'us-east-1',
        app_name: 'test-app',
        stage: 'dev',
        ssm_prefix: '/live-lambda/test-app/dev'
      })
    })

    it('should throw error when not bootstrapped and --no-auto-bootstrap is set', async () => {
      mock_check_bootstrap_status.mockResolvedValue({ is_bootstrapped: false })
      const command = create_mock_command('start', { autoBootstrap: false })

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        expect.any(Error)
      )
    })

    it('should warn when bootstrap is outdated', async () => {
      mock_check_bootstrap_status.mockResolvedValue({
        is_bootstrapped: true,
        version: 'old',
        needs_upgrade: true
      })
      const command = create_mock_command('start')

      await main(command)

      expect(mock_logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('outdated')
      )
    })

    it('should call deploy for start command', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_deploy).toHaveBeenCalledWith(mock_assembly, {
        outputsFile: 'cdk.out/outputs.json',
        concurrency: 5,
        deploymentMethod: {
          method: 'change-set'
        }
      })
    })

    it('should start server after deployment', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_serve).toHaveBeenCalledWith({
        region: default_bootstrap_config.region,
        http: default_bootstrap_config.http_host,
        realtime: default_bootstrap_config.realtime_host,
        layer_arn: default_bootstrap_config.layer_arn
      })
    })

    it('should start watch mode after server starts', async () => {
      const watch_config = { include: ['**/*.ts'], exclude: ['node_modules'] }
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node app.ts',
          watch: watch_config
        })
      )
      const command = create_mock_command('start')

      await main(command)

      expect(mock_watch).toHaveBeenCalledWith(mock_assembly, {
        concurrency: 5,
        deploymentMethod: {
          method: 'change-set'
        },
        ...watch_config
      })
    })

    it('should set up file watcher with chokidar', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_chokidar_watch).toHaveBeenCalled()
    })
  })

  describe('destroy command', () => {
    it('should call destroy for destroy command', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_destroy).toHaveBeenCalled()
    })

    it('should log destroying message', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Destroying user development stacks...'
      )
    })

    it('should not call deploy for destroy command', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle deployment errors gracefully', async () => {
      const deploy_error = new Error('Deployment failed')
      mock_deploy.mockRejectedValueOnce(deploy_error)
      const command = create_mock_command('start')

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        deploy_error
      )
    })

    it('should handle cdk.json read errors', async () => {
      const read_error = new Error('ENOENT: no such file or directory')
      mock_read_file_sync.mockImplementation(() => {
        throw read_error
      })
      const command = create_mock_command('start')

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        read_error
      )
    })

    it('should handle invalid cdk.json format', async () => {
      mock_read_file_sync.mockReturnValue('invalid json')
      const command = create_mock_command('start')

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        expect.any(SyntaxError)
      )
    })

    it('should call cleanup even after errors', async () => {
      mock_read_file_sync.mockImplementation(() => {
        throw new Error('Test error')
      })
      const command = create_mock_command('start')

      await main(command)

      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should handle watch errors gracefully', async () => {
      const watch_error = new Error('Watch mode failed')
      mock_watch.mockRejectedValue(watch_error)
      mock_deploy.mockResolvedValue(create_mock_deployment())

      const command = create_mock_command('start')

      await main(command)

      // Watch errors bubble up through run_server, triggering cleanup and restart
      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        watch_error
      )
    })
  })

  describe('signal handling', () => {
    it('should register SIGINT handler', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
    })

    it('should register SIGTERM handler', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    })

    it('should cleanup on SIGINT', async () => {
      const command = create_mock_command('start')
      await main(command)

      expect(sigint_handler).toBeDefined()
    })

    it('should cleanup on SIGTERM', async () => {
      const command = create_mock_command('start')
      await main(command)

      expect(sigterm_handler).toBeDefined()
    })
  })

  describe('unknown commands', () => {
    it('should not call deploy or destroy for unknown commands', async () => {
      const command = create_mock_command('unknown')

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
      expect(mock_destroy).not.toHaveBeenCalled()
    })
  })

  describe('toolkit integration', () => {
    it('should create Toolkit with CustomIoHost', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(toolkit_lib.Toolkit).toHaveBeenCalledWith({
        ioHost: expect.any(Object)
      })
    })

    it('should always call cleanup in finally block', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should log cleanup message', async () => {
      const command = create_mock_command('start')

      await main(command)

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Cleaning up UI and CDK resources...'
      )
    })
  })
})
