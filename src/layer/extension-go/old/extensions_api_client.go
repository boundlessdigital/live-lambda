package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

const (
	extAPIClientVersion                = "2020-01-01"
	extAPIClientContentTypeHeader      = "Content-Type"
	extAPIClientJsonContentType        = "application/json"
	extAPIClientExtensionNameHeader    = "Lambda-Extension-Name"
	extAPIClientExtensionNameEnvVar   = "AWS_LAMBDA_EXTENSION_NAME"
	extAPIClientExtensionIdentiferHeader = "Lambda-Extension-Identifier"
	extAPIClientErrorResponseType     = "application/vnd.aws.lambda.error+json"

	// Event Types
	InvokeEventType   = "INVOKE"
	ShutdownEventType = "SHUTDOWN"
)

func getLambdaExtensionsAPIEndpoint() string {
	runtimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
	if runtimeAPI == "" {
		log.Fatal("AWS_LAMBDA_RUNTIME_API environment variable not set") // Critical error
	}
	return fmt.Sprintf("http://%s/2020-01-01/extension", runtimeAPI)
}

type ExtensionEvent struct {
	EventType          string `json:"eventType"`
	DeadlineMs         int64  `json:"deadlineMs"`
	RequestID          string `json:"requestId,omitempty"`
	InvokedFunctionARN string `json:"invokedFunctionArn,omitempty"`
	ShutdownReason     string `json:"shutdownReason,omitempty"`
	// Tracing          map[string]string `json:"tracing,omitempty"` // Example if tracing object is needed
}

type ExtensionsAPIClient struct {
	extensionID string
	httpClient  *http.Client // Client for registration and other short-lived requests
}

func NewExtensionsAPIClient() *ExtensionsAPIClient {
	return &ExtensionsAPIClient{
		httpClient: &http.Client{Timeout: 10 * time.Second}, // Timeout for non-event polling requests
	}
}

func (c *ExtensionsAPIClient) Register(ctx context.Context) (string, error) {
	log.Println("[ExtensionsAPIClient] Registering...")

	extensionName := os.Getenv(extAPIClientExtensionNameEnvVar)
	if extensionName == "" {
		return "", fmt.Errorf("%s environment variable not set", extAPIClientExtensionNameEnvVar)
	}

	url := getLambdaExtensionsAPIEndpoint() + "/register"

	payload := map[string][]string{
		"events": {InvokeEventType, ShutdownEventType},
	}
	log.Printf("[ExtensionsAPIClient] Registering for events: %v", payload["events"]) // Updated log
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal register payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return "", fmt.Errorf("failed to create register request: %w", err)
	}
	req.Header.Set(extAPIClientContentTypeHeader, extAPIClientJsonContentType)
	req.Header.Set(extAPIClientExtensionNameHeader, extensionName)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("register request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("register request failed with status %s: %s", resp.Status, string(bodyBytes))
	}

	extensionID := resp.Header.Get(extAPIClientExtensionIdentiferHeader)
	if extensionID == "" {
		return "", fmt.Errorf("Lambda-Extension-Identifier header not found in register response")
	}
	c.extensionID = extensionID
	log.Printf("[ExtensionsAPIClient] Registered successfully with ID: %s", c.extensionID)
	return c.extensionID, nil
}

func (c *ExtensionsAPIClient) NextEvent(ctx context.Context) (*ExtensionEvent, error) {
	if c.extensionID == "" {
		return nil, fmt.Errorf("extension not registered, cannot call nextEvent")
	}

	url := getLambdaExtensionsAPIEndpoint() + "/event/next"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create nextEvent request: %w", err)
	}
	req.Header.Set(extAPIClientExtensionIdentiferHeader, c.extensionID)

	// Use a client with no timeout for long polling, but respect the context for cancellation
	longPollClient := &http.Client{Timeout: 0} 
	resp, err := longPollClient.Do(req)
	if err != nil {
		if ctx.Err() != nil { // Check if context was cancelled
			return nil, fmt.Errorf("nextEvent context cancelled: %w", ctx.Err())
		}
		return nil, fmt.Errorf("nextEvent request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		if ctx.Err() != nil {
			return nil, fmt.Errorf("nextEvent context cancelled, received status %s: %s", resp.Status, string(bodyBytes))
		}
		return nil, fmt.Errorf("nextEvent request failed with status %s: %s", resp.Status, string(bodyBytes))
	}

	var event ExtensionEvent
	if err := json.NewDecoder(resp.Body).Decode(&event); err != nil {
		return nil, fmt.Errorf("failed to decode nextEvent response: %w", err)
	}
	return &event, nil
}

func (c *ExtensionsAPIClient) BootstrapAndRunEventLoop(ctx context.Context, runtimeProxy *RuntimeAPIProxy) error {
	extID, err := c.Register(ctx)
	if err != nil {
		return fmt.Errorf("bootstrap: failed to register: %w", err)
	}
	c.extensionID = extID

	for {
		select {
		case <-ctx.Done():
			log.Println("[ExtensionsAPIClient] Context done, exiting event loop.")
			return ctx.Err()
		default:
			// Proceed to call nextEvent
		}

		log.Println("[ExtensionsAPIClient] Waiting for next event...")
		event, err := c.NextEvent(ctx)
		if err != nil {
			if ctx.Err() != nil { // Check if context was cancelled during nextEvent
				log.Printf("[ExtensionsAPIClient] Context cancelled while waiting for next event: %v", ctx.Err())
				return ctx.Err() // Exit loop if context is done
			}
			log.Printf("[ExtensionsAPIClient] CRITICAL: Error from nextEvent: %v. Error type: %T. Context error: %v. Retrying in 1s...", err, err, ctx.Err())
			time.Sleep(1 * time.Second) // Simple retry delay
			continue                    // Retry fetching next event
		}

		log.Printf("[ExtensionsAPIClient] Received event: Type=%s, RequestID=%s, ShutdownReason=%s, DeadlineMs=%d, InvokedFunctionArn=%s", 
			event.EventType, event.RequestID, event.ShutdownReason, event.DeadlineMs, event.InvokedFunctionARN)

		if event.EventType == ShutdownEventType {
			log.Printf("[ExtensionsAPIClient] Received SHUTDOWN event. Reason: '%s'. Exiting event loop normally.", event.ShutdownReason)
			return nil // Normal exit for SHUTDOWN
		}

		// For INVOKE events, the RuntimeAPIProxy handles the core logic. 
		// Additional actions for INVOKE can be added here if needed.
		log.Printf("[ExtensionsAPIClient] Successfully processed %s event for Request ID: %s. Looping back for next event.", event.EventType, event.RequestID)
		// Ensure we are not immediately exiting after an INVOKE due to an unexpected condition
	}
}
