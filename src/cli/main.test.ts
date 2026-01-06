import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Command } from 'commander'
import {
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN,
  OUTPUT_EVENT_API_HTTP_HOST,
  OUTPUT_EVENT_API_REALTIME_HOST
} from '../lib/constants.js'

// Use vi.hoisted() to ensure mock functions are available when mocks are evaluated
const {
  mock_deploy,
  mock_destroy,
  mock_watch,
  mock_from_cdk_app,
  mock_serve,
  mock_cleanup,
  mock_set_emitter,
  mock_read_file_sync,
  mock_chokidar_watch,
  mock_watcher_on,
  mock_logger,
  mock_run_deploy_with_ui
} = vi.hoisted(() => ({
  mock_deploy: vi.fn(),
  mock_destroy: vi.fn(),
  mock_watch: vi.fn(),
  mock_from_cdk_app: vi.fn(),
  mock_serve: vi.fn(),
  mock_cleanup: vi.fn(),
  mock_set_emitter: vi.fn(),
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
  mock_run_deploy_with_ui: vi.fn()
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
        cleanup: mock_cleanup,
        set_emitter: mock_set_emitter
      }
    })
  }
})

vi.mock('./listr-deploy.js', () => {
  return {
    DeployEventEmitter: vi.fn().mockImplementation(function () {
      return { emit: vi.fn(), on: vi.fn() }
    }),
    run_deploy_with_ui: mock_run_deploy_with_ui
  }
})

