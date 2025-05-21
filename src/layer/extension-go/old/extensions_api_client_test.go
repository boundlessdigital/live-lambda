package main

import (
	"context" // Added
	"encoding/json" // Added
	"net/http" // Added
	"net/http/httptest" // Added
	"os"
	"testing"
	"time"
)

func TestNewExtensionsAPIClient(t *testing.T) {
	// Note: AWS_LAMBDA_RUNTIME_API is used by methods of the client, not directly stored as baseURL
	// So, NewExtensionsAPIClient itself doesn't change much based on it, other than being available for methods.
	// We are primarily testing the correct initialization of the httpClient here.

	client := NewExtensionsAPIClient()

	if client == nil {
		t.Fatal("NewExtensionsAPIClient() returned nil, expected a client")
	}

	if client.httpClient == nil {
		t.Fatal("Expected httpClient to be initialized, but it was nil")
	}

	expectedTimeout := 10 * time.Second
	if client.httpClient.Timeout != expectedTimeout {
		t.Errorf("Expected httpClient timeout %v, got %v", expectedTimeout, client.httpClient.Timeout)
	}
}

func TestExtensionsAPIClient_Register(t *testing.T) {
	extensionName := "test-extension"
	originalExtensionName := os.Getenv("AWS_LAMBDA_EXTENSION_NAME")
	os.Setenv("AWS_LAMBDA_EXTENSION_NAME", extensionName)
	defer os.Setenv("AWS_LAMBDA_EXTENSION_NAME", originalExtensionName)

	ctx := context.Background()

	t.Run("Successful registration", func(t *testing.T) {
		expectedExtensionID := "test-ext-id-123"
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("Expected POST request, got %s", r.Method)
			}
			if r.URL.Path != "/2020-01-01/extension/register" {
				t.Errorf("Expected path /2020-01-01/extension/register, got %s", r.URL.Path)
			}

			// Check header
			gotExtensionName := r.Header.Get("Lambda-Extension-Name")
			if gotExtensionName != extensionName {
				t.Errorf("Expected Lambda-Extension-Name header '%s', got '%s'", extensionName, gotExtensionName)
			}

			// Check body
			var body map[string][]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("Failed to decode request body: %v", err)
			}
			if _, ok := body["events"]; !ok {
				t.Error("Request body missing 'events' key")
			} else {
				if len(body["events"]) != 2 || body["events"][0] != "INVOKE" || body["events"][1] != "SHUTDOWN" {
					t.Errorf("Expected events ['INVOKE', 'SHUTDOWN'], got %v", body["events"])
				}
			}

			w.Header().Set("Lambda-Extension-Identifier", expectedExtensionID)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		// Temporarily set AWS_LAMBDA_RUNTIME_API to our mock server's URL
		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", server.URL[7:]) // Remove "http://" prefix
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		client := NewExtensionsAPIClient()
		_, err := client.Register(ctx)

		if err != nil {
			t.Fatalf("Register() failed: %v", err)
		}
		if client.extensionID != expectedExtensionID {
			t.Errorf("Expected extensionID '%s', got '%s'", expectedExtensionID, client.extensionID)
		}
	})

	t.Run("Registration failure from API", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("Internal Server Error"))
		}))
		defer server.Close()

		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", server.URL[7:]) // Remove "http://" prefix
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		client := NewExtensionsAPIClient()
		_, err := client.Register(ctx)

		if err == nil {
			t.Fatal("Register() expected to fail, but it succeeded")
		}
		// We could also check the error message if desired.
		// Example: if !strings.Contains(err.Error(), "unexpected status code 500") { ... }
	})

	t.Run("Registration fails if AWS_LAMBDA_EXTENSION_NAME is not set", func(t *testing.T) {
		// Unset AWS_LAMBDA_EXTENSION_NAME for this sub-test
		currentExtName := os.Getenv("AWS_LAMBDA_EXTENSION_NAME")
		os.Unsetenv("AWS_LAMBDA_EXTENSION_NAME")
		defer os.Setenv("AWS_LAMBDA_EXTENSION_NAME", currentExtName)


		// No server needed as it should fail before making a request
		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", "localhost:9999") // Dummy value
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)


		client := NewExtensionsAPIClient()
		_, err := client.Register(ctx)

		if err == nil {
			t.Fatal("Register() expected to fail due to missing AWS_LAMBDA_EXTENSION_NAME, but it succeeded")
		}
		// Check if the error message indicates missing extension name
		// This depends on the actual error returned by client.Register
		// For example: if !strings.Contains(err.Error(), "AWS_LAMBDA_EXTENSION_NAME not set") { ... }
	})
}

