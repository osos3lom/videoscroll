package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
