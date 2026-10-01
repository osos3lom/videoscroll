package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/reactions"
)

func (f *fixture) reactions(sessionHeaders map[string]string) reactions.Lists {
	f.t.Helper()
	rec := f.do("GET", "/api/me/reactions", nil, sessionHeaders)
	if rec.Code != http.StatusOK {
		f.t.Fatalf("reactions = %d %s", rec.Code, rec.Body)
	}
	var lists reactions.Lists
	if err := json.Unmarshal(rec.Body.Bytes(), &lists); err != nil {
		f.t.Fatal(err)
	}
	return lists
}

func TestReactionsArePerMember(t *testing.T) {
	f := newFixture(t)
	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: id, FileName: "clip.mp4", Title: "clip", UploaderID: f.owner.ID})
	viewer := f.session(f.viewer)

	if rec := f.do("PUT", "/api/me/reactions/like/"+id, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("like without a session = %d", rec.Code)
	}
	if rec := f.do("PUT", "/api/me/reactions/like/"+id, nil, viewer); rec.Code != http.StatusNoContent {
		t.Fatalf("like = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("PUT", "/api/me/reactions/save/"+id, nil, viewer); rec.Code != http.StatusNoContent {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("PUT", "/api/me/reactions/love/"+id, nil, viewer); rec.Code != http.StatusNotFound {
		t.Errorf("unknown kind = %d", rec.Code)
	}
	if rec := f.do("PUT", "/api/me/reactions/like/v-bm9wZS5tcDQ", nil, viewer); rec.Code != http.StatusNotFound {
		t.Errorf("liking a video that does not exist = %d", rec.Code)
	}

	lists := f.reactions(viewer)
	if len(lists.Likes) != 1 || lists.Likes[0].MediaID != id || len(lists.Saves) != 1 {
		t.Errorf("viewer reactions = %+v", lists)
	}
	if other := f.reactions(f.session(f.owner)); len(other.Likes) != 0 {
		t.Errorf("owner sees the viewer's likes: %+v", other)
	}

	// The community count includes the like.
	var list VideosResponse
	_ = json.Unmarshal(f.do("GET", "/api/videos", nil, viewer).Body.Bytes(), &list)
	if list.Social[id].Likes != 1 || list.Social[id].Bookmarks != 1 {
		t.Errorf("social counts = %+v", list.Social[id])
	}

	if rec := f.do("DELETE", "/api/me/reactions/like/"+id, nil, viewer); rec.Code != http.StatusNoContent {
		t.Errorf("unlike = %d", rec.Code)
	}
	if lists := f.reactions(viewer); len(lists.Likes) != 0 || len(lists.Saves) != 1 {
		t.Errorf("after unlike = %+v", lists)
	}

	// Deleting the video removes it from everyone's saves.
	if rec := f.do("DELETE", "/api/videos/"+id, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete video = %d", rec.Code)
	}
	if f.srv.reactions.Has(f.viewer.ID, reactions.Save, id) {
		t.Error("save of a deleted video was kept")
	}
}

func TestReactionsImport(t *testing.T) {
	f := newFixture(t)
	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: id, FileName: "clip.mp4", Title: "clip"})
	viewer := f.session(f.viewer)

	body := map[string][]string{"likes": {id, "v-Z29uZS5tcDQ"}, "saves": {id}}
	rec := f.do("POST", "/api/me/reactions/import", body, viewer)
	if rec.Code != http.StatusOK || rec.Body.String() != "{\"imported\":2}\n" {
		t.Fatalf("import = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do("POST", "/api/me/reactions/import", body, viewer); rec.Body.String() != "{\"imported\":0}\n" {
		t.Errorf("second import = %s", rec.Body)
	}
	lists := f.reactions(viewer)
	if len(lists.Likes) != 1 || len(lists.Saves) != 1 {
		t.Errorf("after import = %+v", lists)
	}
}

func TestDeletingMemberForgetsReactions(t *testing.T) {
	f := newFixture(t)
	id := media.VideoID("clip.mp4")
	f.index.Add(media.Meta{VideoID: id, FileName: "clip.mp4", Title: "clip"})
	_ = f.do("PUT", "/api/me/reactions/like/"+id, nil, f.session(f.viewer))
	if rec := f.do("DELETE", "/api/admin/users/"+f.viewer.ID, nil, f.session(f.owner)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete member = %d", rec.Code)
	}
	if f.srv.reactions.Has(f.viewer.ID, reactions.Like, id) {
		t.Error("deleted member's like survived")
	}
}
