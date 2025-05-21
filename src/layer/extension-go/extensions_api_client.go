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
	"net/http"
	"os"
)

// RegisterResponse is the body of the response for /register
type RegisterResponse struct {
	FunctionName    string `json:"functionName"`
	FunctionVersion string `json:"functionVersion"`
	Handler         string `json:"handler"`
}

// NextEventResponse is the response for /event/next
type NextEventResponse struct {
	EventType          EventType `json:"eventType"`
	DeadlineMs         int64     `json:"deadlineMs"`
	RequestID          string    `json:"requestId"`
	InvokedFunctionArn string    `json:"invokedFunctionArn"`
	Tracing            Tracing   `json:"tracing"`
	// Added based on potential need from other file, review if necessary
	ShutdownReason     string    `json:"shutdownReason,omitempty"` 
}

// Tracing is part of the response for /event/next
type Tracing struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// StatusResponse is the body of the response for /init/error and /exit/error
type StatusResponse struct {
	Status string `json:"status"`
}

// EventType represents the type of events received from /event/next
type EventType string

const (
	// Invoke is a lambda invoke
	Invoke EventType = "INVOKE"

	// Shutdown is a shutdown event for the environment
	Shutdown EventType = "SHUTDOWN"
	print_prefix string = "[LRAP:ExtensionsApiClient]" // MODIFIED
	extension_name_header      = "Lambda-Extension-Name" // MODIFIED
	extension_identifier_header = "Lambda-Extension-Identifier" // MODIFIED
	extension_error_type       = "Lambda-Extension-Function-Error-Type" // MODIFIED
)

// Client is a simple client for the Lambda Extensions API
type Client struct {
	base_url     string // MODIFIED
	http_client  *http.Client // MODIFIED
	extension_id string // MODIFIED
}

// NewClient returns a Lambda Extensions API client
func NewClient(aws_lambda_runtime_api string) *Client { // MODIFIED
	println(print_prefix, "Creating extension client")
	base_url := fmt.Sprintf("http://%s/2020-01-01/extension", aws_lambda_runtime_api) // MODIFIED
	return &Client{
		base_url:    base_url,
		http_client: &http.Client{},
	}
}

// Register will register the extension with the Extensions API
func (e *Client) Register(ctx context.Context, file_name string) (*RegisterResponse, error) { // MODIFIED
	println(print_prefix, "register endpoint=", file_name)
	const action = "/register"

	url := e.base_url + action

	// Get the extension name from the environment variable set by CDK
	// Fallback to file_name if not set (though it should be)
	official_extension_name := os.Getenv("AWS_LAMBDA_EXTENSION_NAME")
	if official_extension_name == "" {
		println(print_prefix, "Warning: AWS_LAMBDA_EXTENSION_NAME not set, using executable name:", file_name)
		official_extension_name = file_name
	}

	// Register for both INVOKE and SHUTDOWN events
	req_body, err := json.Marshal(map[string]interface{}{
		"events": []EventType{Invoke, Shutdown},
	})
	if err != nil {
		println(print_prefix, "failed to create request body:", err)
		return nil, err
	}
	http_req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(req_body)) // MODIFIED
	if err != nil {
		println(print_prefix, "failed to create http request:", err)
		return nil, err
	}
	http_req.Header.Set(extension_name_header, official_extension_name)
	http_res, err := e.http_client.Do(http_req) // MODIFIED
	if err != nil {
		println(print_prefix, "failed to send request:", err)
		return nil, err
	}
	if http_res.StatusCode != 200 {
		println(print_prefix, "request failed with status", http_res.Status)
		// Attempt to read body for more details even on error
		defer http_res.Body.Close()
		body_bytes, _ := io.ReadAll(http_res.Body) // MODIFIED
		println(print_prefix, "Error response body:", string(body_bytes))
		return nil, fmt.Errorf("request failed with status %s. Body: %s", http_res.Status, string(body_bytes))
	}
	defer http_res.Body.Close()
	body, err := io.ReadAll(http_res.Body)
	if err != nil {
		println(print_prefix, "failed to read response body:", err)
		return nil, err
	}
	res := RegisterResponse{}
	err = json.Unmarshal(body, &res)
	if err != nil {
		println(print_prefix, "failed to unmarshal response body:", err)
		return nil, err
	}
	e.extension_id = http_res.Header.Get(extension_identifier_header)
	println(print_prefix, "register success, extension_id=", e.extension_id)
	return &res, nil
}

// NextEvent blocks while long polling for the next lambda invoke or shutdown
func (e *Client) NextEvent(ctx context.Context) (*NextEventResponse, error) { // MODIFIED
	println(print_prefix, "awaiting next event")
	const action = "/event/next"
	url := e.base_url + action

	http_req, err := http.NewRequestWithContext(ctx, "GET", url, nil) // MODIFIED
	if err != nil {
		println(print_prefix, "failed to create http request:", err)
		return nil, err
	}
	http_req.Header.Set(extension_identifier_header, e.extension_id)
	http_res, err := e.http_client.Do(http_req) // MODIFIED
	if err != nil {
		// If context is cancelled, this is an expected error during shutdown.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		println(print_prefix, "failed to send request:", err)
		return nil, err
	}
	if http_res.StatusCode != 200 {
		println(print_prefix, "get request failed with status", http_res.Status)
		// Attempt to read body for more details even on error
		defer http_res.Body.Close()
		body_bytes, _ := io.ReadAll(http_res.Body) // MODIFIED
		println(print_prefix, "Error response body:", string(body_bytes))
		return nil, fmt.Errorf("request failed with status %s. Body: %s", http_res.Status, string(body_bytes))
	}
	defer http_res.Body.Close()
	body, err := io.ReadAll(http_res.Body)
	if err != nil {
		println(print_prefix, "failed to read response body:", err)
		return nil, err
	}
	res := NextEventResponse{}
	err = json.Unmarshal(body, &res)
	if err != nil {
		println(print_prefix, "failed to unmarshal response body:", err)
		return nil, err
	}
	println(print_prefix, "Next success")
	return &res, nil
}
