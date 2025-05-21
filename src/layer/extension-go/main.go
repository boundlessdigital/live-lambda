package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	appsyncwsclient "github.com/boundlessdigital/aws-appsync-events-websockets-client-go"
	// Old proxy import removed, http_proxy_handlers.go and extensions_api_client.go are now part of package main
)

// Environment variables for configuration
const (
	live_lambda_appsync_http_host_env  = "LIVE_LAMBDA_APPSYNC_HTTP_HOST"
	live_lambda_appsync_realtime_host_env = "LIVE_LAMBDA_APPSYNC_REALTIME_HOST"
	lrap_listener_port_env           = "LRAP_LISTENER_PORT"
	lrap_runtime_api_endpoint_env   = "LRAP_RUNTIME_API_ENDPOINT"
	live_lambda_appsync_region_env    = "LIVE_LAMBDA_APPSYNC_REGION"
	main_print_prefix                   = "[LiveLambdaExt:Main]" // MODIFIED
)

// global_appsync_proxy will be an instance of RuntimeAPIProxy (defined below)
var global_appsync_proxy *RuntimeAPIProxy

// RuntimeAPIProxy struct definition (ensure this is defined or updated)
// This struct needs to manage AppSync interactions and implement the AppSyncProxyHelper interface.
type RuntimeAPIProxy struct {
	ctx                  context.Context
	appsync_http_url     string // Corresponds to ClientOptions.AppSyncAPIHost
	appsync_realtime_url string // Corresponds to ClientOptions.AppSyncRealtimeHost
	aws_region           string // For AWS config
	appsync_ws_client    *appsyncwsclient.Client
}

// NewRuntimeAPIProxy constructor (ensure this is defined or updated)
func NewRuntimeAPIProxy(ctx context.Context, actual_runtime_api string, appsync_http_url string, appsync_realtime_url string, aws_region string, listener_port_str string) (*RuntimeAPIProxy, error) {
	log.Printf("%s Initializing RuntimeAPIProxy with target: %s, AppSync HTTP: %s, AppSync Realtime: %s, Region: %s, Listener Port: %s", main_print_prefix, actual_runtime_api, appsync_http_url, appsync_realtime_url, aws_region, listener_port_str)

	// Load AWS configuration (ensure your environment is set up for AWS credentials)
	aws_cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(aws_region))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	client_options := appsyncwsclient.ClientOptions{
		AppSyncAPIHost:      appsync_http_url,     // e.g. <id>.appsync-api.<region>.amazonaws.com
		AppSyncRealtimeHost: appsync_realtime_url, // e.g. <id>.appsync-realtime-api.<region>.amazonaws.com
		AWSRegion:           aws_region,
		AWSCfg:             aws_cfg,
		Debug:              true, // Enable for detailed logging
		KeepAliveInterval:  2 * time.Minute,
		ReadTimeout:        10 * time.Minute, // Default in client is 15, AppSync server idle is often ~10 min
		OperationTimeout:   30 * time.Second,
		OnConnectionAck: func(msg appsyncwsclient.Message) {
			log.Printf("%s [AppSyncWSClient CB] Connection Acknowledged. Timeout: %dms", main_print_prefix, *msg.ConnectionTimeoutMs)
		},
		OnConnectionError: func(msg appsyncwsclient.Message) {
			log.Printf("%s [AppSyncWSClient CB] Connection Error: %s", main_print_prefix, msg.ToJSONString())
		},
		OnConnectionClose: func(code int, reason string) {
			log.Printf("%s [AppSyncWSClient CB] Connection Closed. Code: %d, Reason: %s", main_print_prefix, code, reason)
		},
		OnKeepAlive: func() {
			// log.Printf("%s [AppSyncWSClient CB] Keep-alive received.", main_print_prefix) // Can be noisy
		},
		OnGenericError: func(errMsg appsyncwsclient.MessageError) {
			log.Printf("%s [AppSyncWSClient CB] Generic Error: Type=%s, Message=%s, Code=%v", main_print_prefix, errMsg.ErrorType, errMsg.Message, errMsg.ErrorCode)
		},
		OnSubscriptionError: func(subscriptionID string, errMsg appsyncwsclient.MessageError) {
			log.Printf("%s [AppSyncWSClient CB] Subscription Error for ID '%s': Type=%s, Message=%s, Code=%v",
				main_print_prefix, subscriptionID, errMsg.ErrorType, errMsg.Message, errMsg.ErrorCode)
		},
	}

	client, err := appsyncwsclient.NewClient(client_options)
	if err != nil {
		return nil, fmt.Errorf("failed to create AppSync WebSocket client: %w", err)
	}

	return &RuntimeAPIProxy{
		ctx:                  ctx,
		appsync_http_url:     appsync_http_url,
		appsync_realtime_url: appsync_realtime_url,
		aws_region:           aws_region,
		appsync_ws_client:    client,
	}, nil
}

