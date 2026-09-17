package users

import (
	"errors"
	"regexp"
	"strings"
)

// Usernames are either phone numbers or plain handles.
//
// Phone numbers are stored in E.164 form (+9665XXXXXXXX), so a person can
// sign in with whichever way they usually write their number: 05XXXXXXXX,
// 5XXXXXXXX, 9665XXXXXXXX, 009665XXXXXXXX or +966 5X XXX XXXX all mean the
// same account. Local numbers are read as Saudi (+966).

// DefaultCountryCode is assumed for numbers written without one.
const DefaultCountryCode = "966"

var (
	ErrInvalidUsername = errors.New("use a phone number, or a username of 3-32 letters, digits, dots, dashes or underscores")
	ErrInvalidPhone    = errors.New("phone number not recognised: use 05XXXXXXXX, or the full number with its country code (e.g. +9665XXXXXXXX)")
)

var (
	// Handles: lower-case, and never all digits (those are phone numbers).
	handlePattern = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)
	allDigits     = regexp.MustCompile(`^[0-9]+$`)

	// Anything made only of digits, an optional leading +, and the usual
	// separators is treated as a phone number.
	phoneLike  = regexp.MustCompile(`^\+?\(?[0-9][0-9 ()\-.]*$`)
	phoneNoise = strings.NewReplacer(" ", "", "(", "", ")", "", "-", "", ".", "")
	e164       = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
)

// NormalizeUsername returns the canonical form used for storage and lookup.
func NormalizeUsername(input string) string {
	input = strings.TrimSpace(input)
	if phone, ok := normalizePhone(input); ok {
		return phone
	}
	return strings.ToLower(input)
}

// normalizePhone reports whether input looks like a phone number and, if so,
// its E.164 form. An unrecognisable number is returned unchanged (minus
// separators) so that validation can reject it with a phone-specific message.
func normalizePhone(input string) (string, bool) {
	if !phoneLike.MatchString(input) {
		return "", false
	}
	digits := phoneNoise.Replace(input)
	plus := strings.HasPrefix(digits, "+")
	digits = strings.TrimPrefix(digits, "+")
	if !plus && strings.HasPrefix(digits, "00") {
		plus, digits = true, digits[2:]
	}

	switch {
	case plus:
		return "+" + digits, true
	case len(digits) == 10 && strings.HasPrefix(digits, "05"): // 05XXXXXXXX
		return "+" + DefaultCountryCode + digits[1:], true
	case len(digits) == 9 && strings.HasPrefix(digits, "5"): // 5XXXXXXXX
		return "+" + DefaultCountryCode + digits, true
	case len(digits) == 12 && strings.HasPrefix(digits, DefaultCountryCode+"5"): // 9665XXXXXXXX
		return "+" + digits, true
	default:
		return digits, true
	}
}

// IsPhone reports whether a normalized username is a phone number.
func IsPhone(username string) bool {
	return strings.HasPrefix(username, "+") || allDigits.MatchString(username)
}

// ValidateUsername checks a normalized username.
func ValidateUsername(username string) error {
	if IsPhone(username) {
		if !e164.MatchString(username) {
			return ErrInvalidPhone
		}
		return nil
	}
	if !handlePattern.MatchString(username) {
		return ErrInvalidUsername
	}
	return nil
}