func TestExtensionsAPIClient_NextEvent(t *testing.T) {
	ctx := context.Background()
	mockExtensionID := "test-ext-id-for-next-event"

	t.Run("Successful INVOKE event retrieval", func(t *testing.T) {
		expectedEvent := ExtensionEvent{
			EventType:          "INVOKE",
			DeadlineMs:         1234567890,
			RequestID:          "invoke-req-id-1",
			InvokedFunctionARN: "arn:aws:lambda:us-east-1:123456789012:function:test-func",
			// Tracing field removed as it's commented out in the main struct definition
		}

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				t.Errorf("Expected GET request, got %s", r.Method)
			}
			if r.URL.Path != "/2020-01-01/extension/event/next" {
				t.Errorf("Expected path /2020-01-01/extension/event/next, got %s", r.URL.Path)
			}
			if r.Header.Get("Lambda-Extension-Identifier") != mockExtensionID {
				t.Errorf("Expected Lambda-Extension-Identifier '%s', got '%s'", mockExtensionID, r.Header.Get("Lambda-Extension-Identifier"))
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(expectedEvent); err != nil {
				t.Fatalf("Failed to encode event: %v", err)
			}
		}))
		defer server.Close()

		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", server.URL[7:]) // Remove "http://"
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		client := NewExtensionsAPIClient()
		client.extensionID = mockExtensionID // Manually set for this test

		event, err := client.NextEvent(ctx)
		if err != nil {
			t.Fatalf("NextEvent() failed: %v", err)
		}
		if event == nil {
			t.Fatal("NextEvent() returned nil event, expected an event")
		}
		if event.EventType != expectedEvent.EventType || event.RequestID != expectedEvent.RequestID {
			t.Errorf("Mismatch in event details. Got %+v, expected %+v", event, expectedEvent)
		}
	})

	t.Run("Successful SHUTDOWN event retrieval", func(t *testing.T) {
		expectedEvent := ExtensionEvent{
			EventType:  "SHUTDOWN",
			DeadlineMs: 9876543210,
			ShutdownReason: "timeout",
		}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Basic checks, similar to INVOKE
			if r.Header.Get("Lambda-Extension-Identifier") != mockExtensionID {
				t.Errorf("Missing/wrong Lambda-Extension-Identifier")
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(expectedEvent)
		}))
		defer server.Close()
		
		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", server.URL[7:])
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		client := NewExtensionsAPIClient()
		client.extensionID = mockExtensionID

		event, err := client.NextEvent(ctx)
		if err != nil {
			t.Fatalf("NextEvent() for SHUTDOWN failed: %v", err)
		}
		if event.EventType != "SHUTDOWN" || event.ShutdownReason != "timeout" {
			t.Errorf("Mismatch in SHUTDOWN event details. Got %+v", event)
		}
	})
	
	t.Run("API returns an error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", server.URL[7:])
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		client := NewExtensionsAPIClient()
		client.extensionID = mockExtensionID 

		_, err := client.NextEvent(ctx)
		if err == nil {
			t.Fatal("NextEvent() expected to fail due to API error, but it succeeded")
		}
	})

	t.Run("Called without registration (empty extensionID)", func(t *testing.T) {
		client := NewExtensionsAPIClient() // extensionID will be empty
		
		// No server needed as it should fail before making a request
		originalRuntimeAPI := os.Getenv("AWS_LAMBDA_RUNTIME_API")
		os.Setenv("AWS_LAMBDA_RUNTIME_API", "localhost:9999") // Dummy value
		defer os.Setenv("AWS_LAMBDA_RUNTIME_API", originalRuntimeAPI)

		_, err := client.NextEvent(ctx)
		if err == nil {
			t.Fatal("NextEvent() expected to fail due to empty extensionID, but it succeeded")
		}
		// Optionally check error message:
		// if !strings.Contains(err.Error(), "extension not registered") {
		// 	t.Errorf("Expected error about not being registered, got: %v", err)
		// }
	})
}
