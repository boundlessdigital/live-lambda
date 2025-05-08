import WebSocket from 'ws';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import type { HttpRequest as SmithyHttpRequest } from '@smithy/types';
import { defaultProvider as credentialProvider } from '@aws-sdk/credential-provider-node';
import { randomUUID } from 'crypto'; // Added for unique subscription IDs

console.log('Local Dev Server starting...');

// Configuration - replace with actual values from CDK output or env vars
const AWS_REGION = 'us-west-1';
const APPSYNC_API_ID = process.env.APPSYNC_API_ID || '7dblhijn2vfqtmtnfyewmjmrka'; 
const APPSYNC_HOST = `${APPSYNC_API_ID}.appsync-api.${AWS_REGION}.amazonaws.com`; 
const APPSYNC_WSS_ENDPOINT = `wss://${APPSYNC_API_ID}.appsync-realtime-api.${AWS_REGION}.amazonaws.com/event/realtime`; 
const APPSYNC_HTTP_ENDPOINT_FOR_SIGNING = `https://${APPSYNC_HOST}/event`;

const INVOKE_CHANNEL_BASE = 'liveLambda/invoke';
const RESPONSE_CHANNEL_BASE = 'liveLambda/response'; // For publishing responses back
const LOCAL_INSTANCE_ID = 'localInstance_01'; 
const REQUEST_CHANNEL_BASE = 'liveLambda/request';

// Define the fixed channel the dev server will listen to
const FIXED_LISTEN_CHANNEL = 'liveLambda/tunnel';

const LOCAL_DEV_SERVER_PORT = process.env.LOCAL_DEV_SERVER_PORT || 8088;

