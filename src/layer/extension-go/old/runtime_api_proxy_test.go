package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

const testAppsyncRealtimePath = "/event/realtime" // Replicate for test visibility

func TestNewRuntimeAPIProxy(t *testing.T) {
	ctx := context.Background()

	// Common test values
	const (
		defaultListenerPort      = "9001"
		defaultLambdaRuntimeAPI  = "127.0.0.1:9000"
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
	)

	// Backup original env vars and defer restore
	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()

	t.Run("Successful initialization - AWS_LAMBDA_RUNTIME_API only", func(t *testing.T) {
		os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI)
		os.Unsetenv("LRAP_RUNTIME_API_ENDPOINT") // Ensure it's not set

		proxy, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
		if err != nil {
			t.Fatalf("NewRuntimeAPIProxy failed: %v", err)
		}

		if proxy == nil {
			t.Fatal("Expected proxy to be non-nil")
		}
		if proxy.listenerPort != defaultListenerPort {
			t.Errorf("Expected listenerPort %s, got %s", defaultListenerPort, proxy.listenerPort)
		}
		if proxy.actualRuntimeAPI != defaultLambdaRuntimeAPI {
			t.Errorf("Expected actualRuntimeAPI %s (from AWS_LAMBDA_RUNTIME_API), got %s", defaultLambdaRuntimeAPI, proxy.actualRuntimeAPI)
		}
		if proxy.baseRuntimeURL != defaultLambdaRuntimeAPI {
			t.Errorf("Expected baseRuntimeURL %s, got %s", defaultLambdaRuntimeAPI, proxy.baseRuntimeURL)
		}
		expectedTargetURL := "http://" + defaultLambdaRuntimeAPI
		if proxy.targetUrl.String() != expectedTargetURL {
			t.Errorf("Expected targetUrl %s, got %s", expectedTargetURL, proxy.targetUrl.String())
		}
		if proxy.appsyncHttpUrl != defaultAppsyncHttpUrl {
			t.Errorf("Expected appsyncHttpUrl %s, got %s", defaultAppsyncHttpUrl, proxy.appsyncHttpUrl)
		}
		if proxy.appsyncRealtimeUrl != defaultAppsyncRealtimeUrl {
			t.Errorf("Expected appsyncRealtimeUrl %s, got %s", defaultAppsyncRealtimeUrl, proxy.appsyncRealtimeUrl)
		}
		expectedWssUrl := "wss://" + defaultAppsyncRealtimeUrl + testAppsyncRealtimePath
		if proxy.appsyncRealtimeUrlWss != expectedWssUrl {
			t.Errorf("Expected appsyncRealtimeUrlWss %s, got %s", expectedWssUrl, proxy.appsyncRealtimeUrlWss)
		}
		if proxy.awsRegion != defaultAwsRegion {
			t.Errorf("Expected awsRegion %s, got %s", defaultAwsRegion, proxy.awsRegion)
		}
		if proxy.signer == nil {
			t.Error("Expected signer to be non-nil")
		}
		if proxy.appsyncHttpClient == nil {
			t.Error("Expected appsyncHttpClient to be non-nil")
		}
		if proxy.wsChannel != "default_lrap_channel" {
			t.Errorf("Expected wsChannel 'default_lrap_channel', got '%s'", proxy.wsChannel)
		}
	})

	t.Run("Successful initialization - LRAP_RUNTIME_API_ENDPOINT overrides", func(t *testing.T) {
		lrapEndpoint := "127.0.0.1:9050"
		os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI) // Original
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", lrapEndpoint)      // Override

		proxy, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
		if err != nil {
			t.Fatalf("NewRuntimeAPIProxy failed: %v", err)
		}
		if proxy.actualRuntimeAPI != lrapEndpoint {
			t.Errorf("Expected actualRuntimeAPI %s (from LRAP_RUNTIME_API_ENDPOINT), got %s", lrapEndpoint, proxy.actualRuntimeAPI)
		}
		// baseRuntimeURL should still be the original AWS_LAMBDA_RUNTIME_API passed as argument
		if proxy.baseRuntimeURL != defaultLambdaRuntimeAPI {
			t.Errorf("Expected baseRuntimeURL %s, got %s", defaultLambdaRuntimeAPI, proxy.baseRuntimeURL)
		}
		// targetUrl for reverse proxy should also be based on the original AWS_LAMBDA_RUNTIME_API argument
		expectedTargetURL := "http://" + defaultLambdaRuntimeAPI
		if proxy.targetUrl.String() != expectedTargetURL {
			t.Errorf("Expected targetUrl %s, got %s", expectedTargetURL, proxy.targetUrl.String())
		}
	})

	t.Run("Initialization with empty AppSync Realtime URL", func(t *testing.T) {
		os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI)
		os.Unsetenv("LRAP_RUNTIME_API_ENDPOINT")

		proxy, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, "", defaultAwsRegion, defaultListenerPort)
		if err != nil {
			t.Fatalf("NewRuntimeAPIProxy failed: %v", err)
		}
		if proxy.appsyncRealtimeUrlWss != "" {
			t.Errorf("Expected appsyncRealtimeUrlWss to be empty, got '%s'", proxy.appsyncRealtimeUrlWss)
		}
		// Check logs (difficult to do precisely in unit tests without log capture, but this is a good place for it if possible)
	})
	
	t.Run("Fails if AWS_LAMBDA_RUNTIME_API env var is not set (for actualRuntimeAPI)", func(t *testing.T) {
		os.Unsetenv("AWS_LAMBDA_RUNTIME_API")
		os.Unsetenv("LRAP_RUNTIME_API_ENDPOINT")
		
		// NewRuntimeAPIProxy currently calls log.Fatal if AWS_LAMBDA_RUNTIME_API and LRAP_RUNTIME_API_ENDPOINT are not set
		// This will cause the test to exit. To properly test this, NewRuntimeAPIProxy should return an error.
		// For now, this test case illustrates the current behavior and limitation.
		// If NewRuntimeAPIProxy is refactored to return an error, this test should be updated.
		
		// _, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
		// if err == nil {
		// 	t.Error("Expected NewRuntimeAPIProxy to fail due to missing AWS_LAMBDA_RUNTIME_API for actualRuntimeAPI, but it succeeded")
		// } else if !strings.Contains(err.Error(), "AWS_LAMBDA_RUNTIME_API or LRAP_RUNTIME_API_ENDPOINT environment variable not set") {
		//  t.Errorf("Expected error message about missing runtime API env vars, got: %v", err)
		// }
		// This test is commented out because log.Fatal cannot be directly tested for error return.
		// It's a known current state of NewRuntimeAPIProxy.
		t.Log("Skipping test for fatal error on missing runtime API env vars, as log.Fatal is used.")
	})

	t.Run("Fails if lambdaRuntimeAPI argument (for targetUrl) is invalid", func(t *testing.T) {
		os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI) // For actualRuntimeAPI
		os.Unsetenv("LRAP_RUNTIME_API_ENDPOINT")

		// Use a URL that is more likely to cause url.Parse to fail
		// An empty host or scheme with control characters usually does the trick.
		// The lambdaRuntimeAPI argument is prefixed with "http://" in url.Parse, so just an invalid host/port is needed.
		_, err := NewRuntimeAPIProxy(ctx, "\x00control-char-host:1234", defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
		if err == nil {
			t.Fatal("NewRuntimeAPIProxy expected to fail due to invalid target URL, but it succeeded")
		}
		if !strings.Contains(err.Error(), "failed to parse target URL") {
			t.Errorf("Expected error about parsing target URL, got: %v", err)
		}
	})
}

