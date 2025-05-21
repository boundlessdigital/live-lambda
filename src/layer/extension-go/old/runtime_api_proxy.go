package main

import (
	"bytes"
	"context"
	"crypto/sha256" // For SigV4, though SDK might handle it
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil" // Present in struct, ensure import if used
	"net/url"           // For url.Parse if needed, already used by NewRuntimeAPIProxy implicitly
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config" // Used in NewRuntimeAPIProxy

	"github.com/boundlessdigital/aws-appsync-events-websockets-client-go"
	"github.com/cenkalti/backoff/v4"
)

// RuntimeAPIProxy implements the HTTP server that proxies the Lambda Runtime API
// and handles WebSocket communication.
const (
	appsyncService      = "appsync"
	appsyncEventPath    = "/event"
	appsyncRealtimePath = "/event/realtime"
)

type RuntimeAPIProxy struct {
	listenerPort          string
	actualRuntimeAPI      string // Calculated from AWS_LAMBDA_RUNTIME_API or LRAP_RUNTIME_API_ENDPOINT
	baseRuntimeURL        string
	targetUrl             *url.URL
	reverseProxy          *httputil.ReverseProxy
	server                *http.Server
	appsyncHttpUrl        string // Hostname for AppSync HTTP API
	appsyncRealtimeUrl    string // Hostname for AppSync Realtime API
	appsyncRealtimeUrlWss string // Full wss:// URL for WebSocket
	killProxyServer func()
	proxyDone       chan struct{}
	lambdaRuntimeAPI string

	// AWS SDK and AppSync client specifics
	awsRegion         string
	awsSDKConfig      aws.Config     // Store the loaded AWS SDK config
	appsync_go_client *appsyncwsclient.Client
	current_subscription *appsyncwsclient.Subscription
	current_subscription_request_id string // To track which Lambda request ID the current subscription is for
	subscription_mu    sync.Mutex // To protect current_subscription and current_subscription_request_id
}

