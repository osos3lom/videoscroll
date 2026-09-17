package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// NewID is a random identifier for records (users, invites, share links).
// It is not a secret.
func NewID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// NewCode is a 128-bit, URL-safe secret, such as an invite or share code.
// Store only HashCode of it.
func NewCode() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// HashCode is what gets stored for a code, so a leaked data file cannot be
// used to redeem anything. Codes carry 128 bits, so a plain SHA-256 is enough.
func HashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
