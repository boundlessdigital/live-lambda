package main

import (
	"context"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

const (
	heartbeat_print_prefix = "[LiveLambdaExt:Heartbeat]"
	heartbeat_window       = 5 * time.Minute
	heartbeat_cache_ttl    = 60 * time.Second
)

type SSMClient interface {
	GetParameter(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error)
}

type HeartbeatReader struct {
	ssm_client   SSMClient
	mu           sync.RWMutex
	cached_value string
	cached_at    time.Time
	cache_ttl    time.Duration
}

func NewHeartbeatReader(ssm_client SSMClient) *HeartbeatReader {
	return &HeartbeatReader{
		ssm_client: ssm_client,
		cache_ttl:  heartbeat_cache_ttl,
	}
}

// is_heartbeat_active reads the SSM parameter and returns true if the heartbeat
// timestamp is less than 5 minutes old.
func (h *HeartbeatReader) is_heartbeat_active(ctx context.Context, ssm_path string) bool {
	value, err := h.get_cached_value(ctx, ssm_path)
	if err != nil {
		log.Printf("%s Error reading SSM parameter %s: %v, treating as inactive", heartbeat_print_prefix, ssm_path, err)
		return false
	}
	if value == "" {
		log.Printf("%s SSM parameter %s is empty, treating as inactive", heartbeat_print_prefix, ssm_path)
		return false
	}

	ts, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		log.Printf("%s Failed to parse heartbeat timestamp %q: %v, treating as inactive", heartbeat_print_prefix, value, err)
		return false
	}

	age := time.Since(time.Unix(ts, 0))
	if age > heartbeat_window {
		log.Printf("%s Heartbeat expired (age=%s, window=%s), treating as inactive", heartbeat_print_prefix, age.Round(time.Second), heartbeat_window)
		return false
	}

	log.Printf("%s Heartbeat is active (age=%s)", heartbeat_print_prefix, age.Round(time.Second))
	return true
}

func (h *HeartbeatReader) get_cached_value(ctx context.Context, ssm_path string) (string, error) {
	h.mu.RLock()
	if time.Since(h.cached_at) < h.cache_ttl {
		value := h.cached_value
		h.mu.RUnlock()
		log.Printf("%s Using cached SSM value (age=%s)", heartbeat_print_prefix, time.Since(h.cached_at).Round(time.Second))
		return value, nil
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check after acquiring write lock
	if time.Since(h.cached_at) < h.cache_ttl {
		return h.cached_value, nil
	}

	output, err := h.ssm_client.GetParameter(ctx, &ssm.GetParameterInput{
		Name: aws.String(ssm_path),
	})
	if err != nil {
		return "", err
	}

	if output.Parameter == nil || output.Parameter.Value == nil {
		h.cached_value = ""
		h.cached_at = time.Now()
		return "", nil
	}

	h.cached_value = *output.Parameter.Value
	h.cached_at = time.Now()
	log.Printf("%s Refreshed SSM cache: value=%s", heartbeat_print_prefix, h.cached_value)
	return h.cached_value, nil
}