// NewRuntimeAPIProxy creates a new RuntimeAPIProxy.
func NewRuntimeAPIProxy(proxyCtx context.Context, lambdaRuntimeAPI, appsyncHttpUrlFromEnv, appsyncRealtimeUrlFromEnv, awsRegionFromEnv, lrapListenerPort string) (*RuntimeAPIProxy, error) {
	runtimeAPIEnv := os.Getenv("LRAP_RUNTIME_API_ENDPOINT") // Specific for wrapper if provided
	if runtimeAPIEnv == "" {
		runtimeAPIEnv = os.Getenv("AWS_LAMBDA_RUNTIME_API")
	}
	if runtimeAPIEnv == "" {
		log.Fatal("AWS_LAMBDA_RUNTIME_API or LRAP_RUNTIME_API_ENDPOINT environment variable not set")
	}

	// Use the resolved runtimeAPIEnv for the target URL and internal storage
	lambdaRuntimeAPI = runtimeAPIEnv // Update lambdaRuntimeAPI to use the resolved value
	target, err := url.Parse("http://" + lambdaRuntimeAPI)
	if err != nil {
		return nil, fmt.Errorf("failed to parse target URL: %w", err)
	}

	// Initialize AWS SDK config for SigV4 signer
	var cfg aws.Config
	// err is already declared by target, err := url.Parse(...)

	// Check if static credentials are likely set via environment (e.g., for testing)
	// The test TestRuntimeAPIProxy_createConnectionAuthSubprotocol also unsets AWS_PROFILE and AWS_SHARED_CREDENTIALS_FILE
	// to ensure these environment variables take precedence when this condition is met.
	if os.Getenv("AWS_ACCESS_KEY_ID") != "" && 
	   os.Getenv("AWS_SECRET_ACCESS_KEY") != "" { // Check for both key and secret as a stronger signal
		log.Println("[RuntimeProxy-AWSConfig] Attempting to load AWS config using environment credentials (likely for testing).")
		cfg, err = config.LoadDefaultConfig(proxyCtx,
			config.WithRegion(awsRegionFromEnv),
			// NOTE: Do NOT specify WithSharedConfigProfile here. This allows the SDK's default credential chain
			// to pick up AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN from the environment,
			// especially since the test clears AWS_PROFILE and AWS_SHARED_CREDENTIALS_FILE.
		)
	} else {
		log.Println("[RuntimeProxy-AWSConfig] Attempting to load AWS config using 'boundless-development' profile.")
		cfg, err = config.LoadDefaultConfig(proxyCtx,
			config.WithRegion(awsRegionFromEnv),
			config.WithSharedConfigProfile("boundless-development"), // As requested by user
		)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to load AWS SDK config: %w", err)
	}

	// Calculate appsyncRealtimeUrlWss once
	var appsyncRealtimeUrlWssValue string
	if appsyncRealtimeUrlFromEnv != "" {
		appsyncRealtimeUrlWssValue = "wss://" + appsyncRealtimeUrlFromEnv + appsyncRealtimePath
		log.Printf("[RuntimeProxy] AppSync WebSocket URL configured: %s", appsyncRealtimeUrlWssValue)
	} else {
		log.Println("[RuntimeProxy] AppSync Realtime URL is empty from environment, WebSocket connection will be skipped if not overridden.")
	}

	proxy := &RuntimeAPIProxy{
		listenerPort:          lrapListenerPort,
		actualRuntimeAPI:      lambdaRuntimeAPI, // This is the resolved API endpoint (e.g., 127.0.0.1:xxxx)
		baseRuntimeURL:        "http://" + lambdaRuntimeAPI,
		targetUrl:             target,
		appsyncHttpUrl:        appsyncHttpUrlFromEnv,     // e.g., "xxxx.appsync-api.us-east-1.amazonaws.com"
		appsyncRealtimeUrl:    appsyncRealtimeUrlFromEnv, // e.g., "xxxx.appsync-realtime-api.us-east-1.amazonaws.com"
		appsyncRealtimeUrlWss: appsyncRealtimeUrlWssValue,
		proxyDone:             make(chan struct{}),
		lambdaRuntimeAPI:      lambdaRuntimeAPI, // Storing the resolved runtime API for other uses if needed
		awsRegion:             awsRegionFromEnv,
		awsSDKConfig:          cfg,
	}

	return proxy, nil
}

// routeRegexps holds compiled regular expressions for routing to improve performance.
var routeRegexps = struct {
	nextInvocation       *regexp.Regexp
	invocationResponse   *regexp.Regexp
	invocationError      *regexp.Regexp
	initializationError  *regexp.Regexp
}{
	nextInvocation:       regexp.MustCompile(`^/2018-06-01/runtime/invocation/next$`),
	invocationResponse:   regexp.MustCompile(`^/2018-06-01/runtime/invocation/([^/]+)/response$`),
	invocationError:      regexp.MustCompile(`^/2018-06-01/runtime/invocation/([^/]+)/error$`),
	initializationError:  regexp.MustCompile(`^/2018-06-01/runtime/init/error$`),
}

// Start initializes and runs the proxy server and WebSocket manager.
func (p *RuntimeAPIProxy) Start(ctx context.Context) error {
	// Start WebSocket connection manager in a separate goroutine
	go p.manageWebSocketConnection(ctx)

	// Configure the HTTP server
	p.server = &http.Server{
		Addr:    ":" + p.listenerPort,
		Handler: p, // The RuntimeAPIProxy itself is the handler via ServeHTTP
	}

	// Goroutine to handle graceful shutdown of the server
	go func() {
		<-ctx.Done() // Wait for context cancellation
		log.Printf("[RuntimeProxy] Context cancelled, shutting down HTTP server on port %s...", p.listenerPort)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second) // Give it a deadline
		defer cancel()
		if err := p.server.Shutdown(shutdownCtx); err != nil {
			log.Printf("[RuntimeProxy] HTTP server shutdown error: %v", err)
		}
		close(p.proxyDone) // Signal that the proxy server has finished shutting down
	}()

	log.Printf("[RuntimeProxy] Starting HTTP server on port %s", p.listenerPort)
	err := p.server.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		// Don't return error if context was cancelled, as shutdown is expected
		if ctx.Err() == nil {
			log.Printf("[RuntimeProxy] HTTP server ListenAndServe error: %v", err)
			return fmt.Errorf("HTTP server ListenAndServe error: %w", err)
		}
	}
	log.Println("[RuntimeProxy] HTTP server finished.")
	return nil // Return nil if server closed cleanly (e.g. via Shutdown or context cancellation)
}

