package httpapi

import (
	"bytes"
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// publishClip lists the fixture's clip.mp4, with a poster, as a real video.
func (f *fixture) publishClip() string {
	f.t.Helper()
	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{
		VideoID: id, FileName: "clip.mp4", Title: "Beach day", Size: int64(len(f.content)),
		Width: 720, Height: 1280, Duration: 12, UploaderID: f.owner.ID,
	})
	if err := os.WriteFile(filepath.Join(f.layout.Posters, id+".webp"), []byte("poster"), 0o640); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) share(u users.User, videoID string, days int) (code, id string) {
	f.t.Helper()
	rec := f.do("POST", "/api/shares", map[string]any{"videoId": videoID, "expiresInDays": days}, f.session(u))
	if rec.Code != http.StatusCreated {
		f.t.Fatalf("create share = %d %s", rec.Code, rec.Body)
	}
	var body struct {
		Code  string    `json:"code"`
		Share ShareView `json:"share"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return body.Code, body.Share.ID
}

func (f *fixture) public(path, code string, headers map[string]string) *httptest.ResponseRecorder {
	f.t.Helper()
	return f.do("GET", "/api/public/"+path+"?s="+code, nil, headers)
}

func errorCodeOf(rec *httptest.ResponseRecorder) string {
	var body struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return body.Code
}

func TestShareLinkWorksWithoutAnAccount(t *testing.T) {
	f := newFixture(t)
	id := f.publishClip()
	code, _ := f.share(f.viewer, id, 7)

	rec := f.public("share", code, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("public share = %d %s", rec.Code, rec.Body)
	}
	var meta PublicShare
	_ = json.Unmarshal(rec.Body.Bytes(), &meta)
	if meta.Title != "Beach day" || meta.Ext != ".mp4" || meta.Width != 720 || meta.ExpiresAt == nil {
		t.Errorf("public share = %+v", meta)
	}
	// Nothing that identifies the community, its members, or the file.
	for _, leak := range []string{id, "clip.mp4", f.owner.ID, f.viewer.ID, "viewer", "owner", "uploader"} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("public share leaks %q: %s", leak, rec.Body)
		}
	}

	rec = f.public("video", code, map[string]string{"Range": "bytes=100-199"})
	if rec.Code != http.StatusPartialContent || !bytes.Equal(rec.Body.Bytes(), f.content[100:200]) {
		t.Errorf("public video range = %d, %d bytes", rec.Code, rec.Body.Len())
	}

	rec = f.public("download", code, nil)
	disposition, params, _ := mime.ParseMediaType(rec.Header().Get("Content-Disposition"))
	if rec.Code != http.StatusOK || disposition != "attachment" || params["filename"] != "Beach day.mp4" ||
		!bytes.Equal(rec.Body.Bytes(), f.content) {
		t.Errorf("public download = %d, %q", rec.Code, rec.Header().Get("Content-Disposition"))
	}

	if rec := f.public("poster", code, nil); rec.Code != http.StatusOK || rec.Body.String() != "poster" {
		t.Errorf("public poster = %d", rec.Code)
	}

	// A share code is not a media token, and a media token is not a share code.
	if rec := f.do("GET", "/api/video/"+id+"?t="+code, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("share code as media token = %d", rec.Code)
	}
	target, _ := f.mediaURL(f.viewer, "")
	token := strings.SplitN(target, "?t=", 2)[1]
	if rec := f.public("video", token, nil); rec.Code != http.StatusNotFound {
		t.Errorf("media token as share code = %d", rec.Code)
	}
}

func TestManagingShareLinks(t *testing.T) {
	f := newFixture(t)
	id := f.publishClip()
	viewerCode, viewerShare := f.share(f.viewer, id, 1)
	_, ownerShare := f.share(f.owner, id, 0)

	if rec := f.do("POST", "/api/shares", map[string]any{"videoId": id, "expiresInDays": 3}, f.session(f.viewer)); rec.Code != http.StatusBadRequest {
		t.Errorf("3-day expiry = %d", rec.Code)
	}
	if rec := f.do("POST", "/api/shares", map[string]any{"videoId": "v-nope", "expiresInDays": 1}, f.session(f.viewer)); rec.Code != http.StatusNotFound {
		t.Errorf("unknown video = %d", rec.Code)
	}
	if rec := f.do("POST", "/api/shares", map[string]any{"videoId": id, "expiresInDays": 1}, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous create = %d", rec.Code)
	}

	list := func(u users.User) []ShareView {
		rec := f.do("GET", "/api/shares", nil, f.session(u))
		var body struct {
			Shares []ShareView `json:"shares"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return body.Shares
	}
	if got := list(f.viewer); len(got) != 1 || got[0].ID != viewerShare || got[0].Title != "Beach day" {
		t.Errorf("viewer's list = %+v", got)
	}
	if got := list(f.owner); len(got) != 2 {
		t.Errorf("owner's list = %+v", got)
	}

	if rec := f.do("DELETE", "/api/shares/"+ownerShare, nil, f.session(f.viewer)); rec.Code != http.StatusForbidden {
		t.Errorf("viewer stopping owner's link = %d", rec.Code)
	}
	if rec := f.do("DELETE", "/api/shares/"+viewerShare, nil, f.session(f.viewer)); rec.Code != http.StatusNoContent {
		t.Errorf("viewer stopping own link = %d", rec.Code)
	}
	rec := f.public("share", viewerCode, nil)
	if rec.Code != http.StatusNotFound || errorCodeOf(rec) != "share_not_found" {
		t.Errorf("stopped link = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("DELETE", "/api/shares/"+ownerShare, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Errorf("owner stopping a link = %d", rec.Code)
	}
}

func TestShareLinksDieWithTheirVideoOrMember(t *testing.T) {
	f := newFixture(t)
	id := f.publishClip()
	code, _ := f.share(f.viewer, id, 7)

	// Disabled creator: the link pauses with the account.
	disabled := true
	if _, err := f.users.Update(f.viewer.ID, users.Patch{Disabled: &disabled}); err != nil {
		t.Fatal(err)
	}
	if rec := f.public("video", code, nil); rec.Code != http.StatusNotFound {
		t.Errorf("link of disabled member = %d", rec.Code)
	}
	enabled := false
	if _, err := f.users.Update(f.viewer.ID, users.Patch{Disabled: &enabled}); err != nil {
		t.Fatal(err)
	}
	if rec := f.public("share", code, nil); rec.Code != http.StatusOK {
		t.Errorf("link after re-enabling = %d", rec.Code)
	}

	// Deleted member.
	if rec := f.do("DELETE", "/api/admin/users/"+f.viewer.ID, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete member = %d", rec.Code)
	}
	if rec := f.public("share", code, nil); rec.Code != http.StatusNotFound {
		t.Errorf("link of deleted member = %d", rec.Code)
	}

	// Deleted video.
	ownerCode, _ := f.share(f.owner, id, 0)
	if rec := f.do("DELETE", "/api/videos/"+id, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete video = %d", rec.Code)
	}
	if rec := f.public("share", ownerCode, nil); rec.Code != http.StatusNotFound {
		t.Errorf("link of deleted video = %d", rec.Code)
	}
	if len(f.srv.shares.List()) != 0 {
		t.Errorf("links left behind: %+v", f.srv.shares.List())
	}
}

func TestGuessingShareCodesIsLimited(t *testing.T) {
	f := newFixture(t)
	id := f.publishClip()
	code, _ := f.share(f.owner, id, 7)
	guesser := from("203.0.113.9:4000")

	for range 30 {
		if rec := f.public("share", "not-a-real-code-at-all", guesser); rec.Code != http.StatusNotFound {
			t.Fatalf("guess = %d", rec.Code)
		}
	}
	rec := f.public("share", code, guesser)
	if rec.Code != http.StatusTooManyRequests || errorCodeOf(rec) != "rate_limited" {
		t.Errorf("after 30 failures = %d %s", rec.Code, rec.Body)
	}
	if rec := f.public("share", code, from("198.51.100.7:4000")); rec.Code != http.StatusOK {
		t.Errorf("another address = %d", rec.Code)
	}
	// Working links do not use up the budget.
	viewer := from("198.51.100.8:4000")
	for range 40 {
		if rec := f.public("share", code, viewer); rec.Code != http.StatusOK {
			t.Fatalf("repeat viewing = %d", rec.Code)
		}
	}
}

func TestPublicStreamsAreCapped(t *testing.T) {
	f := newFixture(t)
	id := f.publishClip()
	code, _ := f.share(f.owner, id, 7)

	for range publicStreamSlots {
		f.srv.publicStreams <- struct{}{}
	}
	rec := f.public("video", code, nil)
	if rec.Code != http.StatusServiceUnavailable || errorCodeOf(rec) != "public_busy" {
		t.Errorf("stream over the cap = %d %s", rec.Code, rec.Body)
	}
	if rec := f.public("download", code, nil); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("download over the cap = %d", rec.Code)
	}
	// Metadata, posters, and members are not affected.
	if rec := f.public("share", code, nil); rec.Code != http.StatusOK {
		t.Errorf("metadata over the cap = %d", rec.Code)
	}
	target, headers := f.mediaURL(f.viewer, "")
	if rec := f.do("GET", target, nil, headers); rec.Code != http.StatusOK {
		t.Errorf("member stream while public is full = %d", rec.Code)
	}

	for range publicStreamSlots {
		<-f.srv.publicStreams
	}
	if rec := f.public("video", code, nil); rec.Code != http.StatusOK {
		t.Errorf("after streams end = %d", rec.Code)
	}
	if len(f.srv.publicStreams) != 0 {
		t.Error("a finished stream kept its slot")
	}
}
