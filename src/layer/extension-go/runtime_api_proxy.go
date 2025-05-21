// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Read about Lambda Runtime API here
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html

package main // MODIFIED

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
)

const (
	// Renamed from printPrefix to avoid conflict if another file uses the same name
	// and to make it specific to this file's context.
	http_proxy_print_prefix     = "[LiveLambdaProxy:Handlers]" // MODIFIED
)

var (
	aws_lambda_runtime_api string // MODIFIED
	http_client = &http.Client{} // MODIFIED
	// This will be set by main.go to the instance of our RuntimeAPIProxy
	// allowing AppSync interactions from proxy handlers.
	// Interface name and its methods remain PascalCase as per Go conventions for exported interfaces.
	AppSyncProxyHelper interface {
		HandleAppSyncSubscriptionForRequest(ctx context.Context, request_id string) // MODIFIED param
		HandleAppSyncPublishForResponse(ctx context.Context, request_id string, response_body []byte) // MODIFIED params
	}
)

// SetAppSyncHelper allows main to inject the AppSync interaction logic.
// Function name remains PascalCase as it's exported.
// Parameter 'helper' changed to snake_case.
func SetAppSyncHelper(appsync_helper interface{ // MODIFIED param
	HandleAppSyncSubscriptionForRequest(ctx context.Context, request_id string) // MODIFIED param
	HandleAppSyncPublishForResponse(ctx context.Context, request_id string, response_body []byte) // MODIFIED params
}) {
	AppSyncProxyHelper = appsync_helper
}

// StartProxy initializes and starts the HTTP proxy server.
// Function name remains PascalCase as it's exported.
// Parameters changed to snake_case.
func StartProxy(actual_runtime_api string, port int) { // MODIFIED params
	log.Println(http_proxy_print_prefix, "Starting proxy server on port", port, "targeting", actual_runtime_api)
	aws_lambda_runtime_api = actual_runtime_api

	r := chi.NewRouter()
	r.Use(simple_logger) // MODIFIED

	// Lambda Runtime API endpoints
	r.Get("/2018-06-01/runtime/invocation/next", handle_next) // MODIFIED
	r.Post("/2018-06-01/runtime/invocation/{requestId}/response", handle_response) // MODIFIED
	r.Post("/2018-06-01/runtime/init/error", handle_init_error) // MODIFIED
	r.Post("/2018-06-01/runtime/invocation/{requestId}/error", handle_invoke_error) // MODIFIED

	r.NotFound(handle_error) // MODIFIED
	r.MethodNotAllowed(handle_error) // MODIFIED

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

// Non-exported functions changed to snake_case.
func handle_next(w http.ResponseWriter, r *http.Request) { // MODIFIED
	log.Println(http_proxy_print_prefix, "GET /next")

	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/next", aws_lambda_runtime_api)

	resp, err := forward_request("GET", url, r.Body, r.Header) // MODIFIED
	if err != nil {
		http.Error(w, fmt.Sprintf("Error forwarding /next request: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	body_bytes, err := io.ReadAll(resp.Body) // MODIFIED
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading /next response body: %v", err), http.StatusInternalServerError)
		return
	}

	// Extract request ID for AppSync interactions
	request_id := resp.Header.Get("Lambda-Runtime-Aws-Request-Id") // MODIFIED

	modified_body, modified_headers := process_request(r.Context(), request_id, body_bytes, resp.Header) // MODIFIED

	copy_headers(modified_headers, w.Header()) // MODIFIED
	w.WriteHeader(resp.StatusCode)
	_, err = w.Write(modified_body)
	if err != nil {
		log.Printf("%s Error writing /next response to client: %v", http_proxy_print_prefix, err)
	}
	log.Println(http_proxy_print_prefix, "GET /next completed")
}

func handle_response(w http.ResponseWriter, r *http.Request) { // MODIFIED
	request_id := chi.URLParam(r, "requestId") // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /response for requestID:", request_id)

	body_bytes, err := io.ReadAll(r.Body) // MODIFIED
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading /response request body: %v", err), http.StatusBadRequest)
		return
	}

	modified_body, modified_headers := process_response(r.Context(), request_id, body_bytes, r.Header) // MODIFIED

	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/%s/response", aws_lambda_runtime_api, request_id)
	body_buffer := io.NopCloser(bytes.NewReader(modified_body)) // MODIFIED

	forward_and_respond(w, "POST", url, body_buffer, modified_headers) // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /response completed for requestID:", request_id)
}

func handle_init_error(w http.ResponseWriter, r *http.Request) { // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /init/error")
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/init/error", aws_lambda_runtime_api)
	forward_and_respond(w, "POST", url, r.Body, r.Header) // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /init/error completed")
}

func handle_invoke_error(w http.ResponseWriter, r *http.Request) { // MODIFIED
	request_id := chi.URLParam(r, "requestId") // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /invoke/error for requestID:", request_id)
	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/%s/error", aws_lambda_runtime_api, request_id)
	forward_and_respond(w, "POST", url, r.Body, r.Header) // MODIFIED
	log.Println(http_proxy_print_prefix, "POST /invoke/error completed for requestID:", request_id)
}

func forward_and_respond(w http.ResponseWriter, method string, url string, body io.ReadCloser, headers http.Header) { // MODIFIED
	resp, err := forward_request(method, url, body, headers) // MODIFIED
	if err != nil {
		http.Error(w, fmt.Sprintf("Error forwarding %s request to %s: %v", method, url, err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	resp_body_bytes, err := io.ReadAll(resp.Body) // MODIFIED
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading response body from %s: %v", url, err), http.StatusInternalServerError)
		return
	}

	copy_headers(resp.Header, w.Header()) // MODIFIED
	w.WriteHeader(resp.StatusCode)
	_, err = w.Write(resp_body_bytes)
	if err != nil {
		log.Printf("%s Error writing response to client: %v", http_proxy_print_prefix, err)
	}
}

func handle_error(w http.ResponseWriter, r *http.Request) { // MODIFIED
	log.Printf("%s Path or Protocol Error: %s %s", http_proxy_print_prefix, r.Method, r.URL.Path)
	http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
}

func copy_headers(source http.Header, dest http.Header) { // MODIFIED
	for key, values := range source {
		dest[key] = values
	}
}

func forward_request(method string, url string, body io.Reader, headers http.Header) (*http.Response, error) { // MODIFIED
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
	// Placeholder for AppSync subscription logic
	if AppSyncProxyHelper != nil && request_id != "" {
		AppSyncProxyHelper.HandleAppSyncSubscriptionForRequest(ctx, request_id)
	}

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
	// Placeholder for AppSync publishing logic
	if AppSyncProxyHelper != nil && request_id != "" {
		AppSyncProxyHelper.HandleAppSyncPublishForResponse(ctx, request_id, body)
	}

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
