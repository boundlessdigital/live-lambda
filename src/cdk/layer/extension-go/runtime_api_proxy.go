// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Read about Lambda Runtime API here
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	http_proxy_print_prefix = "[Runtime API Proxy]"
	maxLambdaTimeout        = 15 * time.Minute // 15 minutes in Go's time.Duration
	safetyBuffer            = 30 * time.Second // Buffer for cleanup and processing
	websocketTimeout        = maxLambdaTimeout - safetyBuffer
)

var (
	aws_lambda_runtime_api string
	http_client            = &http.Client{}
	// AppSyncProxyHelper and SetAppSyncHelper are removed as RuntimeAPIProxy methods now handle AppSync directly.
)

func (p *RuntimeAPIProxy) handle_next(w http.ResponseWriter, r *http.Request) {
	log.Println(http_proxy_print_prefix, "GET /next")

	// 1. Forward the request to the Lambda Runtime API
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/next", aws_lambda_runtime_api)
	resp, err := p.forward_request("GET", url, r.Body, r.Header)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error forwarding /next request: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// 2. Read the response body
	body_bytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading /next response body: %v", err), http.StatusInternalServerError)
		return
	}

	// 3. Get the request ID from the headers
	request_id := resp.Header.Get("Lambda-Runtime-Aws-Request-Id")
	if request_id == "" {
		log.Printf("%s Warning: No request ID found in headers", http_proxy_print_prefix)
	}

	// 4. Check if we should use AppSync
	if p.appsync_ws_client != nil && p.appsync_ws_client.IsConnected() && request_id != "" {
		// Create a context with our timeout
		ctx, cancel := context.WithTimeout(r.Context(), websocketTimeout)
		defer cancel()

		// Create a channel to signal when we're done
		done := make(chan struct{})
		response_topic := fmt.Sprintf("live-lambda/response/%s", request_id)
		sub_id := fmt.Sprintf("sub-%s", request_id)
		
		// Cleanup function
		cleanup := func() {
			if p.appsync_ws_client != nil && p.appsync_ws_client.IsConnected() {
				// Use a separate context with a short timeout for cleanup
				_, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second) // cleanupCtx assigned to _ as it's not used after Unsubscribe was commented out
				defer cleanupCancel()
				// p.appsync_ws_client.Unsubscribe(cleanupCtx, sub_id, response_topic) // Commented out due to build error: Unsubscribe undefined (type *appsyncwsclient.Client has no field or method Unsubscribe)
				// Subscription cleanup will rely on the cancellation of the context passed to the Subscribe call (appsyncOpCtx).
				log.Printf("%s AppSync Unsubscribe call commented out. Cleanup for sub_id %s on topic %s relies on context cancellation.", http_proxy_print_prefix, sub_id, response_topic)
			}
		}
		defer cleanup()

		// 5. Subscribe to the response topic
		subConfirmation, err := p.appsync_ws_client.Subscribe(
			ctx,
			response_topic, // Use response_topic as the identifier
			// This function will be called when a message is received
			func(data_payload interface{}) {
				log.Printf("%s Received message on topic %s", http_proxy_print_prefix, response_topic)
				
				// Convert the response to bytes
				response_bytes, err := json.Marshal(data_payload)
				if err != nil {
					log.Printf("%s Error marshaling WebSocket response: %v", http_proxy_print_prefix, err)
					close(done)
					return
				}

				// Log the raw response for debugging
				log.Printf("%s Raw WebSocket response: %s", http_proxy_print_prefix, string(response_bytes))

				// Create a reader for the response body
				body_reader := bytes.NewReader(response_bytes)
				
				// Post the response back to the Runtime API
				response_url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/%s/response", 
					aws_lambda_runtime_api, request_id)
				
				log.Printf("%s Posting response back to Lambda Runtime API: %s", 
					http_proxy_print_prefix, response_url)
				
				// Use forward_request to post the response
				resp, err := p.forward_request("POST", response_url, body_reader, nil)
				if err != nil {
					log.Printf("%s Error posting response to Lambda Runtime API: %v", 
						http_proxy_print_prefix, err)
					close(done)
					return
				}
				defer resp.Body.Close()
				
				// Log the response status
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					log.Printf("%s Successfully posted response for request ID %s", 
						http_proxy_print_prefix, request_id)
				} else {
					body, _ := io.ReadAll(resp.Body)
					log.Printf("%s Error response from Lambda Runtime API: %d - %s", 
						http_proxy_print_prefix, resp.StatusCode, string(body))
				}
				
				// Signal that we're done
				close(done)
			},
		)
		
		if err != nil {
			log.Printf("%s Error subscribing to topic %s: %v", http_proxy_print_prefix, response_topic, err)
			// Continue to normal processing if subscription fails
		} else {
			log.Printf("%s Successfully subscribed to topic %s. Confirmation: %v", http_proxy_print_prefix, response_topic, subConfirmation)
			// 6. Publish the request to AppSync
			publish_topic := "live-lambda/requests"

			// Gather Lambda context information
            context_data := map[string]interface{}{
                "invoked_function_arn": resp.Header.Get("Lambda-Runtime-Invoked-Function-Arn"),
                "deadline_ms":          resp.Header.Get("Lambda-Runtime-Deadline-Ms"),
                "trace_id":             resp.Header.Get("Lambda-Runtime-Trace-Id"),
                "function_name":        os.Getenv("AWS_LAMBDA_FUNCTION_NAME"),
                "function_version":     os.Getenv("AWS_LAMBDA_FUNCTION_VERSION"),
                "memory_size_mb":       os.Getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"),
                "log_group_name":       os.Getenv("AWS_LAMBDA_LOG_GROUP_NAME"),
                "log_stream_name":      os.Getenv("AWS_LAMBDA_LOG_STREAM_NAME"),
                "aws_region":           os.Getenv("AWS_REGION"),
                "request_id":           request_id,
            }

            // Parse and add Cognito identity if present
            cognito_identity_str := resp.Header.Get("Lambda-Runtime-Cognito-Identity")
            if cognito_identity_str != "" {
                var parsed_cognito_identity map[string]interface{}
                if err := json.Unmarshal([]byte(cognito_identity_str), &parsed_cognito_identity); err == nil {
                    context_data["identity"] = parsed_cognito_identity
                } else {
                    log.Printf("%s Warning: Failed to unmarshal Lambda-Runtime-Cognito-Identity: %v", http_proxy_print_prefix, err)
                }
            }

            // Parse and add client context if present
            client_context_b64_str := resp.Header.Get("Lambda-Runtime-Client-Context")
            if client_context_b64_str != "" {
                decoded_client_context_bytes, err := base64.StdEncoding.DecodeString(client_context_b64_str)
                if err == nil {
                    var parsed_client_context map[string]interface{}
                    if err := json.Unmarshal(decoded_client_context_bytes, &parsed_client_context); err == nil {
                        context_data["client_context"] = parsed_client_context
                    } else {
                        log.Printf("%s Warning: Failed to unmarshal decoded Lambda-Runtime-Client-Context: %v", http_proxy_print_prefix, err)
                    }
                } else {
                    log.Printf("%s Warning: Failed to base64 decode Lambda-Runtime-Client-Context: %v", http_proxy_print_prefix, err)
                }
            }

            payload := map[string]interface{}{
                "request_id":    request_id,
                "event_payload": json.RawMessage(body_bytes),
                "context":       context_data, // Renamed from lambda_context
            }
            
            payload_bytes, _ := json.Marshal(payload)
            
            log.Printf("%s Publishing to AppSync topic %s: %s", 
                http_proxy_print_prefix, publish_topic, string(payload_bytes))
            
            if err := p.appsync_ws_client.Publish(ctx, publish_topic, []interface{}{payload}); err != nil {
                log.Printf("%s Error publishing to AppSync: %v", http_proxy_print_prefix, err)
                // Continue to normal processing if publish fails
            } else {
                log.Printf("%s Successfully published to AppSync topic %s", 
                    http_proxy_print_prefix, publish_topic)
                
                // 7. Wait for the response (with timeout)
                select {
                case <-done:
                    // Response was received and processed
                    return
                    
                case <-time.After(websocketTimeout):
                    log.Printf("%s Timeout waiting for response from AppSync (reached %.0f second timeout)", 
                        http_proxy_print_prefix, websocketTimeout.Seconds())
                    // Continue to normal processing
                }
            }
        }
    }

    // 8. If we get here, either we're not using AppSync or there was an error
    // Just return the original Lambda response
    modified_body, modified_headers := process_request(r.Context(), request_id, body_bytes, resp.Header)
    copy_headers(modified_headers, w.Header())
    w.WriteHeader(resp.StatusCode)
    if _, err := w.Write(modified_body); err != nil {
        log.Printf("%s Error writing response: %v", http_proxy_print_prefix, err)
    }
}

