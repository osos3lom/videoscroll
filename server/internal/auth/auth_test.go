package auth

import (
	"strings"
	"testing"
	"time"
)

func TestSessionTokenRoundTrip(t *testing.T) {
	s := NewSigner([]byte("0123456789abcdef0123456789abcdef"))
	token, _ := s.IssueSession("u1", 3)

	claims, err := s.Verify(token, ScopeSession)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != "u1" || claims.Ver != 3 {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestTokenRejectsTamperScopeAndExpiry(t *testing.T) {
	s := NewSigner([]byte("0123456789abcdef0123456789abcdef"))
	session, _ := s.IssueSession("u1", 1)
	media, _ := s.IssueMedia("u1", 1)

	body, sig, _ := strings.Cut(session, ".")
	tampered := body[:len(body)-2] + "xx." + sig
	if _, err := s.Verify(tampered, ScopeSession); err == nil {
		t.Error("tampered token accepted")
	}

	// A media token lives in URLs; it must never grant a session.
	if _, err := s.Verify(media, ScopeSession); err == nil {
		t.Error("media token accepted as session token")
	}
	if _, err := s.Verify(session, ScopeMedia); err == nil {
		t.Error("session token accepted as media token")
	}

	other := NewSigner([]byte("another-secret-another-secret-xx"))
	if _, err := other.Verify(session, ScopeSession); err == nil {
		t.Error("token accepted under a different secret")
	}

	s.now = func() time.Time { return time.Now().Add(SessionTTL + time.Minute) }
	if _, err := s.Verify(session, ScopeSession); err != ErrExpiredToken {
		t.Errorf("expired token: err = %v", err)
	}
}

func TestMediaTokensAreStableWithinAWindow(t *testing.T) {
	s := NewSigner([]byte("0123456789abcdef0123456789abcdef"))
	base := time.Unix(1_800_000_000, 0).Truncate(MediaWindow)

	s.now = func() time.Time { return base.Add(time.Minute) }
	a, claims := s.IssueMedia("u1", 1)
	s.now = func() time.Time { return base.Add(MediaWindow - time.Minute) }
	b, _ := s.IssueMedia("u1", 1)

	if a != b {
		t.Error("tokens issued in the same window differ, which defeats URL caching")
	}
	remaining := claims.ExpiresAt().Sub(base.Add(time.Minute))
	if remaining < MediaWindow || remaining > 2*MediaWindow {
		t.Errorf("media token lifetime %s outside [6h, 12h]", remaining)
	}
}

func TestPasswordHashing(t *testing.T) {
	hash, err := HashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("unexpected format %q", hash)
	}
	if !VerifyPassword("correct horse battery", hash) {
		t.Error("correct password rejected")
	}
	if VerifyPassword("wrong horse battery", hash) {
		t.Error("wrong password accepted")
	}
	if VerifyPassword("anything", "") {
		t.Error("empty hash accepted")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(2, time.Hour)
	if !l.Allow("k") || !l.Allow("k") {
		t.Fatal("first two attempts should pass")
	}
	if l.Allow("k") {
		t.Error("third attempt should be limited")
	}
	l.Reset("k")
	if !l.Allow("k") {
		t.Error("reset did not clear the window")
	}
}
