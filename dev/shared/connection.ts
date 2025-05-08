import { btoa } from 'buffer'

function get_auth_protocol(host: string) {
  const header = btoa(
    JSON.stringify({
      host
    })
  )
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, '') // Remove padding `=`
  return `header-${header}`
}

interface ConnectionParams {
  realtime_endpoint: string
}

export class Connection {
  socket: WebSocket
  constructor(params: ConnectionParams) {
    this.socket = new WebSocket(params.realtime_endpoint, [
      'aws-appsync-event-ws',
      get_auth_protocol(params.realtime_endpoint)
    ])

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
