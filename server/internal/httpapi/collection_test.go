package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// addImage publishes an image file owned by uploaderID straight into the
// fixture's image index.
func (f *fixture) addImage(name, uploaderID string) (string, []byte) {
	f.t.Helper()
	data := []byte("\xFF\xD8\xFF fake jpeg bytes for " + name)
	if err := os.WriteFile(filepath.Join(f.layout.Images, name), data, 0o640); err != nil {
		f.t.Fatal(err)
	}
	id := media.ImageID(name)
	f.srv.images.Add(media.Meta{VideoID: id, Kind: media.KindImage, FileName: name, Title: name, UploaderID: uploaderID, Width: 4, Height: 3})
	return id, data
}

func (f *fixture) mediaToken(u users.User) string {
	current, _ := f.users.Get(u.ID)
	token, _ := f.signer.IssueMedia(current.ID, current.Ver)
	return token
}

func decode[T any](t *testing.T, body *bytes.Buffer) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return v
}

func TestImagesArePrivateToTheirUploader(t *testing.T) {
	f := newFixture(t)
	uploader, _ := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	mine, data := f.addImage("mine.jpg", uploader.ID)

	// Listing: the uploader sees it, another member does not.
	list := decode[ImagesResponse](t, f.do("GET", "/api/images", nil, f.session(uploader)).Body)
	if len(list.Data) != 1 || list.Data[0].VideoID != mine {
		t.Errorf("uploader's images = %+v", list.Data)
	}
	if other := decode[ImagesResponse](t, f.do("GET", "/api/images", nil, f.session(f.viewer)).Body); len(other.Data) != 0 {
		t.Errorf("viewer sees someone else's images: %+v", other.Data)
	}
	// The owner sees all of them only when asking for all.
	if all := decode[ImagesResponse](t, f.do("GET", "/api/images?all=1", nil, f.session(f.owner)).Body); len(all.Data) != 1 {
		t.Errorf("owner ?all=1 = %+v", all.Data)
	}

	// Bytes: the uploader's media token works; another member's does not.
	rec := f.do("GET", "/api/image/"+mine+"?t="+f.mediaToken(uploader), nil, nil)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), data) || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("uploader image = %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	for _, target := range []string{"/api/image/" + mine, "/api/image-thumb/" + mine} {
		if rec := f.do("GET", target+"?t="+f.mediaToken(f.viewer), nil, nil); rec.Code != http.StatusNotFound {
			t.Errorf("viewer %s = %d, want 404", target, rec.Code)
		}
		if rec := f.do("GET", target, nil, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("no token %s = %d, want 401", target, rec.Code)
		}
	}
	// A thumbnail that is missing falls back to the original.
	if rec := f.do("GET", "/api/image-thumb/"+mine+"?t="+f.mediaToken(uploader), nil, nil); rec.Code != http.StatusOK {
		t.Errorf("thumb fallback = %d", rec.Code)
	}

	// No video route serves an image.
	if rec := f.do("GET", "/api/video/"+mine+"?t="+f.mediaToken(uploader), nil, nil); rec.Code != http.StatusNotFound {
		t.Errorf("image through the video route = %d", rec.Code)
	}

	// Likes: another member cannot react to it either.
	if rec := f.do("PUT", "/api/me/reactions/like/"+mine, nil, f.session(f.viewer)); rec.Code != http.StatusNotFound {
		t.Errorf("viewer liking a private image = %d", rec.Code)
	}
	if rec := f.do("PUT", "/api/me/reactions/save/"+mine, nil, f.session(uploader)); rec.Code != http.StatusNoContent {
		t.Errorf("uploader saving own image = %d", rec.Code)
	}

	// Delete: only the uploader (or the owner).
	if rec := f.do("DELETE", "/api/images/"+mine, nil, f.session(f.viewer)); rec.Code != http.StatusNotFound {
		t.Errorf("viewer delete = %d", rec.Code)
	}
	if rec := f.do("DELETE", "/api/images/"+mine, nil, f.session(uploader)); rec.Code != http.StatusNoContent {
		t.Errorf("uploader delete = %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(f.layout.Images, "mine.jpg")); !os.IsNotExist(err) {
		t.Error("deleted image file still on disk")
	}
}

