import { describe, it, expect } from 'vitest'
import { detect_event_label } from './event_detection.js'

describe('detect_event_label', () => {
  it('should detect API Gateway HTTP event', () => {
    const event = {
      requestContext: {
        http: { method: 'POST', path: '/tasks' }
      }
    }
    expect(detect_event_label(event)).toBe('POST /tasks')
  })

  it('should detect API Gateway HTTP event with long path', () => {
    const event = {
      requestContext: {
        http: { method: 'GET', path: '/api/v1/users/123/tasks' }
      }
    }
    expect(detect_event_label(event)).toBe('GET /api/v1/users/123/tasks')
  })

  it('should detect SQS event', () => {
    const event = {
      Records: [{ eventSource: 'aws:sqs', body: '{}' }]
    }
    expect(detect_event_label(event)).toBe('SQS Message')
  })

  it('should detect DynamoDB Stream event', () => {
    const event = {
      Records: [{ eventSource: 'aws:dynamodb', dynamodb: {} }]
    }
    expect(detect_event_label(event)).toBe('DynamoDB Stream')
  })

  it('should detect SNS event', () => {
    const event = {
      Records: [{ Sns: { Message: 'hello' } }]
    }
    expect(detect_event_label(event)).toBe('SNS Notification')
  })

  it('should detect EventBridge event', () => {
    const event = {
      source: 'test-app',
      'detail-type': 'task.created',
      detail: {}
    }
    expect(detect_event_label(event)).toBe('EventBridge: task.created')
  })

  it('should detect S3 event', () => {
    const event = {
      Records: [{ eventSource: 'aws:s3', s3: {} }]
    }
    expect(detect_event_label(event)).toBe('S3 Event')
  })

  it('should detect EventBridge Scheduler event (no Records, no requestContext)', () => {
    const event = { scheduled: true }
    expect(detect_event_label(event)).toBe('Invocation')
  })

  it('should return Invocation for unknown event shapes', () => {
    expect(detect_event_label({})).toBe('Invocation')
    expect(detect_event_label(null)).toBe('Invocation')
    expect(detect_event_label('string')).toBe('Invocation')
  })
})
