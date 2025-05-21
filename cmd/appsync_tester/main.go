package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
	"nhooyr.io/websocket"
)

const (
	appsyncHTTPHost   = "gk3gfluct5azlhi5d3rnumxoq4.appsync-api.us-west-1.amazonaws.com"
	appsyncWsURL      = "wss://gk3gfluct5azlhi5d3rnumxoq4.appsync-realtime-api.us-west-1.amazonaws.com/event/realtime"
	awsRegion         = "us-west-1"
	awsProfile        = "boundless-development"
	appsyncService    = "appsync"
	signingHttpMethod = http.MethodPost
	signingHttpPath   = "/event"
)

// Message structures for AppSync WebSocket communication
type wsMessage struct {
	Type    string      `json:"type"`
	ID      string      `json:"id,omitempty"`
	Payload interface{} `json:"payload,omitempty"`
}

func main() {
	ctx := context.Background()
	log.SetOutput(os.Stdout) // Ensure logs go to stdout
	log.Println("Starting AppSync WebSocket connection test...")

	// 1. Load AWS Configuration
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(awsRegion),
		config.WithSharedConfigProfile(awsProfile),
	)
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	log.Println("AWS config loaded successfully.")

	// 2. Get credentials
	creds, err := cfg.Credentials.Retrieve(ctx)
	if err != nil {
		log.Fatalf("Failed to retrieve AWS credentials: %v", err)
	}
	log.Println("AWS credentials retrieved.")

	// 3. Prepare subprotocols for WebSocket handshake
	subprotocols, err := createConnectionAuthSubprotocol(ctx, cfg, creds)
	if err != nil {
		log.Fatalf("Failed to create connection auth subprotocol: %v", err)
	}
	log.Printf("Subprotocols prepared: %v", subprotocols)

	// 4. Connect to AppSync WebSocket
	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second) // Connection timeout
	defer cancel()

	conn, httpResp, err := websocket.Dial(dialCtx, appsyncWsURL, &websocket.DialOptions{
		Subprotocols: subprotocols,
	})
	if err != nil {
		if httpResp != nil {
			log.Printf("WebSocket dial HTTP response status: %s", httpResp.Status)
			body := make([]byte, 1024)
			n, _ := httpResp.Body.Read(body)
			log.Printf("WebSocket dial HTTP response body: %s", string(body[:n]))
			httpResp.Body.Close()
		}
		log.Fatalf("Failed to dial WebSocket: %v", err)
	}
	defer conn.Close(websocket.StatusInternalError, "internal error")
	log.Println("WebSocket connection established.")

	// 5. Send connection_init message
	initMsg := wsMessage{Type: "connection_init"}
	initPayloadBytes, err := json.Marshal(initMsg)
	if err != nil {
		log.Fatalf("Failed to marshal connection_init: %v", err)
	}

	log.Printf("Sending: %s", string(initPayloadBytes))
	err = conn.Write(ctx, websocket.MessageText, initPayloadBytes)
	if err != nil {
		log.Fatalf("Failed to send connection_init message: %v", err)
	}

	// 6. Listen for messages (e.g., connection_ack, errors)
	log.Println("Listening for messages...")
	for {
		msgType, msgBytes, err := conn.Read(ctx)
		if err != nil {
			// Check for normal closure or specific errors
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				log.Println("Connection closed normally.")
				break
			}
			log.Printf("Error reading message: %v", err)
			// Attempt to parse error structure if available
			var errMsg wsMessage
			if json.Unmarshal(msgBytes, &errMsg) == nil {
				log.Printf("Parsed error message: Type=%s, Payload=%#v", errMsg.Type, errMsg.Payload)
			}
			break // Exit on error
		}

		if msgType == websocket.MessageText {
			log.Printf("Received: %s", string(msgBytes))
			var receivedMsg wsMessage
			if err := json.Unmarshal(msgBytes, &receivedMsg); err == nil {
				if receivedMsg.Type == "connection_ack" {
					log.Println("Connection Acknowledged by AppSync! Test successful.")
					conn.Close(websocket.StatusNormalClosure, "test complete")
					os.Exit(0) // Explicit success exit
				} else if receivedMsg.Type == "error" || strings.Contains(receivedMsg.Type, "error") || receivedMsg.Type == "connection_error" {
					log.Printf("Received error from AppSync: Type=%s, Payload=%#v", receivedMsg.Type, receivedMsg.Payload)
					conn.Close(websocket.StatusAbnormalClosure, "error received")
					os.Exit(1) // Explicit failure exit
				}
			}
		} else {
			log.Printf("Received binary message (unexpected), length: %d", len(msgBytes))
		}
	}
	os.Exit(1) // If loop exits without explicit success/failure
}