// manage_web_socket_connection uses the initialized AppSync client to connect and then waits for context cancellation to close.
func (p *RuntimeAPIProxy) manage_web_socket_connection(ctx context.Context) {
	log.Println(main_print_prefix, "RuntimeAPIProxy: manage_web_socket_connection started.")

	if p.appsync_ws_client == nil {
		log.Printf("%s AppSync WebSocket client is nil. Cannot connect.", main_print_prefix)
		return
	}

	log.Printf("%s Attempting to connect to AppSync Events API via WebSocket (%s)...", main_print_prefix, p.appsync_realtime_url)
	if err := p.appsync_ws_client.Connect(ctx); err != nil {
		// Error is already logged by OnConnectionError or initial connect failure within the client
		log.Printf("%s Failed to connect AppSync WebSocket client: %v. Goroutine will exit.", main_print_prefix, err)
		// The client's Connect might retry internally; if it returns an error here, it's likely a non-recoverable initial setup issue
		// or context cancellation during connect.
		return
	}
	// If Connect returns nil, it means the connection was acknowledged or the client will handle retries internally.
	// The actual connection_ack is handled by the OnConnectionAck callback.
	log.Printf("%s AppSync WebSocket client Connect() method returned. Connection process initiated.", main_print_prefix)

	// Wait for the main context to be cancelled (e.g., Lambda shutdown)
	<-ctx.Done()

	log.Printf("%s Context cancelled. Closing AppSync WebSocket client...", main_print_prefix)
	if err := p.appsync_ws_client.Close(); err != nil {
		log.Printf("%s Error closing AppSync WebSocket client: %v", main_print_prefix, err)
	} else {
		log.Printf("%s AppSync WebSocket client closed successfully.", main_print_prefix)
	}
	log.Println(main_print_prefix, "RuntimeAPIProxy: manage_web_socket_connection finished.")
}

// HandleAppSyncSubscriptionForRequest implements AppSyncProxyHelper interface (ensure this is defined or updated)
func (p *RuntimeAPIProxy) HandleAppSyncSubscriptionForRequest(ctx context.Context, request_id string) {
	log.Printf("%s RuntimeAPIProxy: HandleAppSyncSubscriptionForRequest for request_id: %s", main_print_prefix, request_id)
	// Implement actual AppSync subscription logic here
}

// HandleAppSyncPublishForResponse implements AppSyncProxyHelper interface (ensure this is defined or updated)
func (p *RuntimeAPIProxy) HandleAppSyncPublishForResponse(ctx context.Context, request_id string, response_body []byte) {
	log.Printf("%s RuntimeAPIProxy: HandleAppSyncPublishForResponse for request_id: %s, body_len: %d", main_print_prefix, request_id, len(response_body))
	// Implement actual AppSync publish logic here
}

// HandleInvokeEvent is called when an INVOKE event is received from the Extensions API
func (p *RuntimeAPIProxy) HandleInvokeEvent(ctx context.Context, event *NextEventResponse) error {
	log.Printf("%s RuntimeAPIProxy: Handling INVOKE event: %+v", main_print_prefix, event)
	// This is where you might interact with AppSync based on the invoke event details
	// For example, ensuring subscriptions are active or publishing event-specific data.
	// The actual Lambda function's request/response is handled by the http_proxy_handlers.
	// This method is more about coordinating AppSync state with the Lambda lifecycle events.
	return nil
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile | log.Lmicroseconds)
	log.Println(main_print_prefix, "Starting Live Lambda Go Extension...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		s := <-sigs
		log.Printf("%s Received signal: %s. Initiating shutdown...", main_print_prefix, s)
		cancel()
	}()

	appsync_http_url := os.Getenv(live_lambda_appsync_http_host_env)
	appsync_realtime_url := os.Getenv(live_lambda_appsync_realtime_host_env)
	aws_region := os.Getenv(live_lambda_appsync_region_env)

	if appsync_http_url == "" || appsync_realtime_url == "" || aws_region == "" {
		log.Fatalf("%s Missing required AppSync/AWS environment variables. Check Lambda config.", main_print_prefix)
	}

	log.Printf("%s Using AppSync HTTP Host: %s", main_print_prefix, appsync_http_url)
	log.Printf("%s Using AppSync Realtime Host: %s", main_print_prefix, appsync_realtime_url)
	log.Printf("%s Using AWS Region: %s", main_print_prefix, aws_region)

	actual_runtime_api := get_runtime_api_endpoint()
	listener_port := get_listener_port()
	extension_name := filepath.Base(os.Args[0])

	var err error
	global_appsync_proxy, err = NewRuntimeAPIProxy(ctx, actual_runtime_api, appsync_http_url, appsync_realtime_url, aws_region, strconv.Itoa(listener_port))
	if err != nil {
		log.Fatalf("%s Failed to create Runtime API Proxy for AppSync: %v", main_print_prefix, err)
	}

	appsync_done_chan := make(chan struct{})
	go func() {
		defer close(appsync_done_chan)
		log.Println(main_print_prefix, "AppSync WebSocket Manager goroutine starting...")
		global_appsync_proxy.manage_web_socket_connection(ctx) 
		log.Println(main_print_prefix, "AppSync WebSocket Manager goroutine finished.")
	}()

	// SetAppSyncHelper is removed as AppSync logic is now directly in RuntimeAPIProxy methods.

	StartProxy(global_appsync_proxy, actual_runtime_api, listener_port) // This function is from runtime_api_proxy.go (package main)
	log.Printf("%s Proxy server started on port %d, targeting %s", main_print_prefix, listener_port, actual_runtime_api)

	// Initialize the Extensions API client (from extensions_api_client.go, package main)
	extension_client := NewClient(actual_runtime_api) 

	log.Println(main_print_prefix, "Registering extension...")
	_, err = extension_client.Register(ctx, extension_name)
	if err != nil {
		log.Fatalf("%s Failed to register extension: %v", main_print_prefix, err)
	}
	log.Println(main_print_prefix, "Extension registered successfully. Starting event loop.")

