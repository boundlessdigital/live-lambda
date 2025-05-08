import { SignatureV4 } from '@aws-sdk/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'
import { HttpRequest } from '@aws-sdk/protocol-http'
const { defaultProvider } = await import('@aws-sdk/credential-provider-node')
const credential_provider = defaultProvider()

interface RequestSignerParams {
  region: string
}

export function request_signer({ region }: RequestSignerParams) {
  const signer = new SignatureV4({
    credentials: credential_provider,
    region,
    service: 'appsync',
    sha256: Sha256
  })

  return signer
}

export function sign_request({
  region,
  request
}: {
  region: string
  request: any
}) {
  const signer = request_signer({ region })
  return signer.sign(request)
}

export function make_request({
  channel_name,
  event_payload,
  parsed_url
}: {
  channel_name: string
  event_payload: any
  parsed_url: URL
}) {
  const request_body_object = {
    channel: channel_name,
    events: [JSON.stringify(event_payload)]
  }
  const stringified_request_body = JSON.stringify(request_body_object)

  const request_to_sign = new HttpRequest({
    method: 'POST',
    protocol: parsed_url.protocol,
    hostname: parsed_url.hostname,
    path: parsed_url.pathname,
    headers: {
      host: parsed_url.hostname,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(stringified_request_body).toString()
    },
    body: stringified_request_body
  })

  return request_to_sign
}