func (p *RuntimeAPIProxy) handle_response(w http.ResponseWriter, r *http.Request) {
	request_id := chi.URLParam(r, "requestId")
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/%s/response", aws_lambda_runtime_api, request_id)
	log.Println(http_proxy_print_prefix, "POST", url)

	p.forward_and_respond(w, "POST", url, r.Body, r.Header)
}

func (p *RuntimeAPIProxy) handle_init_error(w http.ResponseWriter, r *http.Request) {
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/init/error", aws_lambda_runtime_api)
	log.Println(http_proxy_print_prefix, "POST", url)
	p.forward_and_respond(w, "POST", url, r.Body, r.Header)
}

func (p *RuntimeAPIProxy) handle_invoke_error(w http.ResponseWriter, r *http.Request) {
	request_id := chi.URLParam(r, "requestId")
	log.Println(http_proxy_print_prefix, "POST /invoke/error for requestID:", request_id)
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/%s/error", aws_lambda_runtime_api, request_id)
	p.forward_and_respond(w, "POST", url, r.Body, r.Header)
}

func (p *RuntimeAPIProxy) handle_exit_error(w http.ResponseWriter, r *http.Request) {
	log.Printf("%s Path or Protocol Error: %s %s", http_proxy_print_prefix, r.Method, r.URL.Path)
	http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
}