// ServeHTTP is the main request handler for the proxy server.
func (p *RuntimeAPIProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("[RuntimeProxy-HTTP] Received request: Method=%s, URL=%s, Host=%s, RemoteAddr=%s, Headers=%v", r.Method, r.URL.String(), r.Host, r.RemoteAddr, r.Header)
	log.Printf("[RuntimeProxy-HTTP] Generic proxy for %s to %s", r.URL.Path, p.baseRuntimeURL)
	log.Printf("[RuntimeProxy] Request: %s %s", r.Method, r.URL.Path)

	switch r.Method {
	case http.MethodGet:
		if routeRegexps.nextInvocation.MatchString(r.URL.Path) {
			p.handleNextInvocation(w, r)
			return
		}
	case http.MethodPost:
		if matches := routeRegexps.invocationResponse.FindStringSubmatch(r.URL.Path); len(matches) > 1 {
			p.handleInvocationResponse(w, r, matches[1]) // matches[1] is the requestID
			return
		}
		if matches := routeRegexps.invocationError.FindStringSubmatch(r.URL.Path); len(matches) > 1 {
			p.handleInvocationError(w, r, matches[1]) // matches[1] is the requestID
			return
		}
		if routeRegexps.initializationError.MatchString(r.URL.Path) {
			p.handleInitError(w, r)
			return
		}
	}
	log.Printf("[RuntimeProxy] No route found for %s %s", r.Method, r.URL.Path)
	http.NotFound(w, r)
}

