import { HttpRequest } from '@aws-sdk/protocol-http'
import { SignatureV4 } from '@aws-sdk/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'
// import { fromNodeProviderChain } from '@aws-sdk/credential-provider-node' // Commented out
import { URL } from 'url' // Standard Node.js module

// --- Configuration ---
// You can set AWS_PROFILE in your environment, or modify it here.
const AWS_PROFILE = process.env.AWS_PROFILE || 'boundless-development'
const APPSYNC_EVENT_API_URL = 'https://7dblhijn2vfqtmtnfyewmjmrka.appsync-api.us-west-1.amazonaws.com/event'
const APPSYNC_CHANNEL_NAMESPACE = 'liveLambda'
const AWS_REGION = 'us-west-1'
// --- End Configuration ---

async function main() {
  console.log(`Attempting to publish to AppSync Event API with AWS Profile: "${AWS_PROFILE}"`)
  console.log(`Target URL: ${APPSYNC_EVENT_API_URL}`)
  console.log(`Namespace: ${APPSYNC_CHANNEL_NAMESPACE}`)
  console.log(`Region: ${AWS_REGION}`)

  const { defaultProvider } = await import('@aws-sdk/credential-provider-node');
  const credential_provider = defaultProvider({ profile: AWS_PROFILE });

  const signer = new SignatureV4({
    credentials: credential_provider,
    region: AWS_REGION,
    service: 'appsync',
    sha256: Sha256,
  })

  const parsed_url = new URL(APPSYNC_EVENT_API_URL)
  const channel_name_for_body = `${APPSYNC_CHANNEL_NAMESPACE}/scriptTestAfterFix`

  const request_body_object = {
    channel: channel_name_for_body,
    events: [
      JSON.stringify({ message: "Simple test event", id: 123 })
    ],
  }
  const stringified_request_body = JSON.stringify(request_body_object)

  const request_to_sign = new HttpRequest({
    method: 'POST',
    protocol: parsed_url.protocol,
    hostname: parsed_url.hostname,
    path: parsed_url.pathname,
    headers: {
      'Content-Type': 'application/json',
      'host': parsed_url.hostname,
      'Content-Length': Buffer.byteLength(stringified_request_body).toString(),
    },
    body: stringified_request_body,
  })

  console.log('\n[DEBUG] Request to sign (pre-signature):', JSON.stringify({
    method: request_to_sign.method,
    protocol: request_to_sign.protocol,
    hostname: request_to_sign.hostname,
    path: request_to_sign.path,
    headers: request_to_sign.headers,
    bodyPreview: stringified_request_body.substring(0, 200) + (stringified_request_body.length > 200 ? '...' : '')
  }, null, 2))

  try {
    const signed_request = await signer.sign(request_to_sign)
    console.log('\n[DEBUG] Signed request headers:', JSON.stringify(signed_request.headers, null, 2))

    console.log(`\nAttempting to send request to ${APPSYNC_EVENT_API_URL}...`)
    // Node.js 18+ has fetch built-in. For older versions, you'd need a polyfill or library like node-fetch.
    // Assuming Node.js 18+ for simplicity here.
    const response = await fetch(APPSYNC_EVENT_API_URL, {
      method: signed_request.method as string, // fetch requires string for method
      headers: signed_request.headers as HeadersInit, // Type assertion
      body: signed_request.body,
    })

    console.log('\n--- AppSync Response ---')
    console.log('Status:', response.status, response.statusText)
    const response_body_text = await response.text()
    console.log('Body:', response_body_text)

    if (response.ok) {
      console.log('\n[SUCCESS] Event appears to have been published successfully!')
    } else {
      console.error('\n[FAILURE] Failed to publish event.')
      try {
        // Try to parse if it's JSON for better error display
        const parsed_error = JSON.parse(response_body_text)
        console.error('Parsed error details:', JSON.stringify(parsed_error, null, 2))
      } catch (e) {
        // If not JSON, the raw text is already logged
      }
    }
  } catch (error: any) {
    console.error('\n[CRITICAL ERROR] Error during script execution:', error.message)
    if (error.stack) {
      console.error('Stacktrace:', error.stack)
    }
    if (error.details) {
      console.error('Error details:', error.details)
    }
    if (error.$metadata) {
        console.error('AWS SDK Error Metadata:', error.$metadata)
    }
  }
}

main().catch(error => {
  console.error('\n[UNHANDLED PROMISE REJECTION]', error)
});