func StartProxy(proxy_instance *RuntimeAPIProxy, actual_runtime_api string, port int) {
	log.Println(http_proxy_print_prefix, "Starting proxy server on port", port, "targeting", actual_runtime_api)
	aws_lambda_runtime_api = actual_runtime_api

	r := chi.NewRouter()
	r.Use(simple_logger)

	// Lambda Runtime API endpoints
	r.HandleFunc("/2018-06-01/runtime/invocation/next", proxy_instance.handle_next)
	r.HandleFunc("/2018-06-01/runtime/invocation/{requestId}/response", proxy_instance.handle_response)
	r.HandleFunc("/2018-06-01/runtime/invocation/{requestId}/error", proxy_instance.handle_invoke_error)
	r.HandleFunc("/2018-06-01/runtime/init/error", proxy_instance.handle_init_error)

	r.NotFound(handle_error)
	r.MethodNotAllowed(handle_error)

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: r,
	}

	go func() {
		err := server.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			log.Printf("%s proxy server ListenAndServe error: %v", http_proxy_print_prefix, err)
		}
		log.Println(http_proxy_print_prefix, "Proxy server goroutine finished.")
	}()
	log.Println(http_proxy_print_prefix, "Proxy Server Started")
}

func (p *RuntimeAPIProxy) forward_and_respond(w http.ResponseWriter, method string, url string, body io.ReadCloser, headers http.Header) {
	resp, err := p.forward_request(method, url, body, headers)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error forwarding %s request to %s: %v", method, url, err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	resp_body_bytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading response body from %s: %v", url, err), http.StatusInternalServerError)
		return
	}

	copy_headers(resp.Header, w.Header())
	w.WriteHeader(resp.StatusCode)
	_, err = w.Write(resp_body_bytes)
	if err != nil {
		log.Printf("%s Error writing response to client: %v", http_proxy_print_prefix, err)
	}
}

