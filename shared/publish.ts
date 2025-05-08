import { btoa } from 'buffer'

function getAuthProtocol(authorization: { 'x-api-key': string; host: string }) {
  const header = btoa(JSON.stringify(authorization))
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove padding `=`
  return `header-${header}`
}

interface ConnectionParams {
  realtime_domain: string
  http_domain: string
  api_key: string
}

export class Connection {
  socket: WebSocket
  constructor(params: ConnectionParams) {
    const authorization = {
      'x-api-key': params.api_key,
      host: params.http_domain
    }

    this.socket = new WebSocket(
      `wss://${params.realtime_domain}/event/realtime`,
      ['aws-appsync-event-ws', getAuthProtocol(authorization)]
    )
    this.socket.onopen = () => console.log('Connected to AppSync WebSocket')
    this.socket.onclose = (event) => console.log('WebSocket closed:', event)
    this.socket.onmessage = (event) => console.log('WebSocket message:', event)
  }

  async send(message: string | object) {
    if (typeof message === 'string') {
      this.socket.send(message)
    } else if (typeof message === 'object') {
      this.socket.send(JSON.stringify(message))
    } else {
      throw new Error('Message must be a string or object')
    }
  }
}