// Helper function to Base64URL encode an object as per AppSync Event API docs
function base64url_encode_object(obj: Record<string, any>): string {
    const json_string = JSON.stringify(obj);
    // Reverting to manual replacement for broader Node.js compatibility
    return Buffer.from(json_string).toString('base64')
        .replace(/\+/g, '-') // Convert '+' to '-' (RegExp for global replace)
        .replace(/\//g, '_') // Convert '/' to '_' (RegExp for global replace)
        .replace(/=+$/, '');  // Remove padding '='
}

// Helper to create signed headers for WebSocket IAM operations
async function create_signed_headers_for_iam_operation(payload_body_string: string): Promise<Record<string, string>> {
    const credentials = await credentialProvider()();
    if (!credentials) {
        throw new Error('Could not load AWS credentials for signing WebSocket operation');
    }

    const signer = new SignatureV4({
        credentials,
        region: AWS_REGION,
        service: 'appsync',
        sha256: Sha256,
    });

    // These are the headers that will be part of the SigV4 calculation
    const headers_to_sign: Record<string, string> = {
        'host': APPSYNC_HOST,
        'accept': 'application/json, text/javascript',
        'content-encoding': 'amz-1.0',
        'content-type': 'application/json; charset=UTF-8',
        // x-amz-date and x-amz-content-sha256 will be added by the signer or explicitly before signing
    };

    const request_to_sign = new HttpRequest({
        method: 'POST',
        protocol: 'https:',
        hostname: APPSYNC_HOST,
        path: '/event', // Path for event operations
        headers: headers_to_sign, // Pass the defined headers here
        body: payload_body_string,
    });

    // The signer will add 'x-amz-date' and 'x-amz-content-sha256' to request_to_sign.headers
    // before computing the signature, and these will be part of signed_request.headers.
    const signed_request = await signer.sign(request_to_sign) as SmithyHttpRequest;

    // Construct the object for the 'authorization' field in the WebSocket message.
    // This object MUST contain all headers that were included in the signature calculation (SignedHeaders).
    // Keys should be lowercase as per AppSync docs for the embedded auth object.
    const auth_object_for_websocket: Record<string, string> = {
        // Start with all headers from the actually signed request (they are lowercase from smithy client)
        ...signed_request.headers,
        // Ensure 'authorization' key itself is lowercase, as per AppSync docs for the embedded auth object.
        // The value is the SigV4 string from signed_request.headers.authorization.
        'authorization': signed_request.headers['authorization'],
    };

    // The 'host' header from signed_request.headers is already correct (lowercase).
    // 'x-amz-date' is already in signed_request.headers.
    // 'x-amz-content-sha256' is already in signed_request.headers.
    // 'x-amz-security-token' (if present) is already in signed_request.headers and will be lowercase.
    
    // Remove any headers that might have been added by the signer but are not part of the 
    // core SigV4 signature elements expected by AppSync in this specific context, if necessary.
    // However, for this use case, AppSync needs to see all signed headers to verify.

    // Example from docs shows: host, x-amz-date, x-amz-security-token, authorization.
    // But the error message implies it needs all SignedHeaders from the 'authorization' string's SignedHeaders part.
    // So, returning all headers that were signed is the safest approach.
    // Let's specifically ensure the ones mentioned in docs + the ones from error are present with correct casing.
    
    const final_auth_object: Record<string, string> = {};
    final_auth_object['host'] = signed_request.headers['host'];
    final_auth_object['accept'] = signed_request.headers['accept'];
    final_auth_object['content-encoding'] = signed_request.headers['content-encoding'];
    final_auth_object['content-type'] = signed_request.headers['content-type'];
    final_auth_object['x-amz-date'] = signed_request.headers['x-amz-date'];
    final_auth_object['x-amz-content-sha256'] = signed_request.headers['x-amz-content-sha256'];
    final_auth_object['authorization'] = signed_request.headers['authorization'];
    if (signed_request.headers['x-amz-security-token']) {
        final_auth_object['x-amz-security-token'] = signed_request.headers['x-amz-security-token'];
    }

    return final_auth_object;
}

// Function to send a subscribe message over WebSocket
async function send_subscribe_message(ws_client: WebSocket, channel_to_subscribe: string) {
    console.log(`Attempting to subscribe to channel: ${channel_to_subscribe}`);
    const subscription_id = randomUUID();
    const subscribe_operation_body = JSON.stringify({ channel: channel_to_subscribe });

    try {
        const signed_auth_components = await create_signed_headers_for_iam_operation(subscribe_operation_body);
        
        const subscribe_payload = {
            type: 'subscribe',
            id: subscription_id,
            channel: channel_to_subscribe,
            authorization: signed_auth_components,
        };

        const message_string = JSON.stringify(subscribe_payload);
        console.log(`Sending subscribe message: ${message_string}`);
        ws_client.send(message_string);
    } catch (error) {
        console.error('Error preparing or sending subscribe message:', error);
        // Optionally, close the WebSocket connection or attempt retry with backoff
        // ws_client.close(); 
    }
}

async function main() {
    const credentials = await credentialProvider()();
    if (!credentials) {
        console.error('Could not load AWS credentials. Ensure AWS_PROFILE is set or credentials are configured.');
        return;
    }

    const signer = new SignatureV4({
        credentials,
        region: AWS_REGION,
        service: 'appsync',
        sha256: Sha256,
    });

    // Construct the request object for SigV4 signing of the initial WebSocket connection
    const request = new HttpRequest({
        method: 'POST', // Per AppSync docs, the signing is as if for a POST to /event
        protocol: 'https:',
        hostname: APPSYNC_HOST,
        path: '/event', // The path for the event endpoint for signing purposes
        headers: {
            'host': APPSYNC_HOST,
            'accept': 'application/json, text/javascript',
            'content-encoding': 'amz-1.0',
            'content-type': 'application/json; charset=UTF-8',
            // x-amz-content-sha256 will be added by the signer if body is empty or not specified for signing
        },
        body: '{}', // Empty JSON object as body for initial connection signing
    });

    const signed_request = await signer.sign(request) as SmithyHttpRequest;

    // Prepare the header object for the Sec-WebSocket-Protocol
    const auth_header_object = {
        ...signed_request.headers, // Includes host, x-amz-date, Authorization, etc.
        // 'x-amz-content-sha256': signed_request.headers['x-amz-content-sha256'] // if needed explicitly
    };
    // Remove undefined or null headers, if any, before encoding
    Object.keys(auth_header_object).forEach(key => auth_header_object[key] === undefined && delete auth_header_object[key]);

    const base64url_auth_payload = base64url_encode_object(auth_header_object);
    console.log(`Auth payload for subprotocol (before base64url encoding): ${JSON.stringify(auth_header_object, null, 2)}`);

    const ws_protocols = [
        `header-${base64url_auth_payload}`,
        'aws-appsync-event-ws' // Generic subprotocol for AppSync events
    ];
    console.log(`Submitting protocols: ["header-${base64url_auth_payload.substring(0,30)}...", "aws-appsync-event-ws"]`);

    const ws = new WebSocket(APPSYNC_WSS_ENDPOINT, ws_protocols);

    ws.on('open', () => {
        console.log('WebSocket connection opened.');
        // Send connection_init message as per AppSync Event API docs
        const connection_init_message = JSON.stringify({ type: 'connection_init' });
        console.log(`Sending: ${connection_init_message}`);
        ws.send(connection_init_message);
        // Subscription will be triggered by 'connection_ack' message in ws.on('message')
    });

    ws.on('message', (data) => {
        console.log(`Raw message received: ${data.toString()}`);
        try {
            const message = JSON.parse(data.toString());
            console.log('Parsed message:', message);

            switch (message.type) {
                case 'connection_ack':
                    console.log('Connection acknowledged by AppSync. Proceeding to subscribe.');
                    // Now that connection is ack'd, send the subscribe message
                    send_subscribe_message(ws, FIXED_LISTEN_CHANNEL);
                    break;
                case 'ka': // Keep-alive
                    console.log('Keep-alive message received.');
                    break;
                case 'subscribe_success':
                    console.log(`Successfully subscribed with ID: ${message.id}`);
                    console.log(`Local dev server is now listening for messages on fixed channel: ${FIXED_LISTEN_CHANNEL}`);
                    break;
                case 'subscribe_error':
                    console.error(`Subscription failed for ID ${message.id}:`, message.errors);
                    // Optionally, close the WebSocket connection or attempt retry
                    // ws.close(); 
                    break;
                case 'data':
                    console.log(`Data received for subscription ID ${message.id}:`, message.event);
                    // TODO: Implement actual local Lambda invocation based on this event
                    // For now, just logging the received event
                    if (message.id && message.channel === FIXED_LISTEN_CHANNEL) {
                        console.log(`Message received on ${FIXED_LISTEN_CHANNEL}:`, message.event);
                    }
                    break;
                case 'publish_success': // If we were to implement publishing from dev-server
                    console.log(`Publish successful for ID: ${message.id}`);
                    break;
                case 'publish_error':
                    console.error(`Publish failed for ID ${message.id}:`, message.errors);
                    break;
                default:
                    console.log('Received unhandled message type:', message.type);
            }
        } catch (error) {
            console.error('Failed to parse message or handle incoming message:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', (code, reason) => {
        console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason ? reason.toString() : 'No reason given'}`);
    });
}

main().catch(console.error);
