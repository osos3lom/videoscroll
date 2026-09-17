package auth

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Limiter is a fixed-window attempt counter. In memory, because the server is
// a single process and a restart resetting the counters is harmless.
type Limiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	entries map[string]*window
}

type window struct {
	count   int
	resetAt time.Time
}

func NewLimiter(max int, per time.Duration) *Limiter {
	return &Limiter{max: max, window: per, entries: make(map[string]*window)}
}

// Allow records an attempt for key and reports whether it is within budget.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	entry, ok := l.entries[key]
	if !ok || now.After(entry.resetAt) {
		l.entries[key] = &window{count: 1, resetAt: now.Add(l.window)}
		return true
	}
	entry.count++
	return entry.count <= l.max
}

// Blocked reports whether key has used up its budget, without recording an
// attempt. Pair it with Fail to count only failures.
func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	return ok && time.Now().Before(entry.resetAt) && entry.count >= l.max
}

// Fail records one failed attempt for key.
func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry, ok := l.entries[key]
	if !ok || now.After(entry.resetAt) {
		l.entries[key] = &window{count: 1, resetAt: now.Add(l.window)}
		return
	}
	entry.count++
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	delete(l.entries, key)
	l.mu.Unlock()
}

// Sweep drops expired windows. Without it, a scan from many addresses would
// grow the map forever.
func (l *Limiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key, entry := range l.entries {
		if now.After(entry.resetAt) {
			delete(l.entries, key)
		}
	}
}

// ClientIP returns the caller's address. X-Forwarded-For is honoured only
// when the direct peer is loopback — i.e. Caddy on the same machine — and
// then only its last hop, which is the one Caddy itself appended.
func ClientIP(r *http.Request, trustLoopback bool) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}

	if trustLoopback {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				hops := strings.Split(xff, ",")
				if last := strings.TrimSpace(hops[len(hops)-1]); last != "" {
					return last
				}
			}
		}
	}
	return host
}
