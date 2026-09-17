// Package auth implements stateless, revocable bearer tokens and password
// hashing.
//
// Tokens rather than cookies because the frontend lives on GitHub Pages and
// the API on the home machine: a cookie there would be third-party, which
// Safari (and increasingly every browser) refuses to send.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Scope separates what a token may be used for. A media token travels in a
// URL query string — where it can end up in logs or history — so it must never
// be accepted as a session token, which can manage the account.
type Scope string

const (
	ScopeSession Scope = "session"
	ScopeMedia   Scope = "media"
)

const (
	SessionTTL = 30 * 24 * time.Hour

	// Media tokens are issued on a fixed window grid, so every token issued
	// within one window is byte-identical. That keeps video URLs stable, which
	// is what lets browser and service-worker caches hit.
	MediaWindow = 6 * time.Hour
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token expired")
)

// Claims is the entire token payload. Ver is the user's session version at
// issue time: bumping the stored version revokes every token issued before.
type Claims struct {
	Scope  Scope  `json:"s"`
	UserID string `json:"u"`
	Ver    int    `json:"v"`
	Exp    int64  `json:"e"`
}

func (c Claims) ExpiresAt() time.Time { return time.Unix(c.Exp, 0) }

type Signer struct {
	secret []byte
	now    func() time.Time
}

func NewSigner(secret []byte) *Signer {
	return &Signer{secret: secret, now: time.Now}
}

func (s *Signer) IssueSession(userID string, ver int) (string, Claims) {
	claims := Claims{
		Scope:  ScopeSession,
		UserID: userID,
		Ver:    ver,
		Exp:    s.now().Add(SessionTTL).Unix(),
	}
	return s.sign(claims), claims
}

// IssueMedia returns a token valid until the end of the window after the
// current one — between 6 and 12 hours from now.
func (s *Signer) IssueMedia(userID string, ver int) (string, Claims) {
	window := int64(MediaWindow / time.Second)
	exp := (s.now().Unix()/window + 2) * window
	claims := Claims{Scope: ScopeMedia, UserID: userID, Ver: ver, Exp: exp}
	return s.sign(claims), claims
}

func (s *Signer) sign(c Claims) string {
	payload, _ := json.Marshal(c)
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.mac(body))
}

func (s *Signer) mac(body string) []byte {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(body))
	return h.Sum(nil)
}

// Verify checks signature, scope and expiry. It does not check the user's
// current version — that needs the user store; see Middleware.
func (s *Signer) Verify(token string, scope Scope) (Claims, error) {
	body, sig, ok := strings.Cut(token, ".")
	if !ok || body == "" || sig == "" {
		return Claims{}, ErrInvalidToken
	}

	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(body)) {
		return Claims{}, ErrInvalidToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if claims.Scope != scope || claims.UserID == "" {
		return Claims{}, ErrInvalidToken
	}
	if s.now().Unix() >= claims.Exp {
		return Claims{}, ErrExpiredToken
	}
	return claims, nil
}