vi.mock('./output-table.js', () => {
  return {
    format_project_outputs: vi.fn().mockReturnValue('Mock table output')
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

// Import after mocks
import { main } from './main.js'
import * as toolkit_lib from '@aws-cdk/toolkit-lib'
import * as iohost_module from '../cdk/toolkit/iohost.js'

describe('main', () => {
  let original_process_on: typeof process.on
  let console_log_spy: ReturnType<typeof vi.spyOn>
  let sigint_handler: (() => Promise<void>) | null = null
  let sigterm_handler: (() => Promise<void>) | null = null

  function create_mock_command(name: string): Command {
    return {
      name: () => name
    } as unknown as Command
  }

  function create_mock_deployment(stacks: any[] = []) {
    return {
      stacks
    }
  }

  function create_mock_assembly(stacks: any[] = []) {
    return {
      produce: vi.fn().mockResolvedValue({
        cloudAssembly: {
          stacks: stacks.map((s) => ({ stackName: s.stackName }))
        }
      })
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

    // Suppress console.log output during tests
    console_log_spy = vi.spyOn(console, 'log').mockImplementation(() => {})

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
    mock_from_cdk_app.mockResolvedValue(create_mock_assembly())
    mock_deploy.mockResolvedValue(create_mock_deployment())
    mock_destroy.mockResolvedValue(undefined)
    mock_watch.mockResolvedValue(undefined)
    mock_serve.mockResolvedValue(undefined)

    // run_deploy_with_ui calls the deploy_fn and returns its result
    mock_run_deploy_with_ui.mockImplementation(
      async (_stack_names: string[], _emitter: any, deploy_fn: () => Promise<any>) => {
        return await deploy_fn()
      }
    )
  })

  afterEach(() => {
    process.on = original_process_on
    console_log_spy.mockRestore()
  })

  describe('cdk.json configuration', () => {
    it('should read cdk.json configuration', async () => {
      const command = create_mock_command('start')
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
          }
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

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
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
          }
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      expect(mock_from_cdk_app).toHaveBeenCalledWith(custom_entrypoint)
    })
  })

  describe('start command', () => {
    it('should call deploy for start command', async () => {
      const command = create_mock_command('start')
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
          }
        }
      ]
      const mock_assembly = create_mock_assembly(stacks)
      mock_from_cdk_app.mockResolvedValue(mock_assembly)
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

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
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host.appsync.aws',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host.appsync.aws'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]:
              'arn:aws:lambda:us-east-1:123456789012:layer:LiveLambdaProxy:1'
          }
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      expect(mock_serve).toHaveBeenCalledWith({
        region: 'us-east-1',
        http: 'http-host.appsync.aws',
        realtime: 'realtime-host.appsync.aws',
        layer_arn:
          'arn:aws:lambda:us-east-1:123456789012:layer:LiveLambdaProxy:1'
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
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
          }
        }
      ]
      const mock_assembly = create_mock_assembly(stacks)
      mock_from_cdk_app.mockResolvedValue(mock_assembly)
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

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
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
            [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
          }
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      expect(mock_chokidar_watch).toHaveBeenCalledWith('.', expect.any(Object))
    })
  })

  describe('destroy command', () => {
    it('should call destroy for destroy command', async () => {
      const command = create_mock_command('destroy')
      const mock_assembly = create_mock_assembly()
      mock_from_cdk_app.mockResolvedValue(mock_assembly)

      await main(command)

      expect(mock_destroy).toHaveBeenCalledWith(mock_assembly, {
        stacks: {
          strategy: 'PATTERN_MATCH',
          patterns: ['*Lambda', '*Layer*']
        }
      })
    })

    it('should log destroying message', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Destroying development stacks...'
      )
    })

    it('should not call deploy for destroy command', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
      expect(mock_serve).not.toHaveBeenCalled()
    })
  })

  describe('server config extraction', () => {
    it('should extract server config from deployment outputs', async () => {
      const command = create_mock_command('start')
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'eu-west-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]:
              'abc123.appsync-api.eu-west-1.amazonaws.com',
            [OUTPUT_EVENT_API_REALTIME_HOST]:
              'abc123.appsync-realtime.eu-west-1.amazonaws.com'
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]:
              'arn:aws:lambda:eu-west-1:123456789012:layer:LiveLambdaProxy:5'
          }
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      expect(mock_serve).toHaveBeenCalledWith({
        region: 'eu-west-1',
        http: 'abc123.appsync-api.eu-west-1.amazonaws.com',
        realtime: 'abc123.appsync-realtime.eu-west-1.amazonaws.com',
        layer_arn:
          'arn:aws:lambda:eu-west-1:123456789012:layer:LiveLambdaProxy:5'
      })
    })

    it('should throw ServerConfigError when AppSync stack outputs are missing', async () => {
      const command = create_mock_command('start')
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {}
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {}
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      // Should fail fast with descriptive error listing missing outputs
      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        expect.objectContaining({
          name: 'ServerConfigError',
          message: expect.stringContaining('Missing required stack outputs')
        })
      )
      expect(mock_serve).not.toHaveBeenCalled()
    })

    it('should throw ServerConfigError when stacks are missing from deployment', async () => {
      const command = create_mock_command('start')
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly([]))
      mock_deploy.mockResolvedValue(create_mock_deployment([]))

      await main(command)

      // Should fail fast with descriptive error listing missing stacks
      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        expect.objectContaining({
          name: 'ServerConfigError',
          message: expect.stringContaining('Missing required stacks')
        })
      )
      expect(mock_serve).not.toHaveBeenCalled()
    })

    it('should list all missing stacks in error message', async () => {
      const command = create_mock_command('start')
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly([]))
      mock_deploy.mockResolvedValue(create_mock_deployment([]))

      await main(command)

      // Verify error message includes both stack names
      const error_call = mock_logger.error.mock.calls.find(
        (call: any[]) => call[0] === 'Error during initial server run, attempting cleanup and restart:'
      )
      expect(error_call).toBeDefined()
      expect(error_call![1].message).toContain(APPSYNC_STACK_NAME)
      expect(error_call![1].message).toContain(LAYER_STACK_NAME)
    })

    it('should list all missing outputs in error message', async () => {
      const command = create_mock_command('start')
      const stacks = [
        {
          stackName: APPSYNC_STACK_NAME,
          environment: { region: 'us-east-1' },
          outputs: {
            [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host'
            // Missing realtime host
          }
        },
        {
          stackName: LAYER_STACK_NAME,
          outputs: {} // Missing layer ARN
        }
      ]
      mock_from_cdk_app.mockResolvedValue(create_mock_assembly(stacks))
      mock_deploy.mockResolvedValue(create_mock_deployment(stacks))

      await main(command)

      // Verify error message includes the missing output names
      const error_call = mock_logger.error.mock.calls.find(
        (call: any[]) => call[0] === 'Error during initial server run, attempting cleanup and restart:'
      )
      expect(error_call).toBeDefined()
      expect(error_call![1].message).toContain(OUTPUT_EVENT_API_REALTIME_HOST)
      expect(error_call![1].message).toContain(OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN)
    })
  })

  describe('error handling', () => {
    it('should handle deployment errors gracefully', async () => {
      const command = create_mock_command('start')
      const deployment_error = new Error('Deployment failed')

      // First call fails, second succeeds
      mock_deploy
        .mockRejectedValueOnce(deployment_error)
        .mockResolvedValueOnce(
          create_mock_deployment([
            {
              stackName: APPSYNC_STACK_NAME,
              environment: { region: 'us-east-1' },
              outputs: {
                [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
                [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
              }
            },
            {
              stackName: LAYER_STACK_NAME,
              outputs: {
                [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
              }
            }
          ])
        )

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        deployment_error
      )
      expect(mock_destroy).toHaveBeenCalled()
      expect(mock_deploy).toHaveBeenCalledTimes(2)
    })

    it('should handle cdk.json read errors', async () => {
      const command = create_mock_command('start')
      const read_error = new Error('ENOENT: no such file or directory')
      mock_read_file_sync.mockImplementation(() => {
        throw read_error
      })

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        read_error
      )
    })

    it('should handle invalid cdk.json format', async () => {
      const command = create_mock_command('start')
      mock_read_file_sync.mockReturnValue('invalid json {')

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        expect.any(SyntaxError)
      )
    })

    it('should call cleanup even after errors', async () => {
      const command = create_mock_command('start')
      mock_read_file_sync.mockImplementation(() => {
        throw new Error('Read error')
      })

      await main(command)

      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should handle watch errors gracefully', async () => {
      const command = create_mock_command('start')
      const watch_error = new Error('Watch mode failed')

      mock_deploy.mockResolvedValue(
        create_mock_deployment([
          {
            stackName: APPSYNC_STACK_NAME,
            environment: { region: 'us-east-1' },
            outputs: {
              [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
              [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
            }
          },
          {
            stackName: LAYER_STACK_NAME,
            outputs: {
              [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
            }
          }
        ])
      )
      mock_watch.mockRejectedValue(watch_error)

      await main(command)

      // Watch errors bubble up through run_server, triggering cleanup/restart flow
      expect(mock_logger.error).toHaveBeenCalledWith(
        'Error during initial server run, attempting cleanup and restart:',
        watch_error
      )
    })
  })

  describe('signal handlers', () => {
    it('should register SIGINT handler', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(sigint_handler).not.toBeNull()
    })

    it('should register SIGTERM handler', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(sigterm_handler).not.toBeNull()
    })

    it('should cleanup on SIGINT', async () => {
      const command = create_mock_command('destroy')
      const mock_exit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)

      await main(command)

      if (sigint_handler) {
        await sigint_handler()
      }

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Cleaning up UI and CDK resources...'
      )
      expect(mock_cleanup).toHaveBeenCalled()
      expect(mock_exit).toHaveBeenCalledWith(0)

      mock_exit.mockRestore()
    })

    it('should cleanup on SIGTERM', async () => {
      const command = create_mock_command('destroy')
      const mock_exit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)

      await main(command)

      if (sigterm_handler) {
        await sigterm_handler()
      }

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Cleaning up UI and CDK resources...'
      )
      expect(mock_cleanup).toHaveBeenCalled()
      expect(mock_exit).toHaveBeenCalledWith(0)

      mock_exit.mockRestore()
    })
  })

  describe('unknown commands', () => {
    it('should not call deploy or destroy for unknown commands', async () => {
      const command = create_mock_command('unknown')

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
      expect(mock_destroy).not.toHaveBeenCalled()
      expect(mock_serve).not.toHaveBeenCalled()
    })
  })

  describe('Toolkit initialization', () => {
    it('should create Toolkit with CustomIoHost', async () => {
      const { Toolkit } = toolkit_lib
      const { CustomIoHost } = iohost_module
      const command = create_mock_command('destroy')

      await main(command)

      expect(CustomIoHost).toHaveBeenCalled()
      expect(Toolkit).toHaveBeenCalledWith({
        ioHost: expect.any(Object)
      })
    })
  })

  describe('cleanup', () => {
    it('should always call cleanup in finally block', async () => {
      const command = create_mock_command('destroy')

      await main(command)

      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should log cleanup message', async () => {
      const command = create_mock_command('destroy')
      const mock_exit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)

      await main(command)

      if (sigint_handler) {
        await sigint_handler()
      }

      expect(mock_logger.info).toHaveBeenCalledWith(
        'Cleaning up UI and CDK resources...'
      )

      mock_exit.mockRestore()
    })
  })
})
