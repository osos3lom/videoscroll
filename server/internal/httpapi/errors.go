package httpapi

import (
	"net/http"

	"github.com/osos3lom/videoscroll/server/internal/jobs"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// Every error response is {"error": <English message>, "code": <stable id>}.
// The app shows its own translation of the code (src/lib/errorMessages.ts)
// and falls back to the English message for codes it does not know. Codes
// are part of the API: rename one only together with the app.
var errorCodes = map[string]string{
	// Requests
	"invalid JSON body":                "invalid_request",
	"Upload-Offset header is required": "invalid_request",
	"origin not allowed":               "origin_not_allowed",
	"not found":                        "not_found",
	"video not found":                  "video_not_found",
	"poster not found":                 "not_found",

	// Signing in and passwords
	"sign in required":                                 "sign_in_required",
	"session expired":                                  "session_expired",
	"media token invalid or expired":                   "session_expired",
	"incorrect username or password":                   "invalid_credentials",
	"current password is incorrect":                    "wrong_current_password",
	"choose a password different from the current one": "same_password",
	"too many attempts, try again later":               "rate_limited",
	"change your own password from your profile":       "use_profile_password",

	// Permissions
	"owner only":                 "owner_only",
	"your account cannot upload": "cannot_upload",
	"only the owner or the uploader can delete this video": "not_your_video",
	"only the owner or the uploader can rename this video": "not_your_video",
	"you cannot delete your own account":                   "cannot_delete_self",

	// Accounts and invites
	users.ErrUsernameTaken.Error():   "username_taken",
	users.ErrInvalidUsername.Error(): "invalid_username",
	users.ErrInvalidPhone.Error():    "invalid_phone",
	users.ErrWeakPassword.Error():    "weak_password",
	users.ErrDisplayName.Error():     "invalid_name",
	users.ErrInvalidRole.Error():     "invalid_role",
	users.ErrInviteInvalid.Error():   "invite_invalid",
	users.ErrLastOwner.Error():       "last_owner",

	// Uploads and videos
	jobs.ErrNotFound.Error():            "upload_not_found",
	jobs.ErrUnsupported.Error():         "unsupported_format",
	jobs.ErrTooLarge.Error():            "file_too_large",
	jobs.ErrInsufficientStorage.Error(): "disk_full",
	jobs.ErrBusy.Error():                "upload_busy",
	jobs.ErrWrongState.Error():          "upload_closed",
	jobs.ErrExceedsDeclaredSize.Error(): "upload_invalid",
	"chunk too large":                   "upload_invalid",
	media.ErrInvalidTitle.Error():       "invalid_title",

	// Unexpected failures: the details are in the server log.
	"could not sign out":        "server_error",
	"could not change password": "server_error",
	"could not create account":  "server_error",
	"could not reset password":  "server_error",
	"could not delete account":  "server_error",
	"could not rename video":    "server_error",
	"could not delete video":    "server_error",
	"upload failed":             "server_error",
}

// errorCode returns the code for a message, or a generic one by status.
func errorCode(status int, message string) string {
	if code, ok := errorCodes[message]; ok {
		return code
	}
	switch {
	case status == http.StatusUnauthorized:
		return "sign_in_required"
	case status == http.StatusForbidden:
		return "forbidden"
	case status == http.StatusNotFound:
		return "not_found"
	case status == http.StatusTooManyRequests:
		return "rate_limited"
	case status >= 500:
		return "server_error"
	default:
		return "invalid_request"
	}
}