type collectionBody struct {
	Collection CollectionView `json:"collection"`
}

func (f *fixture) createCollection(u users.User, body map[string]any) CollectionView {
	f.t.Helper()
	rec := f.do("POST", "/api/collections", body, f.session(u))
	if rec.Code != http.StatusCreated {
		f.t.Fatalf("create collection = %d %s", rec.Code, rec.Body)
	}
	return decode[collectionBody](f.t, rec.Body).Collection
}

func TestCollectionsBelongToTheirOwner(t *testing.T) {
	f := newFixture(t)
	video := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: video, FileName: "clip.mp4", Title: "clip", UploaderID: f.owner.ID})
	uploader, _ := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	image, _ := f.addImage("photo.jpg", uploader.ID)

	// A viewer collects community videos.
	c := f.createCollection(f.viewer, map[string]any{"title": "مفضلتي", "mediaIds": []string{video}})
	if c.ItemCount != 1 || c.VideoCount != 1 || c.Visibility != "private" || c.ShareCode != "" {
		t.Fatalf("created = %+v", c)
	}

	// ...but not someone else's private image.
	rec := f.do("POST", "/api/collections/"+c.ID+"/items", map[string]any{"mediaIds": []string{image}}, f.session(f.viewer))
	if rec.Code != http.StatusNotFound {
		t.Errorf("adding another member's image = %d", rec.Code)
	}
	rec = f.do("POST", "/api/collections", map[string]any{"title": "x", "mediaIds": []string{image}}, f.session(f.viewer))
	if rec.Code != http.StatusNotFound || len(f.srv.collections.ListByOwner(f.viewer.ID, "")) != 1 {
		t.Errorf("create with a forbidden image = %d, and it must create nothing", rec.Code)
	}

	// Image categories take images only.
	rec = f.do("POST", "/api/collections", map[string]any{"section": "images", "title": "صور", "mediaIds": []string{video}}, f.session(uploader))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("video in an image category = %d", rec.Code)
	}
	cat := f.createCollection(uploader, map[string]any{"section": "images", "title": "صور", "mediaIds": []string{image}})
	if cat.ImageCount != 1 {
		t.Errorf("category = %+v", cat)
	}

	// Nobody else can read, change, share or delete it: always 404.
	for _, req := range []struct{ method, path string }{
		{"GET", "/api/collections/" + c.ID},
		{"PATCH", "/api/collections/" + c.ID},
		{"DELETE", "/api/collections/" + c.ID},
		{"POST", "/api/collections/" + c.ID + "/items"},
		{"PUT", "/api/collections/" + c.ID + "/order"},
		{"POST", "/api/collections/" + c.ID + "/share/reset"},
	} {
		rec := f.do(req.method, req.path, map[string]any{"title": "hijack", "visibility": "public"}, f.session(uploader))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s by another member = %d, want 404", req.method, req.path, rec.Code)
		}
	}
	if list := decode[collectionsResponse](t, f.do("GET", "/api/collections", nil, f.session(uploader)).Body); len(list.Collections) != 1 {
		t.Errorf("uploader lists %d collections, want only their own", len(list.Collections))
	}

	// Deleting the collection leaves the video alone.
	if rec := f.do("DELETE", "/api/collections/"+c.ID, nil, f.session(f.viewer)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", rec.Code)
	}
	if _, ok := f.index.Get(video); !ok {
		t.Error("deleting a collection removed its video from the index")
	}
	if _, err := os.Stat(filepath.Join(f.layout.Videos, "clip.mp4")); err != nil {
		t.Errorf("deleting a collection touched the video file: %v", err)
	}

	// Deleting the image removes it from the category.
	_ = f.do("DELETE", "/api/images/"+image, nil, f.session(uploader))
	if got := decode[collectionBody](t, f.do("GET", "/api/collections/"+cat.ID, nil, f.session(uploader)).Body); got.Collection.ItemCount != 0 {
		t.Errorf("category still lists a deleted image: %+v", got.Collection)
	}
}

