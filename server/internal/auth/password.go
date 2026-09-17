package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// argon2id with the OWASP minimum profile. 19 MiB per hash is modest, but the
// machine has 4 GB shared with ffmpeg, so concurrent hashes are also capped.
const (
	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonKeyLen    = 32
	argonSaltLen   = 16

	MinPasswordLength = 10
)

// hashSlots bounds concurrent argon2 work: a burst of login attempts queues
// instead of allocating 19 MiB each.
var hashSlots = make(chan struct{}, 2)

var ErrMalformedHash = errors.New("malformed password hash")

// dummyHash is verified against when a username does not exist, so a login
// for an unknown user costs the same time as one for a real user.
var dummyHash = mustHash("videoscroll-dummy-password")

func mustHash(password string) string {
	h, err := HashPassword(password)
	if err != nil {
		panic(err)
	}
	return h
}

// HashPassword returns a PHC-format string:
// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<key>
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hashSlots <- struct{}{}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	<-hashSlots

	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword reports whether password matches encoded. An empty encoded
// hash is checked against a dummy so the timing does not reveal it.
func VerifyPassword(password, encoded string) bool {
	if encoded == "" {
		_, _ = verify(password, dummyHash)
		return false
	}
	ok, err := verify(password, encoded)
	return err == nil && ok
}

func verify(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrMalformedHash
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrMalformedHash
	}

	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false, ErrMalformedHash
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrMalformedHash
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, ErrMalformedHash
	}

	hashSlots <- struct{}{}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want)))
	<-hashSlots

	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
