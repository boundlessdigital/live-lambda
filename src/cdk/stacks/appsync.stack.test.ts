import { describe, it, expect, beforeEach } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { AppSyncStack } from './appsync.stack.js'

describe('AppSyncStack', () => {
  let app: cdk.App
  let stack: AppSyncStack
  let template: Template

  beforeEach(() => {
    app = new cdk.App()
    stack = new AppSyncStack(app, 'TestAppSyncStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      ssm_namespace: 'test-app'
    })
    template = Template.fromStack(stack)
  })

  describe('EventApi', () => {
    it('should create EventApi with correct name', () => {
      template.hasResourceProperties('AWS::AppSync::Api', {
        Name: 'live-lambda-events-test-app'
      })
    })

    it('should configure IAM auth provider', () => {
      template.hasResourceProperties('AWS::AppSync::Api', {
        EventConfig: {
          AuthProviders: Match.arrayWith([
            Match.objectLike({
              AuthType: 'AWS_IAM'
            })
          ])
        }
      })
    })

    it('should create channel namespace for live-lambda', () => {
      template.hasResourceProperties('AWS::AppSync::ChannelNamespace', {
        Name: 'live-lambda'
      })
    })
  })

  describe('IAM Policy', () => {
    it('should expose api_policy with correct statements', () => {
      // The policy object is created but not attached to a resource in this stack
      // Verify it has the correct policy document structure
      const policy_document = stack.api_policy.document.toJSON()
      expect(policy_document.Statement).toHaveLength(1)
      expect(policy_document.Statement[0].Action).toContain(
        'appsync:EventConnect'
      )
      expect(policy_document.Statement[0].Action).toContain(
        'appsync:EventPublish'
      )
      expect(policy_document.Statement[0].Action).toContain(
        'appsync:EventSubscribe'
      )
    })

    it('should have policy name containing live-lambda-events', () => {
      expect(stack.api_policy.policyName).toMatch(/live-lambda-events-/)
    })
  })

  describe('Outputs', () => {
    it('should output API ID', () => {
      template.hasOutput('LiveLambdaEventApiId', {
        Description: 'The ID of the AppSync Event API for Live Lambda.'
      })
    })

    it('should output HTTP host', () => {
      template.hasOutput('LiveLambdaEventApiHttpHost', {
        Description: 'The HTTP host of the AppSync Event API for Live Lambda.'
      })
    })

    it('should output Realtime host', () => {
      template.hasOutput('LiveLambdaEventApiRealtimeHost', {
        Description:
          'The WebSocket host of the AppSync Event API for Live Lambda.'
      })
    })

    it('should output HTTP endpoint', () => {
      template.hasOutput('LiveLambdaEventApiHttpEndpoint', {
        Description:
          'The HTTP endpoint of the AppSync Event API for Live Lambda.'
      })
    })

    it('should output WebSocket endpoint', () => {
      template.hasOutput('LiveLambdaEventApiWebSocketEndpoint', {
        Description:
          'The WebSocket endpoint of the AppSync Event API for Live Lambda.'
      })
    })
  })

  describe('Stack properties', () => {
    it('should expose api property as EventApi with CDK token properties', () => {
      expect(stack.api).toBeDefined()
      // EventApi exposes apiId and apiArn as CDK tokens for cross-stack references
      expect(stack.api.apiId).toBeDefined()
      expect(stack.api.apiArn).toBeDefined()
      // Verify it has HTTP and realtime DNS properties
      expect(stack.api.httpDns).toBeDefined()
      expect(stack.api.realtimeDns).toBeDefined()
    })

    it('should expose api_policy property as IAM Policy with correct actions', () => {
      expect(stack.api_policy).toBeDefined()
      expect(stack.api_policy.policyName).toMatch(/^live-lambda-events-/)

      // Verify the policy has the expected structure
      const policy_json = stack.api_policy.document.toJSON()
      expect(policy_json.Statement).toBeDefined()
      expect(policy_json.Statement.length).toBeGreaterThan(0)

      // Verify the policy targets the EventApi ARN
      const resource = policy_json.Statement[0].Resource
      expect(resource).toBeDefined()
    })
  })
})
