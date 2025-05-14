import axios from 'axios'
import { SignatureV4 } from '@smithy/signature-v4'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'

const APPSYNC_URL = `https://2ayr2zxgarh6xacc6icw6kezpi.appsync-realtime-api.us-west-1.amazonaws.com/events/realtime`

const REALTIME_DOMAIN = `2ayr2zxgarh6xacc6icw6kezpi.appsync-realtime-api.us-west-1.amazonaws.com`

const get_http_request = (params: {
  channel: string
  events: unknown[]
  app_sync_url: string
}) => {
  const { channel, events, app_sync_url } = params
  const url = new URL(app_sync_url)

  const body = JSON.stringify({
    channel,
    events: events.map((event) => JSON.stringify(event))
  })

  return new HttpRequest({
    protocol: 'https:',
    method: 'POST',
    hostname: url.hostname,
    path: '/event',
    headers: {
      host: url.host,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString()
    },
    body
  })
}

const get_signed_request = async (params: {
  channel: string
  events: unknown[]
  appSyncUrl: string
}) => {
  const httpRequest = get_http_request(params)

  const credentials = await defaultProvider()()
  const signer = new SignatureV4({
    credentials,
    region: process.env.AWS_REGION!,
    service: 'appsync',
    sha256: Sha256
  })

  return signer.sign(httpRequest)
}

const publish_events = async (params: {
  channel: string
  events: unknown[]
}) => {
  const { channel, events } = params

  const signed_request = await get_signed_request({
    channel,
    events,
    appSyncUrl: APPSYNC_URL
  })

  const socket = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://${REALTIME_DOMAIN}/event/realtime`, [
      'aws-appsync-event-ws',
      getAuthProtocol()
    ])
    socket.onopen = () => resolve(socket)
    socket.onclose = (event) => reject(new Error(event.reason))
    socket.onmessage = (event) => console.log(event)
  })

  // when the socket is connected, send the message
  socket.send(JSON.stringify(message))
  return axios({
    method: signed_request.method,
    url: `${APPSYNC_URL}/event`,
    headers: signed_request.headers,
    data: signed_request.body
  })
}

/**
 * Encodes an object into Base64 URL format
 * @param {*} authorization - an object with the required authorization properties
 **/
function getBase64URLEncoded(authorization) {
  return btoa(JSON.stringify(authorization))
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove padding `=`
}

function getAuthProtocol(authorization) {
  const header = getBase64URLEncoded(authorization)
  return `header-${header}`
}
