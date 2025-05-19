import 'colors';
import WebSocket from 'ws';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain, fromIni } from '@aws-sdk/credential-providers'; // Updated to credential-providers from credential-provider-ini as per modern SDK v3 style, assuming it exports fromIni.
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { randomUUID } from 'crypto';
import { base_64_url_encode } from './utils.js';
export class AppSyncEventWebSocketClient {
    debug = false;
    socket;
    options;
    operations = new Map();
    realtime_url;
    host;
    region;
    signer;
    connectionPromise;
    connectionResolver;
    connectionRejecter;
    keep_alive_timeout;
    connection_timeout_ms = 300000; // Default 5 mins, updated by connection_ack
    constructor(options) {
        this.options = options;
        this.region = options.region;
        this.realtime_url = `wss://${options.realtime}/event/realtime`;
        this.host = options.http;
        this.signer = this.initialize_signer();
    }
    initialize_signer() {
        const credentialProvider = this.options.profile
            ? fromIni({ profile: this.options.profile })
            : fromNodeProviderChain();
        if (this.options.profile) {
            console.log(`WebSocket client using AWS profile: ${this.options.profile}`.yellow);
        }
        else {
            console.log('WebSocket client using default AWS credential provider chain.'.yellow);
        }
        return new SignatureV4({
            service: 'appsync',
            region: this.region,
            credentials: credentialProvider,
            sha256: Sha256
        });
    }
    get is_connected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    async create_request(body = {}) {
        const request_to_sign = new HttpRequest({
            method: 'POST',
            protocol: 'https:',
            hostname: this.host,
            path: '/event',
            headers: {
                host: this.host,
                accept: 'application/json, text/javascript',
                'content-encoding': 'amz-1.0',
                'content-type': 'application/json; charset=UTF-8'
            },
            body: JSON.stringify(body)
        });
        return await this.signer.sign(request_to_sign);
    }
    async get_signed_auth_headers(body) {
        const signed_request = await this.create_request(body);
        console.log(JSON.stringify(signed_request.headers, null, 2));
        return signed_request.headers;
    }
    async create_connection_auth_subprotocol() {
        const connect_headers = await this.get_signed_auth_headers();
        const header_string = base_64_url_encode(JSON.stringify(connect_headers));
        return [`header-${header_string}`, 'aws-appsync-event-ws'];
    }
    async connect() {
        console.log(`Attempting to connect to ${this.realtime_url}...`.cyan);
        if (this.socket &&
            (this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING)) {
            return this.connectionPromise;
        }
        this.connectionPromise = new Promise(async (resolve, reject) => {
            this.connectionResolver = resolve;
            this.connectionRejecter = reject;
            try {
                const subprotocols = await this.create_connection_auth_subprotocol();
                this.socket = new WebSocket(this.realtime_url, subprotocols);
                this.socket.onopen = () => {
                    console.log('WebSocket connection opened, sending connection_init...');
                    this.send_message({ type: 'connection_init' });
                };
                this.socket.onmessage = (event) => {
                    this.handle_message(event.data.toString());
                };
                this.socket.onerror = (errorEvent) => {
                    console.error('WebSocket error:', errorEvent.message);
                    this.options.on_error?.(errorEvent.error);
                    this.connectionRejecter?.(errorEvent.error);
                    this.cleanup_connection();
                };
                this.socket.onclose = (closeEvent) => {
                    console.log(`WebSocket closed: code=${closeEvent.code}, reason=${closeEvent.reason}`);
                    this.options.on_close?.(closeEvent);
                    this.connectionRejecter?.(new Error(`WebSocket closed: ${closeEvent.code} ${closeEvent.reason}`));
                    this.cleanup_connection();
                };
            }
            catch (error) {
                console.error('Error during WebSocket connection setup:', error);
                this.options.on_error?.(error);
                reject(error);
                this.cleanup_connection();
            }
        });
        return this.connectionPromise;
    }
    async handle_message(raw_message) {
        try {
            const message = JSON.parse(raw_message);
            // console.log('WebSocket message received:', message); // For debugging
            this.handle_keep_alive();
            this.keep_alive_timeout = setTimeout(() => {
                console.warn('Keep-alive timeout. Closing WebSocket.');
                this.socket?.close(1000, 'Keep-alive timeout');
            }, this.connection_timeout_ms + 5000); // Add a small buffer
            switch (message.type) {
                case 'connection_ack':
                    console.log('AppSync connection acknowledged.');
                    if (message.connectionTimeoutMs) {
                        this.connection_timeout_ms = message.connectionTimeoutMs;
                    }
                    this.connectionResolver?.();
                    console.log('Successfully connected to WebSocket.'.green);
                    this.options.on_open?.();
                    break;
                case 'ka': // Keep-alive
                    // console.log('Keep-alive received.'); // Optional: log keep-alive
                    break;
                case 'subscribe_success':
                    console.log(`Successfully subscribed to ${message.channel} with ID: ${message.id}`
                        .green);
                    // Wait a moment for subscription to be fully established on the backend
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                case 'publish_success':
                case 'unsubscribe_success':
                    if (message.id) {
                        const op = this.operations.get(message.id);
                        op?.resolve(message);
                        if (message.type !== 'subscribe_success') {
                            // Keep subscription ops for data
                            this.operations.delete(message.id);
                        }
                    }
                    break;
                case 'data':
                    if (message.id && message.event) {
                        const subOp = this.operations.get(message.id);
                        subOp?.onData?.(message.event);
                        this.options.on_data?.(message.id, message.event);
                    }
                    break;
                case 'subscribe_error':
                case 'publish_error':
                case 'unsubscribe_error':
                case 'broadcast_error': // This can be an error on an active subscription
                    console.error(`Error message from AppSync: ${message.type}`, message.errors);
                    if (message.id) {
                        const op = this.operations.get(message.id);
                        op?.reject(message.errors || new Error(message.type));
                        this.operations.delete(message.id);
                    }
                    this.options.on_error?.(message.errors || new Error(message.type));
                    break;
                default:
                    console.warn('Received unhandled WebSocket message type:', message.type, message);
            }
        }
        catch (error) {
            console.error('Error processing WebSocket message:', error, 'Raw data:', raw_message);
            this.options.on_error?.(error);
        }
    }
    send_message(message) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
        else {
            console.error('WebSocket not open. Cannot send message:', message);
            // Potentially queue the message or throw an error
            throw new Error('WebSocket is not open.');
        }
    }
    handle_keep_alive() {
        if (this.keep_alive_timeout) {
            clearTimeout(this.keep_alive_timeout);
            this.keep_alive_timeout = undefined;
        }
    }
    cleanup_connection() {
        this.handle_keep_alive();
        this.operations.forEach((op) => op.reject(new Error('WebSocket connection closed or failed.')));
        this.operations.clear();
        this.connectionPromise = undefined;
        this.connectionResolver = undefined;
        this.connectionRejecter = undefined;
    }
    async disconnect() {
        return new Promise((resolve) => {
            if (this.socket) {
                if (this.socket.readyState === WebSocket.OPEN) {
                    console.log('Closing WebSocket connection...');
                    this.operations.forEach(async (op, id) => {
                        // Attempt to unsubscribe from active subscriptions
                        // This assumes your subscribe operations are identifiable or you have a list
                        // For simplicity, this example doesn't explicitly track subscription types for auto-unsubscribe
                        // but a real implementation might want to send 'unsubscribe' messages here.
                        console.log(`Cleaning up operation: ${id}`);
                    });
                    this.socket.onclose = (event) => {
                        console.log('WebSocket cleanly closed by disconnect().');
                        this.cleanup_connection();
                        resolve();
                    };
                    this.socket.close(1000, 'Client initiated disconnect');
                }
                else if (this.socket.readyState === WebSocket.CONNECTING) {
                    console.log('WebSocket was connecting, aborting connection attempt...');
                    this.socket.terminate(); // Force close if connecting
                    this.cleanup_connection();
                    resolve();
                }
                else {
                    this.cleanup_connection(); // Already closed or closing
                    resolve();
                }
            }
            else {
                resolve(); // No socket to disconnect
            }
        });
    }
    async subscribe(channel, on_data_callback) {
        await this.connect(); // Ensure connection is established
        console.log(`Subscribing to channel: ${channel}`.cyan);
        const subscription_id = randomUUID();
        const authorization = await this.get_signed_auth_headers({ channel });
        const subscribe_message = {
            type: 'subscribe',
            id: subscription_id,
            channel,
            authorization
        };
        return new Promise((resolve, reject) => {
            this.operations.set(subscription_id, {
                resolve: (ackMsg) => {
                    // The 'subscribe_success' ack itself is resolved here.
                    // The onDataCallback will be called by handle_message for 'data' types.
                    resolve(subscription_id);
                },
                reject,
                onData: on_data_callback // Store the user's data handler
            });
            try {
                this.send_message(subscribe_message);
            }
            catch (error) {
                this.operations.delete(subscription_id); // Clean up if send fails immediately
                reject(error);
            }
        });
    }
    async publish(channel, events) {
        await this.connect();
        const publish_id = randomUUID();
        const stringified_events = events.map((event) => JSON.stringify(event));
        const authorization = await this.get_signed_auth_headers({
            channel,
            events: stringified_events
        });
        const publish_message = {
            type: 'publish',
            id: publish_id,
            channel,
            events: stringified_events,
            authorization
        };
        return new Promise((resolve, reject) => {
            this.operations.set(publish_id, { resolve, reject });
            try {
                this.send_message(publish_message);
            }
            catch (error) {
                this.operations.delete(publish_id);
                reject(error);
            }
        });
    }
    async unsubscribe(subscription_id) {
        await this.connect();
        if (!this.operations.has(subscription_id) && !this.is_connected) {
            console.warn(`Attempted to unsubscribe from ${subscription_id}, but no active operation found or socket closed.`);
            return Promise.resolve({
                type: 'unsubscribe_noop',
                id: subscription_id,
                message: 'No active subscription or socket closed.'
            });
        }
        const unsubscribe_message = {
            type: 'unsubscribe',
            id: subscription_id
        };
        return new Promise((resolve, reject) => {
            const op = this.operations.get(subscription_id);
            if (op) {
                this.operations.set(subscription_id, { ...op, resolve, reject });
            }
            else {
                this.operations.set(subscription_id, { resolve, reject });
            }
            try {
                this.send_message(unsubscribe_message);
            }
            catch (error) {
                this.operations.delete(subscription_id);
                reject(error);
            }
        }).finally(() => {
            // Always remove from operations map after unsubscribe attempt (success or error handled by handle_message)
            // handle_message will delete it upon 'unsubscribe_success' or error types.
            // This is a fallback if the promise flow somehow misses it.
            // Actually, handle_message should be the one to delete it.
        });
    }
}
