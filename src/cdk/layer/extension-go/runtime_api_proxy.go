// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Read about Lambda Runtime API here
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"

)

const (
	http_proxy_print_prefix = "[Runtime API Proxy]"
)

var (
	aws_lambda_runtime_api string
	http_client            = &http.Client{}
	// AppSyncProxyHelper and SetAppSyncHelper are removed as RuntimeAPIProxy methods now handle AppSync directly.
)

func (p *RuntimeAPIProxy) handle_next(w http.ResponseWriter, r *http.Request) {
	log.Println(http_proxy_print_prefix, "GET /next")

	url := fmt.Sprintf("http://%s/2018-06-01/runtime/invocation/next", aws_lambda_runtime_api)

	resp, err := p.forward_request("GET", url, r.Body, r.Header)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error forwarding /next request: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	body_bytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error reading /next response body: %v", err), http.StatusInternalServerError)
		return
	}

	request_id := resp.Header.Get("Lambda-Runtime-Aws-Request-Id")

	modified_body, modified_headers := process_request(r.Context(), request_id, body_bytes, resp.Header)

	copy_headers(modified_headers, w.Header())
	w.WriteHeader(resp.StatusCode)
	_, err = w.Write(modified_body)
	if err != nil {
		log.Printf("%s Error writing /next response to client: %v", http_proxy_print_prefix, err)
	}
	log.Println(http_proxy_print_prefix, "GET /next completed")

	// Publish event and subscribe to response channel via AppSync WebSocket
	if p.appsync_ws_client != nil && p.appsync_ws_client.IsConnected() {
		// 1. Subscribe to the response channel for this request_id (was 2)
		response_topic := fmt.Sprintf("live-lambda/response/%s", request_id)
		subscription_id_for_appsync := response_topic // Use topic as subscription ID for simplicity with AppSync client

		log.Printf("%s Subscribing to AppSync topic %s for request ID %s", http_proxy_print_prefix, response_topic, request_id)
		_, err := p.appsync_ws_client.Subscribe( // Note: err is declared with :=
			r.Context(),
			subscription_id_for_appsync, // This is the channel for the library, it's set to response_topic
			func(data_payload interface{}) {
				log.Printf("%s Received message on AppSync topic %s (for request ID %s): %+v", http_proxy_print_prefix, response_topic, request_id, data_payload)
			},
		)
		if err != nil {
			log.Printf("%s Error subscribing to AppSync topic %s: %v", http_proxy_print_prefix, response_topic, err)
		} else {
			log.Printf("%s Successfully subscribed to AppSync topic %s", http_proxy_print_prefix, response_topic)
		}

		// 2. Publish the request event (was 1) - only if subscription was initially successful
		if err == nil { 
			type RequestPayload struct {
				RequestID    string          `json:"request_id"`
				EventPayload json.RawMessage `json:"event_payload"`
			}
			payload_data := RequestPayload{
				RequestID:    request_id,
				EventPayload: body_bytes,
			}
			payload_json_bytes, marshal_err := json.Marshal(payload_data) // Use new var for marshal error
			if marshal_err != nil {
				log.Printf("%s Error marshalling request payload for AppSync: %v", http_proxy_print_prefix, marshal_err)
			} else {
				publish_topic := "live-lambda/requests"
				log.Printf("%s Publishing event for request ID %s to AppSync topic %s", http_proxy_print_prefix, request_id, publish_topic)
				err = p.appsync_ws_client.Publish(r.Context(), publish_topic, []interface{}{string(payload_json_bytes)}) // Re-assign err
				if err != nil {
					log.Printf("%s Error publishing to AppSync topic %s: %v", http_proxy_print_prefix, publish_topic, err)
				} else {
					log.Printf("%s Successfully published event for request ID %s to AppSync topic %s", http_proxy_print_prefix, request_id, publish_topic)
				}
			}
		} else {
			log.Printf("%s Skipping publish for request ID %s due to subscription error: %v", http_proxy_print_prefix, request_id, err)
		}
	} else {
		log.Printf("%s AppSync WebSocket client is nil or not connected. Cannot publish or subscribe.", http_proxy_print_prefix)
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