func handle_error(w http.ResponseWriter, r *http.Request) {
	log.Printf("%s Path or Protocol Error: %s %s", http_proxy_print_prefix, r.Method, r.URL.Path)
	http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
}

func copy_headers(source http.Header, dest http.Header) {
	for key, values := range source {
		dest[key] = values
	}
}

func (p *RuntimeAPIProxy) forward_request(method string, url string, body io.Reader, headers http.Header) (*http.Response, error) { // MODIFIED
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		log.Printf("%s Error creating %s request to %s: %v", http_proxy_print_prefix, method, url, err)
		return nil, err
	}
	copy_headers(headers, req.Header) // MODIFIED

	// Ensure Host header is set correctly if it's being proxied.
	// For Lambda Runtime API, it's a local endpoint, so default behavior is likely fine.

	resp, err := http_client.Do(req)
	if err != nil {
		log.Printf("%s Error sending %s request to %s: %v", http_proxy_print_prefix, method, url, err)
		return nil, err
	}
	return resp, nil
}

func simple_logger(next http.Handler) http.Handler { // MODIFIED
	fn := func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s %s", http_proxy_print_prefix, r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}

// process_request can modify the request body or headers before sending to the Runtime API (for /next)
// or before sending back to the function (if we were proxying the other way).
// For /next, this is modifying the response *from* the Runtime API *before* it goes to the function.
func process_request(ctx context.Context, request_id string, body []byte, headers http.Header) ([]byte, http.Header) { // MODIFIED
	log.Printf("%s process_request for requestID: %s", http_proxy_print_prefix, request_id)
	// AppSync subscription logic is now part of p.handle_next, called after this response is sent to the function.
	// No AppSyncProxyHelper call needed here anymore.

	// Example modification (from sample)
	json_body, err := unmarshal_body(body) // MODIFIED
	if err == nil {
		new_body, marshal_err := json.Marshal(json_body) // MODIFIED
		if marshal_err == nil {
			return new_body, headers
		}
		log.Printf("%s Error marshalling modified request body: %v", http_proxy_print_prefix, marshal_err)
	}
	return body, headers // Return original on error
}

// process_response can modify the response body or headers from the function before sending to the Runtime API.
func process_response(ctx context.Context, request_id string, body []byte, headers http.Header) ([]byte, http.Header) { // MODIFIED
	log.Printf("%s process_response for requestID: %s", http_proxy_print_prefix, request_id)
	// AppSync publishing logic for responses (if needed in the future) would be added here or in a dedicated method.
	// No AppSyncProxyHelper call needed here anymore.

	// Example modification (from sample)
	json_body, err := unmarshal_body(body) // MODIFIED
	if err == nil {
		new_body, marshal_err := json.Marshal(json_body) // MODIFIED
		if marshal_err == nil {
			return new_body, headers
		}
		log.Printf("%s Error marshalling modified response body: %v", http_proxy_print_prefix, marshal_err)
	}
	return body, headers // Return original on error
}

func unmarshal_body(body []byte) (map[string]interface{}, error) { // MODIFIED
	var temp = make(map[string]interface{})
	err := json.Unmarshal(body, &temp)
	if err != nil {
		// It's common for response bodies to not be JSON, so don't be too noisy.
		// log.Printf("%s failed to unmarshal response body: %v", http_proxy_print_prefix, err)
		return nil, err
	}
	return temp, nil
}
