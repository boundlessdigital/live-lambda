export function detect_event_label(event: unknown): string {
  if (!event || typeof event !== 'object') return 'Invocation'

  const e = event as Record<string, any>

  // API Gateway HTTP API v2
  if (e.requestContext?.http?.method && e.requestContext?.http?.path) {
    return `${e.requestContext.http.method} ${e.requestContext.http.path}`
  }

  // Record-based events
  const record = e.Records?.[0]
  if (record) {
    if (record.eventSource === 'aws:sqs') return 'SQS Message'
    if (record.eventSource === 'aws:dynamodb') return 'DynamoDB Stream'
    if (record.eventSource === 'aws:s3') return 'S3 Event'
    if (record.Sns) return 'SNS Notification'
  }

  // EventBridge
  if (e.source && e['detail-type']) {
    return `EventBridge: ${e['detail-type']}`
  }

  return 'Invocation'
}