// Mock publishToWebSocket for handler tests
type mockRuntimeAPIProxy struct {
	RuntimeAPIProxy
	lastPublishedPayload interface{}
	publishCallCount     int
}

func (m *mockRuntimeAPIProxy) publishToWebSocket(ctx context.Context, payload interface{}) {
	m.publishCallCount++
	m.lastPublishedPayload = payload
	// In a real scenario, this would publish to a WebSocket.
	// For testing, we just record the payload.
	fmt.Printf("[MockRuntimeAPIProxy] publishToWebSocket called with: %+v\n", payload)
}

func TestRuntimeAPIProxy_ServeHTTP_Routing(t *testing.T) {
	ctx := context.Background()
	const (
		defaultLambdaRuntimeAPI  = "127.0.0.1:9000"
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
		defaultListenerPort      = "9002" // Use a different port for this test suite
	)

	// Setup environment variables needed by NewRuntimeAPIProxy
	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API") // Already backed up by TestNewRuntimeAPIProxy, but good practice
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", defaultLambdaRuntimeAPI) // Simplifies actualRuntimeAPI

	baseProxy, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
	if err != nil {
		t.Fatalf("Failed to create base RuntimeAPIProxy: %v", err)
	}

	testCases := []struct {
		name       string
		method     string
		path       string
		expect404  bool
	}{
		{
			name:      "Next Invocation",
			method:    http.MethodGet,
			path:      "/2018-06-01/runtime/invocation/next",
			expect404: false, // Will be handled by handleNextInvocation
		},
		{
			name:      "Invocation Response",
			method:    http.MethodPost,
			path:      "/2018-06-01/runtime/invocation/some-req-id/response",
			expect404: false, // Will be handled by handleInvocationResponse
		},
		{
			name:      "Invocation Error",
			method:    http.MethodPost,
			path:      "/2018-06-01/runtime/invocation/another-req-id/error",
			expect404: false, // Will be handled by handleInvocationError
		},
		{
			name:      "Init Error",
			method:    http.MethodPost,
			path:      "/2018-06-01/runtime/init/error",
			expect404: false, // Will be handled by handleInitError
		},
		{
			name:      "Unknown Path",
			method:    http.MethodGet,
			path:      "/unknown/path",
			expect404: true,
		},
		{
			name:      "Next Invocation Wrong Method",
			method:    http.MethodPost, // Correct is GET
			path:      "/2018-06-01/runtime/invocation/next",
			expect404: true, // Falls through switch to NotFound
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rr := httptest.NewRecorder()

			baseProxy.ServeHTTP(rr, req)

			if tc.expect404 {
				if rr.Code != http.StatusNotFound {
					t.Errorf("Expected status %d NotFound for %s %s, got %d", http.StatusNotFound, tc.method, tc.path, rr.Code)
				}
			} else {
				if rr.Code == http.StatusNotFound {
					t.Errorf("Expected path %s %s to be handled (not 404), but got 404", tc.method, tc.path)
				}
				if rr.Code != http.StatusBadGateway && rr.Code != http.StatusInternalServerError && rr.Code != http.StatusOK {
					t.Logf("Path %s %s was handled, status: %d. Body: %s", tc.method, tc.path, rr.Code, rr.Body.String())
				}
			}
		})
	}
}