func (p *RuntimeAPIProxy) handleNextInvocation(w http.ResponseWriter, r *http.Request) {
	log.Println("[RuntimeProxy] Handling /invocation/next")
	targetURL := "http://" + p.actualRuntimeAPI + "/2018-06-01/runtime/invocation/next"

	// Create a new request with the original request's context to allow cancellation.
	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create upstream /next request: %v", err), http.StatusInternalServerError)
		return
	}
	copyHeaders(r.Header, upstreamReq.Header)

	// Use a client that respects the request's context for timeout/cancellation.
	// The p.upstreamDispatcher has Timeout 0, so it relies on the request context.
	upstreamResp, err := p.appsyncHttpClient.Do(upstreamReq)
	if err != nil {
		// Check if the error is due to context cancellation (expected during shutdown)
		if r.Context().Err() != nil {
			log.Printf("[RuntimeProxy] /next upstream request context cancelled: %v", r.Context().Err())
			// Don't write to w if context is cancelled, client might be gone.
			return
		}
		http.Error(w, fmt.Sprintf("Upstream /next request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer upstreamResp.Body.Close()

	bodyBytes, err := io.ReadAll(upstreamResp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read upstream /next response body: %v", err), http.StatusInternalServerError)
		return
	}

	// Publish event payload to AppSync WebSocket
	var payload interface{}
	if err := json.Unmarshal(bodyBytes, &payload); err == nil {
		// The Node.js version published an array: [payload]
		requestIDFromHeader := upstreamResp.Header.Get("Lambda-Runtime-Aws-Request-Id")
		log.Printf("[RuntimeProxy-DEBUG] In handleNextInvocation, about to publish. RequestID: %s", requestIDFromHeader)
		go p.publishFunc(r.Context(), []interface{}{payload})
	} else {
		log.Printf("[RuntimeProxy] Failed to unmarshal /next payload for WebSocket: %v", err)
	}

	copyHeaders(upstreamResp.Header, w.Header())
	w.WriteHeader(upstreamResp.StatusCode)
	if _, err := w.Write(bodyBytes); err != nil {
		log.Printf("[RuntimeProxy] Error writing /next response to client: %v", err)
	}
}

func (p *RuntimeAPIProxy) handleInvocationResponse(w http.ResponseWriter, r *http.Request, requestID string) {
	log.Printf("[RuntimeProxy] Handling /invocation/%s/response", requestID)
	specificPath := "/2018-06-01/runtime/invocation/" + requestID + "/response"
	upstreamURL := "http://" + p.actualRuntimeAPI + specificPath

	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	copyHeaders(r.Header, upstreamReq.Header)

	resp, err := p.appsyncHttpClient.Do(upstreamReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to send upstream request: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read upstream response body: %v", err), http.StatusBadGateway)
		return
	}

	copyHeaders(resp.Header, w.Header())
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

func (p *RuntimeAPIProxy) handleInvocationError(w http.ResponseWriter, r *http.Request, requestID string) {
	log.Printf("[RuntimeProxy] Handling /invocation/%s/error", requestID)
	specificPath := "/2018-06-01/runtime/invocation/" + requestID + "/error"
	upstreamURL := "http://" + p.actualRuntimeAPI + specificPath

	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	copyHeaders(r.Header, upstreamReq.Header)

	resp, err := p.appsyncHttpClient.Do(upstreamReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to send upstream request: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// No body expected for error response to upstream, but copy status and headers
	copyHeaders(resp.Header, w.Header())
	w.WriteHeader(resp.StatusCode)
}

func (p *RuntimeAPIProxy) handleInitError(w http.ResponseWriter, r *http.Request) {
	log.Println("[RuntimeProxy] Handling /init/error")
	specificPath := "/2018-06-01/runtime/init/error"
	upstreamURL := "http://" + p.actualRuntimeAPI + specificPath

	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	copyHeaders(r.Header, upstreamReq.Header)

	resp, err := p.appsyncHttpClient.Do(upstreamReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to send upstream request: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// No body expected for error response to upstream, but copy status and headers
	copyHeaders(resp.Header, w.Header())
	w.WriteHeader(resp.StatusCode)
}

func (p *RuntimeAPIProxy) proxyGenericRequest(w http.ResponseWriter, r *http.Request, targetURL string, isErrorRoute bool) {
	bodyBytes, err := io.ReadAll(r.Body) // Read body first for potential use (e.g., error type)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusInternalServerError)
		return
	}
	// Restore body for upstream request, as r.Body is an io.ReadCloser and can only be read once.
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	copyHeaders(r.Header, upstreamReq.Header)

	if isErrorRoute {
		// Attempt to extract errorType for Lambda-Runtime-Function-Error-Type header
		var bodyJSON map[string]interface{}
		errorType := "UnhandledRuntimeError" // Default from Node.js version
		if err := json.Unmarshal(bodyBytes, &bodyJSON); err == nil {
			if et, ok := bodyJSON["errorType"].(string); ok {
				errorType = et
			}
		}
		upstreamReq.Header.Set("Lambda-Runtime-Function-Error-Type", errorType)
	}

	upstreamResp, err := p.appsyncHttpClient.Do(upstreamReq)
	if err != nil {
		if r.Context().Err() != nil {
			log.Printf("[RuntimeProxy] Generic upstream request context cancelled: %v", r.Context().Err())
			return
		}
		http.Error(w, fmt.Sprintf("Upstream request to %s failed: %v", targetURL, err), http.StatusBadGateway)
		return
	}
	defer upstreamResp.Body.Close()

	respBodyBytes, err := io.ReadAll(upstreamResp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read upstream response body: %v", err), http.StatusInternalServerError)
		return
	}

	copyHeaders(upstreamResp.Header, w.Header())
	w.WriteHeader(upstreamResp.StatusCode)
	if _, err := w.Write(respBodyBytes); err != nil {
		log.Printf("[RuntimeProxy] Error writing response to client: %v", err)
	}
}

func copyHeaders(src http.Header, dst http.Header) {
	for k, vv := range src {
		dst[k] = nil // Clear existing to avoid duplicates if Add is used below
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

func (p *RuntimeAPIProxy) manageWebSocketConnection(ctx context.Context) {
	log.Println("[RuntimeProxy-WS-Manager] Starting AppSync client connection manager.")
	defer log.Println("[RuntimeProxy-WS-Manager] AppSync client connection manager stopped.")

	// Construct the AppSync HTTP API URL for signing (used by the client options)
	// Example: https://<your-appsync-api-id>.appsync-api.<your-region>.amazonaws.com/event
	appsyncAPIHttpUrlForSigning := ""
	if p.appsyncHttpUrl != "" {
		appsyncAPIHttpUrlForSigning = "https://" + p.appsyncHttpUrl + appsyncEventPath
	} else {
		log.Println("[RuntimeProxy-WS-Manager] AppSync HTTP URL (for signing) is not configured. WebSocket connections may fail if required.")
		// Depending on auth method, this might be critical. For IAM, it is.
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("[RuntimeProxy-WS-Manager] Context done, stopping AppSync client management.")
			if p.appsync_go_client != nil {
				log.Println("[RuntimeProxy-WS-Manager] Closing AppSync client due to context cancellation...")
				if err := p.appsync_go_client.Close(); err != nil {
					log.Printf("[RuntimeProxy-WS-Manager] Error closing AppSync client: %v", err)
				}
				p.appsync_go_client = nil
			}
			return
		default:
		}

		if p.appsync_go_client == nil {
			log.Println("[RuntimeProxy-WS-Manager] AppSync client is not initialized or was closed. Attempting to create and connect...")

			if p.appsyncRealtimeUrlWss == "" {
				log.Println("[RuntimeProxy-WS-Manager] AppSync Realtime WSS URL is empty. Cannot initialize client. Waiting...")
				time.Sleep(5 * time.Second) // Wait before retrying initialization
				continue
			}
			if appsyncAPIHttpUrlForSigning == "" {
				log.Println("[RuntimeProxy-WS-Manager] AppSync HTTP URL for signing is empty. Cannot initialize client for IAM auth. Waiting...")
				time.Sleep(5 * time.Second)
				continue
			}

			clientOptions := appsyncwsclient.ClientOptions{
				AppSyncAPIURL:      appsyncAPIHttpUrlForSigning, // HTTP URL for request signing
				RealtimeServiceURL: p.appsyncRealtimeUrlWss,   // WSS URL for the actual connection
				AWSCfg:             p.awsSDKConfig,
				Debug:              true, // TODO: Make this configurable
				KeepAliveInterval:  2 * time.Minute,
				ReadTimeout:        10 * time.Minute, // AppSync server idle timeout is 10 mins
				OperationTimeout:   30 * time.Second,
				OnConnectionAck: func(msg appsyncwsclient.Message) {
					log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Connection Acknowledged. Timeout: %dms", *msg.ConnectionTimeoutMs)
				},
				OnConnectionError: func(msg appsyncwsclient.Message) {
					log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Connection Error: %s", msg.ToJSONString())
					// This might indicate a need to re-evaluate connection parameters or credentials.
					// Client's Connect might retry, or we might need to force p.appsync_go_client = nil here to reinit.
				},
				OnConnectionClose: func(code int, reason string) {
					log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Connection Closed. Code: %d, Reason: %s", code, reason)
					// Force re-initialization on next loop iteration if connection closed unexpectedly.
					p.appsync_go_client = nil 
					// Also, if there was an active subscription, it needs to be cleaned up/marked as inactive.
					p.subscription_mu.Lock()
					if p.current_subscription != nil {
						log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Clearing active subscription ID %s due to connection close.", p.current_subscription.ID())
						// The client's Close() or the subscription's context should handle actual unsub, but we clear our reference.
						p.current_subscription = nil
						p.current_subscription_request_id = ""
					}
					p.subscription_mu.Unlock()
				},
				OnKeepAlive: func() {
					log.Println("[RuntimeProxy-WS-Manager-CALLBACK] Keep-alive received.")
				},
				OnGenericError: func(errMsg appsyncwsclient.MessageError) {
					log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Generic Error: Type=%s, Message=%s, Code=%v", errMsg.ErrorType, errMsg.Message, errMsg.ErrorCode)
				},
				OnSubscriptionError: func(subscriptionID string, errMsg appsyncwsclient.MessageError) {
					log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Subscription Error for ID '%s': Type=%s, Message=%s, Code=%v",
						subscriptionID, errMsg.ErrorType, errMsg.Message, errMsg.ErrorCode)
					// Potentially clear this specific subscription if it's the current_subscription
					p.subscription_mu.Lock()
					if p.current_subscription != nil && p.current_subscription.ID() == subscriptionID {
						log.Printf("[RuntimeProxy-WS-Manager-CALLBACK] Clearing current subscription %s due to subscription error.", subscriptionID)
						p.current_subscription = nil
						p.current_subscription_request_id = ""
					}
					p.subscription_mu.Unlock()
				},
			}

			var clientErr error
			p.appsync_go_client, clientErr = appsyncwsclient.NewClient(clientOptions)
			if clientErr != nil {
				log.Printf("[RuntimeProxy-WS-Manager] Failed to create new AppSync client: %v. Retrying after delay...", clientErr)
				p.appsync_go_client = nil // Ensure it's nil so we retry creation
				time.Sleep(5 * time.Second)
				continue // Retry client creation
			}
			log.Println("[RuntimeProxy-WS-Manager] AppSync client created. Attempting to connect...")

			// Connection attempt with backoff
			backoffPolicy := backoff.NewExponentialBackOff()
			backoffPolicy.InitialInterval = 1 * time.Second
			backoffPolicy.RandomizationFactor = 0.5
			backoffPolicy.Multiplier = 2
			backoffPolicy.MaxInterval = 30 * time.Second
			backoffPolicy.MaxElapsedTime = 2 * time.Minute // Limit total time for connection retries for a single attempt sequence

			connectErr := backoff.Retry(func() error {
				select {
				case <-ctx.Done():
					log.Println("[RuntimeProxy-WS-Manager] Context done during client connect retry, aborting.")
					return backoff.Permanent(ctx.Err())
				default:
				}
				dialCtx, dialCancel := context.WithTimeout(ctx, clientOptions.OperationTimeout+5*time.Second) // Timeout for the Connect operation itself
				defer dialCancel()
				
				log.Println("[RuntimeProxy-WS-Manager] Calling AppSync client Connect()...")
				if err := p.appsync_go_client.Connect(dialCtx); err != nil {
					log.Printf("[RuntimeProxy-WS-Manager] AppSync client Connect() failed: %v. Retrying...", err)
					return err // Retryable error
				}
				log.Println("[RuntimeProxy-WS-Manager] AppSync client Connect() successful.")
				return nil // Success
			}, backoffPolicy)

			if connectErr != nil {
				log.Printf("[RuntimeProxy-WS-Manager] AppSync client connection attempt failed after retries: %v. Client will be re-initialized.", connectErr)
				if p.appsync_go_client != nil {
					_ = p.appsync_go_client.Close() // Ensure cleanup of partially initialized client
				}
				p.appsync_go_client = nil // Mark for re-initialization
				// If context was cancelled, the main loop will catch it.
				// Otherwise, we sleep briefly before the next iteration tries to re-initialize client.
				time.Sleep(1 * time.Second)
				continue
			}
			log.Println("[RuntimeProxy-WS-Manager] AppSync client successfully connected and managing its own lifecycle.")
		} else {
			// Client exists, assume it's managing its connection state. Monitor for OnConnectionClose to set it to nil.
			// log.Println("[RuntimeProxy-WS-Manager] AppSync client instance exists. Monitoring...")
		}

		// Sleep briefly before the next check, unless context is done.
		select {
		case <-time.After(5 * time.Second): // Check health/status less frequently once client is up
		case <-ctx.Done():
			// Already handled at the top of the loop, but good for quick exit if sleep is long
			log.Println("[RuntimeProxy-WS-Manager] Context done during idle period.")
			return
		}
	}
}