func TestCollectionEditAndReorder(t *testing.T) {
	f := newFixture(t)
	uploader, _ := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	a, _ := f.addImage("a.jpg", uploader.ID)
	b, _ := f.addImage("b.jpg", uploader.ID)
	cc, _ := f.addImage("c.jpg", uploader.ID)
	c := f.createCollection(uploader, map[string]any{"title": "Order", "mediaIds": []string{a, b, cc}})
	auth := f.session(uploader)

	order := []string{c.Items[2].ID, c.Items[0].ID, c.Items[1].ID}
	rec := f.do("PUT", "/api/collections/"+c.ID+"/order", map[string]any{"itemIds": order}, auth)
	got := decode[collectionBody](t, rec.Body).Collection
	if rec.Code != http.StatusOK || got.Items[0].MediaID != cc || got.Items[2].MediaID != b {
		t.Fatalf("reorder = %d %+v", rec.Code, got.Items)
	}
	if rec := f.do("PUT", "/api/collections/"+c.ID+"/order", map[string]any{"itemIds": order[:2]}, auth); rec.Code != http.StatusBadRequest {
		t.Errorf("partial order = %d", rec.Code)
	}

	rec = f.do("PATCH", "/api/collections/"+c.ID, map[string]any{"title": "Renamed", "description": "d", "coverItemId": c.Items[1].ID}, auth)
	got = decode[collectionBody](t, rec.Body).Collection
	if rec.Code != http.StatusOK || got.Title != "Renamed" || got.Cover == nil || got.Cover.MediaID != b {
		t.Errorf("patch = %d %+v", rec.Code, got)
	}

	rec = f.do("DELETE", "/api/collections/"+c.ID+"/items/"+c.Items[1].ID, nil, auth)
	got = decode[collectionBody](t, rec.Body).Collection
	if rec.Code != http.StatusOK || got.ItemCount != 2 || got.Cover == nil || got.Cover.MediaID == b {
		t.Errorf("remove item = %d %+v", rec.Code, got)
	}
	if _, ok := f.srv.images.Get(b); !ok {
		t.Error("removing an item deleted the image")
	}
}

