package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/config"
	"github.com/osos3lom/videoscroll/server/internal/jobs"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

const testOrigin = "https://example.github.io"

type fixture struct {
	t       *testing.T
	handler http.Handler
	users   *users.Store
	owner   users.User
	viewer  users.User
	signer  *auth.Signer
	layout  media.Layout
	index   *media.Index
	content []byte
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	layout := media.NewLayout(t.TempDir())
	if err := layout.Ensure(); err != nil {
		t.Fatal(err)
	}

	content := make([]byte, 10_000)
	for i := range content {
		content[i] = byte(i % 251)
	}
	if err := os.WriteFile(filepath.Join(layout.Videos, "clip.mp4"), content, 0o640); err != nil {
		t.Fatal(err)
	}

	store, err := users.Open(filepath.Join(layout.Data, "users.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner, err := store.Create("owner", "owner-password-1", users.RoleOwner)
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := store.Create("viewer", "viewer-password-1", users.RoleViewer)
	if err != nil {
		t.Fatal(err)
	}

	index := media.NewIndex(layout)
	signer := auth.NewSigner([]byte("test-secret-test-secret-test-secret"))
	manager := jobs.NewManager(layout, index, nil, jobs.Options{MaxUploadBytes: 1 << 30})
	srv, err := New(Deps{
		Config: config.Config{AllowedOrigins: []string{testOrigin}, MinFreeBytes: 0},
		Layout: layout, Index: index, Users: store, Signer: signer, Jobs: manager,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(srv.Close)
	return &fixture{t, srv.Handler(), store, owner, viewer, signer, layout, index, content}
}

// remoteAddrKey in a headers map sets the request's peer address instead.
const remoteAddrKey = "\x00remote-addr"

func from(addr string) map[string]string { return map[string]string{remoteAddrKey: addr} }

func (f *fixture) do(method, target string, body any, headers map[string]string) *httptest.ResponseRecorder {
	f.t.Helper()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, target, reader)
	for k, v := range headers {
		if k == remoteAddrKey {
			req.RemoteAddr = v
			continue
		}
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func (f *fixture) session(u users.User) map[string]string {
	current, _ := f.users.Get(u.ID)
	token, _ := f.signer.IssueSession(current.ID, current.Ver)
	return map[string]string{"Authorization": "Bearer " + token}
}

func (f *fixture) mediaURL(u users.User, rangeHeader string) (string, map[string]string) {
	current, _ := f.users.Get(u.ID)
	token, _ := f.signer.IssueMedia(current.ID, current.Ver)
	h := map[string]string{}
	if rangeHeader != "" {
		h["Range"] = rangeHeader
	}
	return "/api/video/" + media.VideoID("clip.mp4") + "?t=" + token, h
}

func TestEverythingRequiresAuth(t *testing.T) {
	f := newFixture(t)
	for _, target := range []string{
		"/api/videos",
		"/api/video/" + media.VideoID("clip.mp4"),
		"/api/poster/" + media.VideoID("clip.mp4"),
		"/api/download/" + media.VideoID("clip.mp4"),
		"/api/admin/users",
		"/api/auth/me",
	} {
		if rec := f.do("GET", target, nil, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without credentials = %d, want 401", target, rec.Code)
		}
	}
	if rec := f.do("GET", "/api/health", nil, nil); rec.Code != http.StatusOK {
		t.Errorf("health = %d", rec.Code)
	}
}

func TestLoginAndVideoList(t *testing.T) {
	f := newFixture(t)

	rec := f.do("POST", "/api/auth/login", map[string]string{"username": "viewer", "password": "wrong-password"}, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad login = %d", rec.Code)
	}

	rec = f.do("POST", "/api/auth/login", map[string]string{"username": "Viewer", "password": "viewer-password-1"}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("login = %d %s", rec.Code, rec.Body)
	}
	var session struct {
		Token string       `json:"token"`
		User  users.Public `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &session)
	if session.Token == "" || session.User.Role != users.RoleViewer || strings.Contains(rec.Body.String(), "argon2") {
		t.Fatalf("login body = %s", rec.Body)
	}

	rec = f.do("GET", "/api/videos", nil, map[string]string{"Authorization": "Bearer " + session.Token})
	if rec.Code != http.StatusOK {
		t.Fatalf("videos = %d", rec.Code)
	}
	var list VideosResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if list.MediaToken == "" || list.User.Username != "viewer" {
		t.Fatalf("videos body = %s", rec.Body)
	}
	// The fixture's index is empty. That must be [], not null: the app maps
	// over it, and null blanked the whole page on a fresh install.
	if !strings.Contains(rec.Body.String(), `"data":[]`) {
		t.Errorf("empty video list not serialized as []: %s", rec.Body)
	}
}

func TestRangeRequests(t *testing.T) {
	f := newFixture(t)

	cases := []struct {
		rangeHeader string
		status      int
		want        []byte
	}{
		{"", http.StatusOK, f.content},
		{"bytes=0-1", http.StatusPartialContent, f.content[:2]},
		{"bytes=9990-", http.StatusPartialContent, f.content[9990:]},
		{"bytes=-500", http.StatusPartialContent, f.content[9500:]},
		{"bytes=20000-", http.StatusRequestedRangeNotSatisfiable, nil},
	}
	for _, tc := range cases {
		target, headers := f.mediaURL(f.viewer, tc.rangeHeader)
		rec := f.do("GET", target, nil, headers)
		if rec.Code != tc.status {
			t.Errorf("Range %q: status %d, want %d", tc.rangeHeader, rec.Code, tc.status)
			continue
		}
		if tc.want != nil && !bytes.Equal(rec.Body.Bytes(), tc.want) {
			t.Errorf("Range %q: wrong bytes (%d returned)", tc.rangeHeader, rec.Body.Len())
		}
		if tc.status < 300 {
			if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
				t.Errorf("Cache-Control = %q, must be private", cc)
			}
			if !strings.Contains(strings.Join(rec.Header().Values("Vary"), ","), "Origin") {
				t.Error("media response lacks Vary: Origin")
			}
		}
	}

	// If-Range with a stale validator must return the whole file, never a
	// range from a possibly different version.
	target, headers := f.mediaURL(f.viewer, "bytes=0-1")
	headers["If-Range"] = `"stale"`
	if rec := f.do("GET", target, nil, headers); rec.Code != http.StatusOK {
		t.Errorf("stale If-Range = %d, want 200", rec.Code)
	}

	target, headers = f.mediaURL(f.viewer, "")
	if rec := f.do("HEAD", target, nil, headers); rec.Code != http.StatusOK || rec.Body.Len() != 0 ||
		rec.Header().Get("Content-Length") != "10000" {
		t.Errorf("HEAD: status %d, body %d, length %q", rec.Code, rec.Body.Len(), rec.Header().Get("Content-Length"))
	}

	// Path traversal through the id.
	evil := "/api/video/" + media.VideoID("../users.json")
	target, _ = f.mediaURL(f.viewer, "")
	if rec := f.do("GET", evil+"?"+strings.SplitN(target, "?", 2)[1], nil, nil); rec.Code != http.StatusNotFound {
		t.Errorf("traversal id = %d, want 404", rec.Code)
	}
}

func TestDownload(t *testing.T) {
	f := newFixture(t)
	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: id, FileName: "clip.mp4", Title: "رحلة: الشاطئ/2026"})

	current, _ := f.users.Get(f.viewer.ID)
	token, _ := f.signer.IssueMedia(current.ID, current.Ver)
	target := "/api/download/" + id + "?t=" + token

	rec := f.do("GET", target, nil, nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), f.content) {
		t.Fatalf("download: status %d, %d bytes", rec.Code, rec.Body.Len())
	}
	disposition, params, err := mime.ParseMediaType(rec.Header().Get("Content-Disposition"))
	if err != nil || disposition != "attachment" || params["filename"] != "رحلة الشاطئ2026.mp4" {
		t.Errorf("Content-Disposition = %q (%v)", rec.Header().Get("Content-Disposition"), err)
	}

	// A broken download resumes.
	rec = f.do("GET", target, nil, map[string]string{"Range": "bytes=9000-"})
	if rec.Code != http.StatusPartialContent || !bytes.Equal(rec.Body.Bytes(), f.content[9000:]) {
		t.Errorf("ranged download: status %d, %d bytes", rec.Code, rec.Body.Len())
	}

	// Session tokens are not media tokens.
	session, _ := f.signer.IssueSession(current.ID, current.Ver)
	if rec := f.do("GET", "/api/download/"+id+"?t="+session, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("download with a session token = %d, want 401", rec.Code)
	}
}

func TestDownloadName(t *testing.T) {
	cases := []struct{ title, file, want string }{
		{"Beach day", "123-beach.mov", "Beach day.mov"},
		{"  ..hidden..  ", "a.mp4", "hidden.mp4"},
		{"a/b\\c:d*e?f\"g<h>i|j\x00k", "a.mp4", "abcdefghijk.mp4"},
		{"", "1789-clip.webm", "1789-clip.webm"},
		{"???", "x.mp4", "x.mp4"},
		{strings.Repeat("م", 150), "x.mp4", strings.Repeat("م", 100) + ".mp4"},
	}
	for _, tc := range cases {
		if got := downloadName(tc.title, tc.file); got != tc.want {
			t.Errorf("downloadName(%q, %q) = %q, want %q", tc.title, tc.file, got, tc.want)
		}
	}
}

func TestRevocationKillsSessionAndMediaTokens(t *testing.T) {
	f := newFixture(t)
	sessionHeaders := f.session(f.viewer)
	mediaTarget, _ := f.mediaURL(f.viewer, "")

	if rec := f.do("POST", "/api/auth/logout-all", nil, sessionHeaders); rec.Code != http.StatusNoContent {
		t.Fatalf("logout-all = %d", rec.Code)
	}
	if rec := f.do("GET", "/api/videos", nil, sessionHeaders); rec.Code != http.StatusUnauthorized {
		t.Errorf("old session after logout-all = %d", rec.Code)
	}
	if rec := f.do("GET", mediaTarget, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("old media token after logout-all = %d", rec.Code)
	}
}

func TestRolesAndInvites(t *testing.T) {
	f := newFixture(t)

	if rec := f.do("GET", "/api/admin/users", nil, f.session(f.viewer)); rec.Code != http.StatusForbidden {
		t.Errorf("viewer admin access = %d", rec.Code)
	}
	upload := map[string]any{"fileName": "a.mp4", "size": 10, "lastModified": 1}
	if rec := f.do("POST", "/api/uploads", upload, f.session(f.viewer)); rec.Code != http.StatusForbidden {
		t.Errorf("viewer upload = %d", rec.Code)
	}

	rec := f.do("POST", "/api/admin/invites", map[string]any{"role": "uploader"}, f.session(f.owner))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create invite = %d %s", rec.Code, rec.Body)
	}
	var created struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	join := map[string]string{"code": created.Code, "username": "newbie", "password": "newbie-password-1"}
	if rec := f.do("POST", "/api/auth/join", join, nil); rec.Code != http.StatusCreated {
		t.Fatalf("join = %d %s", rec.Code, rec.Body)
	}
	join["username"] = "second"
	if rec := f.do("POST", "/api/auth/join", join, nil); rec.Code != http.StatusForbidden {
		t.Errorf("reused invite = %d, want 403", rec.Code)
	}

	newbie, _ := f.users.ByUsername("newbie")
	if rec := f.do("POST", "/api/uploads", upload, f.session(newbie)); rec.Code != http.StatusOK {
		t.Errorf("uploader upload = %d %s", rec.Code, rec.Body)
	}

	// The last owner cannot be demoted.
	patch := map[string]string{"role": "viewer"}
	if rec := f.do("PATCH", "/api/admin/users/"+f.owner.ID, patch, f.session(f.owner)); rec.Code != http.StatusBadRequest {
		t.Errorf("demote last owner = %d", rec.Code)
	}
}

func TestCORS(t *testing.T) {
	f := newFixture(t)
	preflight := map[string]string{
		"Origin":                         testOrigin,
		"Access-Control-Request-Method":  "GET",
		"Access-Control-Request-Headers": "authorization",
	}
	rec := f.do("OPTIONS", "/api/videos", nil, preflight)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != testOrigin {
		t.Errorf("allowed preflight: %d, ACAO %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}

	preflight["Origin"] = "https://evil.example"
	rec = f.do("OPTIONS", "/api/videos", nil, preflight)
	if rec.Code != http.StatusForbidden || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("disallowed preflight: %d, ACAO %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestLoginRateLimit(t *testing.T) {
	f := newFixture(t)
	body := map[string]string{"username": "owner", "password": "nope-nope-nope"}
	var last int
	for range 12 {
		last = f.do("POST", "/api/auth/login", body, nil).Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("after 12 bad logins status = %d, want 429", last)
	}
}

func TestSlowJSONBodyIsCutOff(t *testing.T) {
	f := newFixture(t)
	saved := jsonBodyTimeout
	jsonBodyTimeout = 200 * time.Millisecond
	t.Cleanup(func() { jsonBodyTimeout = saved })

	srv := httptest.NewServer(f.handler)
	t.Cleanup(srv.Close)
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	// Promise 100 bytes and send only the first few, then go quiet.
	fmt.Fprintf(conn, "POST /api/auth/login HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"user")
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("server kept waiting for the body: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestStrangerCannotLockOwnerOut(t *testing.T) {
	f := newFixture(t)
	wrong := map[string]string{"username": "owner", "password": "guessing-guessing"}
	right := map[string]string{"username": "owner", "password": "owner-password-1"}

	var last int
	for range 30 {
		last = f.do("POST", "/api/auth/login", wrong, from("203.0.113.9:4000")).Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("attacker after 30 failures = %d, want 429", last)
	}

	// The owner, from their own address, is unaffected.
	if code := f.do("POST", "/api/auth/login", right, from("198.51.100.7:5000")).Code; code != http.StatusOK {
		t.Errorf("owner login from another address = %d, want 200", code)
	}
}

func TestSuccessfulLoginsAreNotCounted(t *testing.T) {
	f := newFixture(t)
	right := map[string]string{"username": "viewer", "password": "viewer-password-1"}
	for i := range 30 {
		if code := f.do("POST", "/api/auth/login", right, from("198.51.100.7:5000")).Code; code != http.StatusOK {
			t.Fatalf("login %d = %d, want 200", i+1, code)
		}
	}
}

func TestPasswordChangeGuessesAreLimited(t *testing.T) {
	f := newFixture(t)
	body := map[string]string{"currentPassword": "not-it-at-all", "newPassword": "brand-new-password"}
	var last int
	for range 12 {
		last = f.do("POST", "/api/auth/password", body, f.session(f.viewer)).Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("after 12 wrong current passwords = %d, want 429", last)
	}
}

func TestOwnerCreatesPhoneMemberWhoMustChangePassword(t *testing.T) {
	f := newFixture(t)
	owner := f.session(f.owner)

	body := map[string]string{"username": "050 123 4567", "displayName": "Ahmed", "password": "temporary-pass-1", "role": "uploader"}
	if rec := f.do("POST", "/api/admin/users", body, f.session(f.viewer)); rec.Code != http.StatusForbidden {
		t.Errorf("viewer creating accounts = %d", rec.Code)
	}
	rec := f.do("POST", "/api/admin/users", body, owner)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"+966501234567"`) {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("POST", "/api/admin/users", body, owner); rec.Code != http.StatusConflict {
		t.Errorf("duplicate = %d", rec.Code)
	}
	bad := map[string]string{"username": "12345", "password": "temporary-pass-1", "role": "viewer"}
	if rec := f.do("POST", "/api/admin/users", bad, owner); rec.Code != http.StatusBadRequest {
		t.Errorf("bad phone = %d", rec.Code)
	}

	// Signs in with another way of writing the number.
	rec = f.do("POST", "/api/auth/login", map[string]string{"username": "+966 50 123 4567", "password": "temporary-pass-1"}, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"mustChangePassword":true`) {
		t.Fatalf("login = %d %s", rec.Code, rec.Body)
	}
	var session struct{ Token string }
	_ = json.Unmarshal(rec.Body.Bytes(), &session)
	auth := map[string]string{"Authorization": "Bearer " + session.Token}

	// Until the password is changed, only the password routes work.
	rec = f.do("GET", "/api/videos", nil, auth)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), codePasswordChangeRequired) {
		t.Errorf("videos while pending = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("GET", "/api/auth/me", nil, auth); rec.Code != http.StatusOK {
		t.Errorf("me while pending = %d", rec.Code)
	}
	member, _ := f.users.ByUsername("0501234567")
	mediaTarget, _ := f.mediaURL(member, "")
	if rec := f.do("GET", mediaTarget, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("media while pending = %d", rec.Code)
	}

	same := map[string]string{"currentPassword": "temporary-pass-1", "newPassword": "temporary-pass-1"}
	if rec := f.do("POST", "/api/auth/password", same, auth); rec.Code != http.StatusBadRequest {
		t.Errorf("reusing the temporary password = %d", rec.Code)
	}
	change := map[string]string{"currentPassword": "temporary-pass-1", "newPassword": "ahmeds-own-password"}
	rec = f.do("POST", "/api/auth/password", change, auth)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "mustChangePassword") {
		t.Fatalf("change = %d %s", rec.Code, rec.Body)
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &session)
	if rec := f.do("GET", "/api/videos", nil, map[string]string{"Authorization": "Bearer " + session.Token}); rec.Code != http.StatusOK {
		t.Errorf("videos after change = %d", rec.Code)
	}
}

func TestOwnerResetsPasswordAndDeletesMembers(t *testing.T) {
	f := newFixture(t)
	owner := f.session(f.owner)
	viewerSession := f.session(f.viewer)

	reset := map[string]string{"password": "fresh-temp-pass"}
	if rec := f.do("POST", "/api/admin/users/"+f.owner.ID+"/password", reset, owner); rec.Code != http.StatusBadRequest {
		t.Errorf("owner resetting own password here = %d", rec.Code)
	}
	if rec := f.do("POST", "/api/admin/users/"+f.viewer.ID+"/password", reset, owner); rec.Code != http.StatusOK {
		t.Fatalf("reset = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("GET", "/api/videos", nil, viewerSession); rec.Code != http.StatusUnauthorized {
		t.Errorf("old session after reset = %d", rec.Code)
	}
	login := map[string]string{"username": "viewer", "password": "fresh-temp-pass"}
	if rec := f.do("POST", "/api/auth/login", login, nil); !strings.Contains(rec.Body.String(), `"mustChangePassword":true`) {
		t.Errorf("login after reset = %s", rec.Body)
	}

	if rec := f.do("DELETE", "/api/admin/users/"+f.owner.ID, nil, owner); rec.Code != http.StatusBadRequest {
		t.Errorf("deleting yourself = %d", rec.Code)
	}
	if rec := f.do("DELETE", "/api/admin/users/"+f.viewer.ID, nil, owner); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("POST", "/api/auth/login", login, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("deleted member login = %d", rec.Code)
	}
}

func TestRenameVideoPermissions(t *testing.T) {
	f := newFixture(t)
	uploader, err := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := f.users.Create("other-uploader", "uploader-password", users.RoleUploader)

	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: id, FileName: "clip.mp4", Title: "clip", UploaderID: uploader.ID})
	target := "/api/videos/" + id

	cases := []struct {
		name   string
		user   users.User
		title  string
		status int
	}{
		{"viewer", f.viewer, "nope", http.StatusForbidden},
		{"another uploader", other, "nope", http.StatusForbidden},
		{"the uploader", uploader, "Beach day", http.StatusOK},
		{"empty title", uploader, "   ", http.StatusBadRequest},
		{"the owner", f.owner, "Beach day, 2026", http.StatusOK},
	}
	for _, tc := range cases {
		rec := f.do("PATCH", target, map[string]string{"title": tc.title}, f.session(tc.user))
		if rec.Code != tc.status {
			t.Errorf("%s: status %d, want %d (%s)", tc.name, rec.Code, tc.status, rec.Body)
		}
	}

	meta, _ := f.index.Get(id)
	if meta.Title != "Beach day, 2026" || meta.FileName != "clip.mp4" {
		t.Errorf("meta after rename = %+v", meta)
	}
	var onDisk media.Meta
	data, _ := os.ReadFile(f.index.MetaPath(id))
	_ = json.Unmarshal(data, &onDisk)
	if onDisk.Title != "Beach day, 2026" {
		t.Errorf("title not persisted: %+v", onDisk)
	}

	// The owner can delete any video.
	if rec := f.do("DELETE", target, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Errorf("owner delete = %d", rec.Code)
	}
}

// Every message the handlers send must have a stable code the app can
// translate, so a new English message cannot silently reach Arabic users.
func TestEveryErrorMessageHasACode(t *testing.T) {
	sources, _ := filepath.Glob("*.go")
	literal := regexp.MustCompile(`writeError\(w, [^,]+, "([^"]+)"\)`)
	for _, file := range sources {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range literal.FindAllStringSubmatch(string(data), -1) {
			if _, ok := errorCodes[m[1]]; !ok {
				t.Errorf("%s: message %q has no entry in errorCodes", file, m[1])
			}
		}
	}

	f := newFixture(t)
	rec := f.do("POST", "/api/auth/login", map[string]string{"username": "viewer", "password": "wrong-password-1"}, nil)
	if !strings.Contains(rec.Body.String(), `"code":"invalid_credentials"`) {
		t.Errorf("login failure body = %s", rec.Body)
	}
	bad := map[string]string{"username": "12345", "password": "temporary-pass-1", "role": "viewer"}
	rec = f.do("POST", "/api/admin/users", bad, f.session(f.owner))
	if !strings.Contains(rec.Body.String(), `"code":"invalid_phone"`) {
		t.Errorf("bad phone body = %s", rec.Body)
	}
}