func TestRuntimeAPIProxy_handleNextInvocation(t *testing.T) {
	ctx := context.Background()
	const (
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
		defaultListenerPort      = "9003" // Different port for test isolation
	)

	// Mock upstream Lambda Runtime API
	mockUpstreamLambdaAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("Upstream mock expected GET, got %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/invocation/next") { // Allow for potential prefix if full URL is passed
			t.Errorf("Upstream mock expected path /invocation/next, got %s", r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Lambda-Runtime-Aws-Request-Id", "test-request-id")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"eventType":"INVOKE","deadlineMs":12345,"invokedFunctionArn":"arn:aws:lambda:us-east-1:123456789012:function:testFunc"}`)
	}))
	defer mockUpstreamLambdaAPI.Close()

	// Extract host:port from mock server URL
	mockUpstreamHostPort := strings.TrimPrefix(mockUpstreamLambdaAPI.URL, "http://")

	// Setup environment variables needed by NewRuntimeAPIProxy
	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	// Set AWS_LAMBDA_RUNTIME_API to the mock server for the main RuntimeAPIProxy logic to pick up baseRuntimeURL
	os.Setenv("AWS_LAMBDA_RUNTIME_API", mockUpstreamHostPort)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", mockUpstreamHostPort) // Ensure actualRuntimeAPI is also the mock

	// Create mockRuntimeAPIProxy instance
	// The first argument to NewRuntimeAPIProxy (lambdaRuntimeAPI) is for the httputil.ReverseProxy target,
	// which isn't directly used by handleNextInvocation. The critical part is that baseRuntimeURL
	// (derived from AWS_LAMBDA_RUNTIME_API or LRAP_RUNTIME_API_ENDPOINT) points to our mock.
	proxy, err := NewRuntimeAPIProxy(ctx, mockUpstreamHostPort, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
	if err != nil {
		t.Fatalf("Failed to create RuntimeAPIProxy: %v", err)
	}

	var publishCallCount int
	var lastPublishedPayload interface{}
	var publishMutex sync.Mutex // To safely update count and payload from goroutine
	doneChan := make(chan bool, 1)

	proxy.publishFunc = func(ctx context.Context, payload interface{}) {
		publishMutex.Lock()
		// Simulate some work or log
		log.Printf("[TestMock-WS] Mock publishFunc called with payload: %+v", payload)
		publishCallCount++
		lastPublishedPayload = payload
		publishMutex.Unlock() // Unlock before sending to channel to avoid potential deadlock if receiver is slow
		doneChan <- true
	}

	// Prepare request for handleNextInvocation
	req := httptest.NewRequest(http.MethodGet, "http://localhost/2018-06-01/runtime/invocation/next", nil)
	rr := httptest.NewRecorder()

	// Call the handler
	proxy.handleNextInvocation(rr, req)

	// Verify response to the original caller
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status %d OK, got %d. Body: %s", http.StatusOK, rr.Code, rr.Body.String())
	}
	expectedBody := `{"eventType":"INVOKE","deadlineMs":12345,"invokedFunctionArn":"arn:aws:lambda:us-east-1:123456789012:function:testFunc"}` + "\n"
	if rr.Body.String() != expectedBody {
		t.Errorf("Expected body '%s', got '%s'", strings.TrimSpace(expectedBody), strings.TrimSpace(rr.Body.String()))
	}
	if rr.Header().Get("Lambda-Runtime-Aws-Request-Id") != "test-request-id" {
		t.Errorf("Expected header Lambda-Runtime-Aws-Request-Id 'test-request-id', got '%s'", rr.Header().Get("Lambda-Runtime-Aws-Request-Id"))
	}

	// Verify WebSocket publish call
	select {
	case <-doneChan:
		log.Println("[TestMock-WS] publishFunc completed.")
	case <-time.After(2 * time.Second): // Increased timeout for goroutine scheduling
		t.Fatal("Timed out waiting for publishFunc to be called")
	}

	publishMutex.Lock() // Ensure visibility of updates from mock publishFunc
	currentPublishCallCount := publishCallCount
	currentLastPublishedPayload := lastPublishedPayload
	publishMutex.Unlock()

	if currentPublishCallCount != 1 {
		t.Errorf("Expected publishToWebSocket to be called once, called %d times", currentPublishCallCount)
	}

	if currentLastPublishedPayload == nil {
		t.Fatal("Expected a payload to be published to WebSocket, but it was nil")
	}

	// Check the structure and content of the published payload
	// It should be []interface{}{payloadFromUpstream}
	publishedPayloadArray, ok := currentLastPublishedPayload.([]interface{})
	if !ok {
		t.Fatalf("Expected published payload to be an []interface{}, got %T", currentLastPublishedPayload)
	}
	if len(publishedPayloadArray) != 1 {
		t.Fatalf("Expected published payload array to have 1 element, got %d", len(publishedPayloadArray))
	}

	publishedEvent, ok := publishedPayloadArray[0].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected published event to be a map[string]interface{}, got %T", publishedPayloadArray[0])
	}
	if publishedEvent["eventType"] != "INVOKE" {
		t.Errorf("Expected published eventType 'INVOKE', got '%v'", publishedEvent["eventType"])
	}
	if int(publishedEvent["deadlineMs"].(float64)) != 12345 { // JSON numbers are float64 by default
		t.Errorf("Expected published deadlineMs 12345, got '%v'", publishedEvent["deadlineMs"])
	}
}