EventLoop:
	for {
		select {
		case <-ctx.Done():
			log.Println(main_print_prefix, "Context cancelled, exiting main event loop.")
			break EventLoop
		default:
			event, err := extension_client.NextEvent(ctx)
			if err != nil {
				if ctx.Err() != nil { // Context cancelled during NextEvent
					log.Printf("%s Context cancelled while waiting for next event: %v", main_print_prefix, ctx.Err())
				} else {
					log.Printf("%s Error getting next event: %v. Exiting.", main_print_prefix, err)
				}
				cancel() // Ensure everything shuts down
				break EventLoop
			}

			log.Printf("%s Received event type: %s", main_print_prefix, event.EventType)
			switch event.EventType {
			case Invoke:
				if global_appsync_proxy != nil {
					err := global_appsync_proxy.HandleInvokeEvent(ctx, event)
					if err != nil {
						log.Printf("%s Error handling INVOKE event: %v", main_print_prefix, err)
						// Decide if this is fatal. For now, we continue.
					}
				} else {
					log.Println(main_print_prefix, "global_appsync_proxy is nil, cannot handle INVOKE event")
				}
			case Shutdown:
				log.Printf("%s Received SHUTDOWN event. Reason: %s. Exiting.", main_print_prefix, event.ShutdownReason)
				cancel() // Trigger shutdown for other goroutines
				break EventLoop 
			default:
				log.Printf("%s Received unknown event type: %s", main_print_prefix, event.EventType)
			}
		}
	}

	log.Println(main_print_prefix, "Main event loop finished.")
	// Ensure main context is cancelled if loop exits for any reason other than context cancellation itself
	cancel()

	log.Println(main_print_prefix, "Waiting for AppSync WebSocket Manager to shut down...")
	wait_for_goroutine(appsync_done_chan, "AppSync WebSocket Manager", 5*time.Second)

	log.Println(main_print_prefix, "Live Lambda Go Extension finished.")
}

func get_listener_port() int {
	port_str := os.Getenv(lrap_listener_port_env)
	port_int, err := strconv.Atoi(port_str)
	if err != nil || port_int == 0 {
		log.Printf("%s Invalid or missing %s, defaulting to 9009. Error: %v", main_print_prefix, lrap_listener_port_env, err)
		port_int = 9009 // Default port
	}
	return port_int
}

func get_runtime_api_endpoint() string {
	endpoint := os.Getenv(lrap_runtime_api_endpoint_env)
	if endpoint == "" {
		endpoint = os.Getenv("AWS_LAMBDA_RUNTIME_API")
	}
	if endpoint == "" {
		log.Fatalf("%s AWS_LAMBDA_RUNTIME_API and %s are not set. Cannot determine Runtime API endpoint.", main_print_prefix, lrap_runtime_api_endpoint_env)
	}
	return endpoint
}

func wait_for_goroutine(done_chan <-chan struct{}, name string, timeout time.Duration) {
	select {
	case <-done_chan:
		log.Printf("%s %s goroutine exited gracefully.", main_print_prefix, name)
	case <-time.After(timeout):
		log.Printf("%s Timeout waiting for %s goroutine to exit.", main_print_prefix, name)
	}
}
