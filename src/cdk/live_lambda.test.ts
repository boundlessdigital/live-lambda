import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { LiveLambda, LiveLambdaInstallProps } from './live_lambda.js'
import { ENV_LAMBDA_EXEC_WRAPPER } from '../lib/constants.js'

describe('LiveLambda.install()', () => {
  let temp_asset_dir: string
  let temp_entry_dir: string
  let entry_file_path: string

  beforeAll(() => {
    // Create a temp directory with a placeholder file for the layer asset
    temp_asset_dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live-lambda-install-test-')
    )
    fs.writeFileSync(
      path.join(temp_asset_dir, 'placeholder.txt'),
      'test layer content'
    )

    // Create a temp directory with a simple TypeScript entry point for NodejsFunction
    temp_entry_dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live-lambda-entry-test-')
    )
    entry_file_path = path.join(temp_entry_dir, 'handler.ts')
    fs.writeFileSync(
      entry_file_path,
      `export const handler = async () => ({ statusCode: 200, body: 'OK' })`
    )
  })

  afterAll(() => {
    // Clean up temp directories
    if (temp_asset_dir) {
      fs.rmSync(temp_asset_dir, { recursive: true, force: true })
    }
    if (temp_entry_dir) {
      fs.rmSync(temp_entry_dir, { recursive: true, force: true })
    }
  })

  /**
   * Helper to create an app with LiveLambda.install() called
   * and optionally an application stack with a NodejsFunction
   */
  function create_test_app(options?: {
    props?: LiveLambdaInstallProps
    include_app_stack?: boolean
  }) {
    const app = new cdk.App()
    const env = { account: '123456789012', region: 'us-east-1' }

    const props = options?.props ?? { env }

    // Call the install method - this is what we're testing
    LiveLambda.install(app, props)

    let app_stack: cdk.Stack | undefined
    let test_function: NodejsFunction | undefined

    if (options?.include_app_stack !== false) {
      // Create an application stack with a NodejsFunction to test aspect application
      app_stack = new cdk.Stack(app, 'TestAppStack', { env })
      test_function = new NodejsFunction(app_stack, 'TestFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })
    }

    // Synthesize to trigger aspects
    app.synth()

    return {
      app,
      app_stack,
      test_function,
      env
    }
  }

  describe('Stack creation', () => {
    it('should create AppSyncStack when called', () => {
      const { app } = create_test_app({ include_app_stack: false })

      const appsync_stack = app.node.tryFindChild('AppSyncStack') as cdk.Stack
      expect(appsync_stack).toBeDefined()
      expect(appsync_stack).toBeInstanceOf(cdk.Stack)

      const template = Template.fromStack(appsync_stack)
      template.resourceCountIs('AWS::AppSync::Api', 1)
    })

    it('should create LiveLambda-LayerStack when called', () => {
      const { app } = create_test_app({ include_app_stack: false })

      const layer_stack = app.node.tryFindChild('LiveLambda-LayerStack') as cdk.Stack
      expect(layer_stack).toBeDefined()
      expect(layer_stack).toBeInstanceOf(cdk.Stack)

      const template = Template.fromStack(layer_stack)
      template.resourceCountIs('AWS::Lambda::LayerVersion', 1)
    })
  })

  describe('Aspect application when skip_layer is false', () => {
    it('should apply aspect to NodejsFunction (check for AWS_LAMBDA_EXEC_WRAPPER env var)', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: false }
      })

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should apply aspect by default when skip_layer is not specified', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' } }
      })

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should add layer to NodejsFunction', () => {
      const { app_stack } = create_test_app()

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.anyValue()
      })
    })
  })

  describe('Aspect skipping when skip_layer is true', () => {
    it('should NOT apply aspect when skip_layer is true', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: true }
      })

      const template = Template.fromStack(app_stack!)

      // Function should exist but should NOT have the live-lambda env var
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      const env_vars = fn.Properties?.Environment?.Variables
      expect(env_vars?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined()
    })

    it('should NOT add layer to NodejsFunction when skip_layer is true', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: true }
      })

      const template = Template.fromStack(app_stack!)

      // Function should exist but should NOT have layers
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      expect(fn.Properties?.Layers).toBeUndefined()
    })
  })

  describe('developer_principal_arns configuration', () => {
    it('should pass developer_principal_arns to the aspect', () => {
      const developer_arn = 'arn:aws:iam::999999999999:user/developer'
      const { app_stack } = create_test_app({
        props: {
          env: { account: '123456789012', region: 'us-east-1' },
          developer_principal_arns: [developer_arn]
        }
      })

      const template = Template.fromStack(app_stack!)

      // Verify IAM role has assume role policy with developer principal
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn
              }
            })
          ])
        }
      })
    })

    it('should support multiple developer_principal_arns', () => {
      const developer_arn_1 = 'arn:aws:iam::999999999999:user/developer1'
      const developer_arn_2 = 'arn:aws:iam::888888888888:user/developer2'
      const { app_stack } = create_test_app({
        props: {
          env: { account: '123456789012', region: 'us-east-1' },
          developer_principal_arns: [developer_arn_1, developer_arn_2]
        }
      })

      const template = Template.fromStack(app_stack!)

      // Verify IAM role has assume role policy with both developer principals
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn_1
              }
            })
          ])
        }
      })

      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn_2
              }
            })
          ])
        }
      })
    })
  })

  describe('undefined props (default behavior)', () => {
    it('should work with undefined props', () => {
      const app = new cdk.App()

      // Call install with undefined props - should not throw
      expect(() => {
        LiveLambda.install(app, undefined)
      }).not.toThrow()

      // AppSyncStack and LayerStack should still be created
      const appsync_stack = app.node.tryFindChild('AppSyncStack')
      expect(appsync_stack).toBeDefined()

      const layer_stack = app.node.tryFindChild('LiveLambda-LayerStack')
      expect(layer_stack).toBeDefined()
    })

    it('should apply aspect by default when props is undefined', () => {
      const app = new cdk.App()

      LiveLambda.install(app, undefined)

      // Create an app stack with a function after install
      // Note: When env is undefined, cross-stack references work differently
      // We need to NOT specify env to match the undefined props case
      const app_stack = new cdk.Stack(app, 'TestAppStack')
      new NodejsFunction(app_stack, 'TestFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      app.synth()

      const template = Template.fromStack(app_stack)

      // Aspect should be applied since skip_layer defaults to false
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })
  })
})