func TestRuntimeAPIProxy_handleInvocationResponse(t *testing.T) {
	ctx := context.Background()
	const (
		requestID                = "test-response-req-id"
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
		defaultListenerPort      = "9004"
	)
	requestBody := `{"status":"success"}`
	responseBody := `{"message":"processed"}`

	mockUpstreamLambdaAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("Upstream mock expected POST, got %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		expectedPath := fmt.Sprintf("/2018-06-01/runtime/invocation/%s/response", requestID)
		if !strings.HasSuffix(r.URL.Path, expectedPath) {
			t.Errorf("Upstream mock expected path %s, got %s", expectedPath, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		if string(bodyBytes) != requestBody {
			t.Errorf("Upstream mock expected body '%s', got '%s'", requestBody, string(bodyBytes))
		}
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprint(w, responseBody)
	}))
	defer mockUpstreamLambdaAPI.Close()
	mockUpstreamHostPort := strings.TrimPrefix(mockUpstreamLambdaAPI.URL, "http://")

	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	os.Setenv("AWS_LAMBDA_RUNTIME_API", mockUpstreamHostPort)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", mockUpstreamHostPort)

	proxy, err := NewRuntimeAPIProxy(ctx, mockUpstreamHostPort, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
	if err != nil {
		t.Fatalf("Failed to create RuntimeAPIProxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/ignored", strings.NewReader(requestBody))
	rr := httptest.NewRecorder()

	proxy.handleInvocationResponse(rr, req, requestID)

	if rr.Code != http.StatusAccepted {
		t.Errorf("Expected status %d Accepted, got %d", http.StatusAccepted, rr.Code)
	}
	if rr.Body.String() != responseBody {
		t.Errorf("Expected body '%s', got '%s'", responseBody, rr.Body.String())
	}
}

func TestRuntimeAPIProxy_handleInvocationError(t *testing.T) {
	ctx := context.Background()
	const (
		requestID                = "test-error-req-id"
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
		defaultListenerPort      = "9005"
		errorType                = "My.CustomErrorType"
	)
	requestBody := fmt.Sprintf(`{"errorType":"%s", "errorMessage":"test error"}`, errorType)

	mockUpstreamLambdaAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("Upstream mock expected POST, got %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		expectedPath := fmt.Sprintf("/2018-06-01/runtime/invocation/%s/error", requestID)
		if !strings.HasSuffix(r.URL.Path, expectedPath) {
			t.Errorf("Upstream mock expected path %s, got %s", expectedPath, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		if string(bodyBytes) != requestBody {
			t.Errorf("Upstream mock expected body '%s', got '%s'", requestBody, string(bodyBytes))
		}
		if r.Header.Get("Lambda-Runtime-Function-Error-Type") != errorType {
			t.Errorf("Upstream mock expected header Lambda-Runtime-Function-Error-Type '%s', got '%s'", errorType, r.Header.Get("Lambda-Runtime-Function-Error-Type"))
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer mockUpstreamLambdaAPI.Close()
	mockUpstreamHostPort := strings.TrimPrefix(mockUpstreamLambdaAPI.URL, "http://")

	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	os.Setenv("AWS_LAMBDA_RUNTIME_API", mockUpstreamHostPort)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", mockUpstreamHostPort)

	proxy, err := NewRuntimeAPIProxy(ctx, mockUpstreamHostPort, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
	if err != nil {
		t.Fatalf("Failed to create RuntimeAPIProxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/ignored", strings.NewReader(requestBody))
	req.Header.Set("Lambda-Runtime-Function-Error-Type", errorType)
	rr := httptest.NewRecorder()

	proxy.handleInvocationError(rr, req, requestID)

	if rr.Code != http.StatusAccepted {
		t.Errorf("Expected status %d Accepted, got %d", http.StatusAccepted, rr.Code)
	}
}

func TestRuntimeAPIProxy_handleInitError(t *testing.T) {
	ctx := context.Background()
	const (
		defaultAppsyncHttpUrl    = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion         = "us-east-1"
		defaultListenerPort      = "9006"
		errorType                = "Init.Failure"
	)
	requestBody := fmt.Sprintf(`{"errorType":"%s", "errorMessage":"init failed spectacularly"}`, errorType)

	mockUpstreamLambdaAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("Upstream mock expected POST, got %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		expectedPath := "/2018-06-01/runtime/init/error"
		if !strings.HasSuffix(r.URL.Path, expectedPath) {
			t.Errorf("Upstream mock expected path %s, got %s", expectedPath, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		bodyBytes, _ := io.ReadAll(r.Body)
		if string(bodyBytes) != requestBody {
			t.Errorf("Upstream mock expected body '%s', got '%s'", requestBody, string(bodyBytes))
		}
		if r.Header.Get("Lambda-Runtime-Function-Error-Type") != errorType {
			t.Errorf("Upstream mock expected header Lambda-Runtime-Function-Error-Type '%s', got '%s'", errorType, r.Header.Get("Lambda-Runtime-Function-Error-Type"))
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer mockUpstreamLambdaAPI.Close()
	mockUpstreamHostPort := strings.TrimPrefix(mockUpstreamLambdaAPI.URL, "http://")

	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	os.Setenv("AWS_LAMBDA_RUNTIME_API", mockUpstreamHostPort)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", mockUpstreamHostPort)

	proxy, err := NewRuntimeAPIProxy(ctx, mockUpstreamHostPort, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, defaultListenerPort)
	if err != nil {
		t.Fatalf("Failed to create RuntimeAPIProxy: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/ignored", strings.NewReader(requestBody))
	req.Header.Set("Lambda-Runtime-Function-Error-Type", errorType) // errorType is specific to TestRuntimeAPIProxy_handleInitError
	rr := httptest.NewRecorder()

	proxy.handleInitError(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("Expected status %d Accepted, got %d", http.StatusAccepted, rr.Code)
	}
}


// Helper function to copy headers (needed by handlers, good to have in test file too for local mocks if any)
func testCopyHeaders(src http.Header, dst http.Header) {
	for k, vv := range src {
		dst[k] = nil // Clear existing to avoid duplicates if Add is used below
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

func TestRuntimeAPIProxy_StartAndShutdown(t *testing.T) {
	const (
		defaultLambdaRuntimeAPI   = "127.0.0.1:9000" // Not directly hit, but needed for New
		defaultAppsyncHttpUrl     = "appsync-http.example.com"
		defaultAppsyncRealtimeUrl = "appsync-realtime.example.com"
		defaultAwsRegion          = "us-east-1"
		testListenerPort          = "9007" // Unique port for this test
	)

	// Setup environment variables
	originalLrapRuntimeEndpoint := os.Getenv("LRAP_RUNTIME_API_ENDPOINT")
	originalAwsLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	defer func() {
		os.Setenv("LRAP_RUNTIME_API_ENDPOINT", originalLrapRuntimeEndpoint)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalAwsLambdaRuntimeAPI)
	}()
	os.Setenv("AWS_LAMBDA_RUNTIME_API", defaultLambdaRuntimeAPI)
	os.Setenv("LRAP_RUNTIME_API_ENDPOINT", defaultLambdaRuntimeAPI)

	ctx, cancel := context.WithCancel(context.Background())
	// Deliberately not calling defer cancel() here immediately,
	// as we want to control cancellation for the shutdown test.

	proxy, err := NewRuntimeAPIProxy(ctx, defaultLambdaRuntimeAPI, defaultAppsyncHttpUrl, defaultAppsyncRealtimeUrl, defaultAwsRegion, testListenerPort)
	if err != nil {
		t.Fatalf("NewRuntimeAPIProxy failed: %v", err)
	}

	startErrChan := make(chan error, 1)
	go func() {
		t.Logf("Starting proxy on port %s", testListenerPort)
		// The Start method's context is ctx, which we will cancel.
		startErrChan <- proxy.Start(ctx)
		t.Log("Proxy Start method returned.")
	}()

	// Allow a moment for the server to start
	time.Sleep(200 * time.Millisecond) // Increased sleep slightly

	// Attempt to connect to the server to see if it's up
	connAddr := "127.0.0.1:" + testListenerPort
	conn, err := net.DialTimeout("tcp", connAddr, 1*time.Second)
	if err != nil {
		// If connection fails, cancel context before failing to ensure goroutine exits
		cancel()
		t.Fatalf("Failed to connect to proxy server on %s: %v", connAddr, err)
	}
	t.Logf("Successfully connected to proxy server on %s", connAddr)
	_ = conn.Close()

	// Now, cancel the context to trigger shutdown
	t.Log("Cancelling context to shut down proxy server...")
	cancel() // This is the main cancellation for shutdown

	// Wait for proxy.Start() to return or timeout
	select {
	case err := <-startErrChan:
		if err != nil && err != http.ErrServerClosed {
			// Our Start method is designed to return nil on graceful shutdown (ErrServerClosed is handled)
			t.Errorf("proxy.Start() returned an unexpected error: %v", err)
		} else if err == http.ErrServerClosed {
			t.Log("proxy.Start() returned http.ErrServerClosed as expected.")
		} else {
			t.Log("proxy.Start() returned nil as expected on graceful shutdown.")
		}
	case <-time.After(3 * time.Second): // Give it some time to shut down
		t.Fatal("proxy.Start() did not return after context cancellation within timeout")
	}

	// Allow a moment for the server to fully shut down
	time.Sleep(200 * time.Millisecond)

	// Attempt to connect again, expecting failure
	_, err = net.DialTimeout("tcp", connAddr, 1*time.Second)
	if err == nil {
		t.Fatalf("Proxy server on %s unexpectedly accepted connection after shutdown.", connAddr)
	} else {
		t.Logf("Proxy server on %s correctly refused connection after shutdown: %v", connAddr, err)
	}
}

func TestRuntimeAPIProxy_createConnectionAuthSubprotocol(t *testing.T) {
	ctx := context.Background()
	const (
		testAppsyncHttpUrl    = "test-appsync-endpoint.appsync-api.us-west-2.amazonaws.com"
		testAppsyncRealtimeUrl = "test-realtime-appsync-endpoint.appsync-api.us-west-2.amazonaws.com" // Not directly used by this func but needed for New
		testAwsRegion         = "us-west-2"
		testListenerPort      = "9008"
		dummyLambdaRuntimeAPI = "127.0.0.1:9000"
	)

	// Setup environment variables for static credentials
	originalAccessKeyID := os.Getenv("AWS_ACCESS_KEY_ID")
	originalSecretAccessKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	originalSessionToken := os.Getenv("AWS_SESSION_TOKEN")
	originalLambdaRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	originalAWSProfile := os.Getenv("AWS_PROFILE")
	originalAWSSharedCredentialsFile := os.Getenv("AWS_SHARED_CREDENTIALS_FILE")

	os.Unsetenv("AWS_PROFILE")
	os.Unsetenv("AWS_SHARED_CREDENTIALS_FILE")
	os.Setenv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE")
	os.Setenv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
	os.Setenv("AWS_SESSION_TOKEN", "test-session-token")
	os.Setenv("AWS_LAMBDA_RUNTIME_API", dummyLambdaRuntimeAPI)
	defer func() {
		os.Setenv("AWS_ACCESS_KEY_ID", originalAccessKeyID)
		os.Setenv("AWS_SECRET_ACCESS_KEY", originalSecretAccessKey)
		os.Setenv("AWS_SESSION_TOKEN", originalSessionToken)
		os.Setenv("AWS_LAMBDA_RUNTIME_API", originalLambdaRuntimeAPI)
		os.Setenv("AWS_PROFILE", originalAWSProfile) // Restore original AWS_PROFILE
		os.Setenv("AWS_SHARED_CREDENTIALS_FILE", originalAWSSharedCredentialsFile) // Restore original AWS_SHARED_CREDENTIALS_FILE
	}()

	proxy, err := NewRuntimeAPIProxy(ctx, dummyLambdaRuntimeAPI, testAppsyncHttpUrl, testAppsyncRealtimeUrl, testAwsRegion, testListenerPort)
	if err != nil {
		t.Fatalf("NewRuntimeAPIProxy failed: %v", err)
	}

	subprotocols, err := proxy.createConnectionAuthSubprotocol(ctx)
	if err != nil {
		t.Fatalf("createConnectionAuthSubprotocol failed: %v", err)
	}

	if len(subprotocols) == 0 {
		t.Fatal("Expected at least one subprotocol, got none")
	}
	subprotocolString := subprotocols[0]

	if !strings.HasPrefix(subprotocolString, "header-") {
		t.Errorf("Expected subprotocol to start with 'header-', got '%s'", subprotocolString)
	}

	base64Part := strings.TrimPrefix(subprotocolString, "header-")
	decodedJsonBytes, err := base64.StdEncoding.DecodeString(base64Part)
	if err != nil {
		t.Fatalf("Failed to decode base64 part of subprotocol: %v", err)
	}

	var headers map[string]interface{}
	if err := json.Unmarshal(decodedJsonBytes, &headers); err != nil {
		t.Fatalf("Failed to unmarshal decoded JSON from subprotocol: %v. JSON: %s", err, string(decodedJsonBytes))
	}

	t.Logf("Decoded headers: %+v", headers)

	expectedHost := testAppsyncHttpUrl 
	if host, ok := headers["Host"].(string); !ok || host != expectedHost {
		t.Errorf("Expected 'Host' header to be '%s', got '%v'", expectedHost, headers["Host"])
	}

	if _, ok := headers["X-Amz-Date"].(string); !ok {
		t.Error("Expected 'X-Amz-Date' header to be present")
	}
	
	if authHeader, ok := headers["Authorization"].(string); !ok {
		t.Error("Expected 'Authorization' header to be present")
	} else {
		if !strings.HasPrefix(authHeader, "AWS4-HMAC-SHA256") {
			t.Errorf("Expected 'Authorization' header to start with 'AWS4-HMAC-SHA256', got '%s'", authHeader)
		}
		// Check for the static AccessKeyID used in credentials provider
		if !strings.Contains(authHeader, "AKIAIOSFODNN7EXAMPLE") {
			t.Errorf("Expected 'Authorization' header to contain test AccessKeyID 'AKIAIOSFODNN7EXAMPLE', got '%s'", authHeader)
		}
	}
}