func TestPublicCollectionLink(t *testing.T) {
	f := newFixture(t)
	video := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: video, FileName: "clip.mp4", Title: "clip", Width: 1080, Height: 1920, Duration: 3})
	uploader, _ := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	image, imageBytes := f.addImage("photo.jpg", uploader.ID)
	auth := f.session(uploader)

	c := f.createCollection(uploader, map[string]any{"title": "رحلة", "description": "صيف", "mediaIds": []string{video, image}})
	public := func(code string) *bytes.Buffer {
		return f.do("GET", "/api/public/collection?s="+url.QueryEscape(code), nil, from("198.51.100.1:1")).Body
	}

	// Private: there is no code, and a forged one does not work.
	forged := c.ID + ".AAAAAAAAAAAAAAAAAAAAAA"
	if rec := f.do("GET", "/api/public/collection?s="+forged, nil, from("198.51.100.1:1")); rec.Code != http.StatusNotFound {
		t.Errorf("forged code = %d", rec.Code)
	}

	rec := f.do("PATCH", "/api/collections/"+c.ID, map[string]any{"visibility": "public"}, auth)
	shared := decode[collectionBody](t, rec.Body).Collection
	if shared.ShareCode == "" {
		t.Fatalf("public collection has no code: %+v", shared)
	}

	body := public(shared.ShareCode)
	view := decode[PublicCollection](t, body)
	if view.Title != "رحلة" || len(view.Items) != 2 || view.Items[0].Kind != "video" || view.Items[1].Kind != "image" {
		t.Fatalf("public view = %s", body)
	}
	// Nothing about the community: no media ids, file names or users.
	for _, leak := range []string{"videoId", "mediaId", "fileName", "uploader", "owner", video, image, uploader.ID, "clip.mp4"} {
		if strings.Contains(body.String(), leak) {
			t.Errorf("public collection leaks %q: %s", leak, body)
		}
	}

	item := func(i int, kind string) *httptest.ResponseRecorder {
		target := "/api/public/collection/" + kind + "?s=" + url.QueryEscape(shared.ShareCode) + "&i=" + view.Items[i].Key
		return f.do("GET", target, nil, from("198.51.100.1:1"))
	}
	if rec := item(0, "media"); rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), f.content) {
		t.Errorf("public video = %d", rec.Code)
	}
	if rec := item(1, "media"); rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), imageBytes) {
		t.Errorf("public image = %d", rec.Code)
	}
	if rec := item(1, "poster"); rec.Code != http.StatusOK {
		t.Errorf("public image poster = %d", rec.Code)
	}

	// Video bytes take a public stream slot: none free, no bytes.
	for range publicStreamSlots {
		f.srv.publicStreams <- struct{}{}
	}
	if rec := item(0, "media"); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("video with no free slot = %d", rec.Code)
	}
	for range publicStreamSlots {
		<-f.srv.publicStreams
	}

	// Resetting the link kills the old code.
	rec = f.do("POST", "/api/collections/"+c.ID+"/share/reset", nil, auth)
	fresh := decode[collectionBody](t, rec.Body).Collection
	if fresh.ShareCode == shared.ShareCode || fresh.ShareCode == "" {
		t.Fatalf("reset did not change the code")
	}
	if rec := f.do("GET", "/api/public/collection?s="+url.QueryEscape(shared.ShareCode), nil, from("198.51.100.1:1")); rec.Code != http.StatusNotFound {
		t.Errorf("old code after reset = %d", rec.Code)
	}

	// Making it private again, or disabling the owner, closes it.
	_ = f.do("PATCH", "/api/collections/"+c.ID, map[string]any{"visibility": "private"}, auth)
	if rec := f.do("GET", "/api/public/collection?s="+url.QueryEscape(fresh.ShareCode), nil, from("198.51.100.1:1")); rec.Code != http.StatusNotFound {
		t.Errorf("private collection by link = %d", rec.Code)
	}
	_ = f.do("PATCH", "/api/collections/"+c.ID, map[string]any{"visibility": "public"}, auth)
	if rec := f.do("GET", "/api/public/collection?s="+url.QueryEscape(fresh.ShareCode), nil, from("198.51.100.1:1")); rec.Code != http.StatusOK {
		t.Errorf("public again = %d", rec.Code)
	}
	disabled := true
	if _, err := f.users.Update(uploader.ID, users.Patch{Disabled: &disabled}); err != nil {
		t.Fatal(err)
	}
	if rec := f.do("GET", "/api/public/collection?s="+url.QueryEscape(fresh.ShareCode), nil, from("198.51.100.1:1")); rec.Code != http.StatusNotFound {
		t.Errorf("disabled owner's collection = %d", rec.Code)
	}
}

func TestPublicCollectionGuessesAreLimited(t *testing.T) {
	f := newFixture(t)
	var last int
	for range 40 {
		last = f.do("GET", "/api/public/collection?s=abcdefghijkl.guess", nil, from("203.0.113.5:1")).Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("after 40 guesses = %d, want 429", last)
	}
}

// The owner role cannot publish another member's private photo.
func TestOwnersPublicCollectionOmitsOthersImages(t *testing.T) {
	f := newFixture(t)
	uploader, _ := f.users.Create("uploader", "uploader-password", users.RoleUploader)
	image, _ := f.addImage("private.jpg", uploader.ID)
	c := f.createCollection(f.owner, map[string]any{"title": "Admin", "visibility": "public", "mediaIds": []string{image}})
	view := decode[PublicCollection](t, f.do("GET", "/api/public/collection?s="+url.QueryEscape(c.ShareCode), nil, nil).Body)
	if len(view.Items) != 0 {
		t.Errorf("owner published another member's image: %+v", view.Items)
	}
}
