package main

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	ssm_types "github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

type mock_ssm_client struct {
	get_parameter_fn func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error)
	call_count       int
}

func (m *mock_ssm_client) GetParameter(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
	m.call_count++
	return m.get_parameter_fn(ctx, params, optFns...)
}

func TestHeartbeatActive(t *testing.T) {
	now := time.Now().Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(now, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if !active {
		t.Error("Expected heartbeat to be active for current timestamp")
	}
	if mock.call_count != 1 {
		t.Errorf("Expected 1 SSM call, got %d", mock.call_count)
	}
}

func TestHeartbeatExpired(t *testing.T) {
	expired_ts := time.Now().Add(-10 * time.Minute).Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(expired_ts, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if active {
		t.Error("Expected heartbeat to be inactive for expired timestamp")
	}
}

func TestHeartbeatCacheHit(t *testing.T) {
	now := time.Now().Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(now, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)

	reader.is_heartbeat_active(context.Background(), "/test/heartbeat")
	reader.is_heartbeat_active(context.Background(), "/test/heartbeat")
	reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if mock.call_count != 1 {
		t.Errorf("Expected 1 SSM call (cached), got %d", mock.call_count)
	}
}

func TestHeartbeatCacheExpiry(t *testing.T) {
	now := time.Now().Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(now, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	// Override cache TTL for testing
	reader.cache_ttl = 50 * time.Millisecond

	reader.is_heartbeat_active(context.Background(), "/test/heartbeat")
	if mock.call_count != 1 {
		t.Errorf("Expected 1 SSM call after first read, got %d", mock.call_count)
	}

	// Wait for cache to expire
	time.Sleep(100 * time.Millisecond)

	reader.is_heartbeat_active(context.Background(), "/test/heartbeat")
	if mock.call_count != 2 {
		t.Errorf("Expected 2 SSM calls after cache expiry, got %d", mock.call_count)
	}
}

func TestHeartbeatSSMError(t *testing.T) {
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return nil, fmt.Errorf("ParameterNotFound: parameter not found")
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if active {
		t.Error("Expected heartbeat to be inactive on SSM error")
	}
}

func TestHeartbeatMissingParameter(t *testing.T) {
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: nil,
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if active {
		t.Error("Expected heartbeat to be inactive for missing parameter")
	}
}

func TestHeartbeatInvalidTimestamp(t *testing.T) {
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String("not-a-number"),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if active {
		t.Error("Expected heartbeat to be inactive for invalid timestamp")
	}
}

func TestHeartbeatJustWithinWindow(t *testing.T) {
	// 4 minutes ago - should still be active
	ts := time.Now().Add(-4 * time.Minute).Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(ts, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if !active {
		t.Error("Expected heartbeat to be active for timestamp within 5-minute window")
	}
}

func TestHeartbeatJustOutsideWindow(t *testing.T) {
	// 6 minutes ago - should be expired
	ts := time.Now().Add(-6 * time.Minute).Unix()
	mock := &mock_ssm_client{
		get_parameter_fn: func(ctx context.Context, params *ssm.GetParameterInput, optFns ...func(*ssm.Options)) (*ssm.GetParameterOutput, error) {
			return &ssm.GetParameterOutput{
				Parameter: &ssm_types.Parameter{
					Value: aws.String(strconv.FormatInt(ts, 10)),
				},
			}, nil
		},
	}

	reader := NewHeartbeatReader(mock)
	active := reader.is_heartbeat_active(context.Background(), "/test/heartbeat")

	if active {
		t.Error("Expected heartbeat to be inactive for timestamp outside 5-minute window")
	}
}
