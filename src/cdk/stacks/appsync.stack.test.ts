import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { AppSyncStack } from './appsync.stack.js'

describe('AppSyncStack', () => {
  const app = new cdk.App()
  const stack = new AppSyncStack(app, 'TestAppSyncStack', {
    env: { account: '123456789012', region: 'us-east-1' }
  })
  const template = Template.fromStack(stack)

  describe('EventApi', () => {
    it('should create EventApi with correct name', () => {
      template.hasResourceProperties('AWS::AppSync::Api', {
        Name: Match.stringLikeRegexp('live-lambda-events-')
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
    it('should expose api property', () => {
      expect(stack.api).toBeDefined()
    })

    it('should expose api_policy property', () => {
      expect(stack.api_policy).toBeDefined()
    })
  })
})