func createConnectionAuthSubprotocol(ctx context.Context, cfg aws.Config, creds aws.Credentials) ([]string, error) {
	signer := v4.NewSigner()
	httpSignURL := fmt.Sprintf("https://%s%s", appsyncHTTPHost, signingHttpPath) // e.g. https://host.appsync-api.region.amazonaws.com/event
	bodyBytes := []byte("{}")                                                  // Empty JSON object as per AppSync docs
	bodyReader := strings.NewReader(string(bodyBytes))

	req, err := http.NewRequestWithContext(ctx, signingHttpMethod, httpSignURL, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request for signing: %w", err)
	}

	// Set headers required by AppSync BEFORE signing
	req.Header.Set("host", appsyncHTTPHost) // Must match the host in the URL for SigV4
	req.Header.Set("accept", "application/json, text/javascript")
	req.Header.Set("content-encoding", "amz-1.0")
	req.Header.Set("content-type", "application/json; charset=UTF-8")

	// Calculate payload hash (sha256 of the body)
	payloadHash := fmt.Sprintf("%x", sha256.Sum256(bodyBytes))

	// Sign the HTTP request
	// The signer will add X-Amz-Date, Authorization, and X-Amz-Security-Token (if session token in creds)
	if err := signer.SignHTTP(ctx, creds, req, payloadHash, appsyncService, awsRegion, time.Now().UTC()); err != nil {
		return nil, fmt.Errorf("failed to sign AppSync HTTP request: %w", err)
	}

	log.Println("[AuthSubprotocol-DEBUG] Headers after SignHTTP:")
	for k, v := range req.Header {
		log.Printf("[AuthSubprotocol-DEBUG]   %s: %v", k, v)
	}

	// Extract headers for the subprotocol JSON object from the signed request.
	// The JSON keys MUST match the casing specified by AppSync documentation for the IAM auth subprotocol.
	handshakeHeaders := make(map[string]string)

	// Required headers (from AWS Docs for IAM subprotocol JSON)
	if val := req.Header.Get("Accept"); val != "" { handshakeHeaders["accept"] = val }
	if val := req.Header.Get("Content-Encoding"); val != "" { handshakeHeaders["content-encoding"] = val }
	if val := req.Header.Get("Content-Type"); val != "" { handshakeHeaders["content-type"] = val }
	if val := req.Header.Get("Host"); val != "" { handshakeHeaders["host"] = val }
	if val := req.Header.Get("X-Amz-Date"); val != "" { handshakeHeaders["x-amz-date"] = val } // Note: key is 'x-amz-date'
	if val := req.Header.Get("Authorization"); val != "" { handshakeHeaders["Authorization"] = val }

	// X-Amz-Security-Token is conditional based on credentials
	if sessionToken := req.Header.Get("X-Amz-Security-Token"); sessionToken != "" {
		handshakeHeaders["X-Amz-Security-Token"] = sessionToken // Note: key is 'X-Amz-Security-Token'
	}

	log.Printf("[AuthSubprotocol-DEBUG] handshakeHeaders map before JSON marshal:")
	for k, v := range handshakeHeaders {
		log.Printf("[AuthSubprotocol-DEBUG]   %s: %s", k, v)
	}

	jsonHeaders, err := json.Marshal(handshakeHeaders)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal handshake headers: %w", err)
	}

	// Base64URL encode the JSON string of headers, omitting padding.
	// AWS documentation examples (JavaScript and bash) explicitly remove padding.
	// base64.RawURLEncoding omits padding characters.
	encodedHeaders := base64.RawURLEncoding.EncodeToString(jsonHeaders)

	subprotocol := fmt.Sprintf("header-%s", encodedHeaders)
	return []string{subprotocol, "aws-appsync-event-ws"}, nil
}
