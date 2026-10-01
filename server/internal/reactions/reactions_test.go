package reactions

import (
	"testing"
)

func open(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func ids(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.MediaID
	}
	return out
}

func TestSetIsIdempotentAndPersists(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)

	for _, id := range []string{"v-a", "v-b", "v-a"} {
		if err := s.Set("u1", Like, id, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Set("u1", Save, "v-b", true); err != nil {
		t.Fatal(err)
	}
	if err := s.Set("u1", Save, "v-missing", false); err != nil {
		t.Fatal(err)
	}

	lists := open(t, dir).List("u1")
	if got := ids(lists.Likes); len(got) != 2 || got[0] != "v-b" || got[1] != "v-a" {
		t.Errorf("likes after reload = %v, want newest first [v-b v-a]", got)
	}
	if got := ids(lists.Saves); len(got) != 1 || got[0] != "v-b" {
		t.Errorf("saves = %v", got)
	}

	if err := s.Set("u1", Like, "v-b", false); err != nil {
		t.Fatal(err)
	}
	if s.Has("u1", Like, "v-b") || !s.Has("u1", Like, "v-a") {
		t.Errorf("unlike removed the wrong entry: %v", ids(s.List("u1").Likes))
	}
}

func TestUsersAreSeparate(t *testing.T) {
	s := open(t, t.TempDir())
	_ = s.Set("u1", Like, "v-a", true)
	if s.Has("u2", Like, "v-a") || len(s.List("u2").Likes) != 0 {
		t.Error("one member's like leaked to another")
	}
	if s.List("nobody").Likes == nil {
		t.Error("empty list must not be nil")
	}
}

func TestImportMergesAndFilters(t *testing.T) {
	s := open(t, t.TempDir())
	_ = s.Set("u1", Like, "v-a", true)
	accept := func(id string) bool { return id != "v-gone" }

	added, err := s.Import("u1", []string{"v-a", "v-b", "v-gone", "v-b", ""}, []string{"v-c"}, accept)
	if err != nil {
		t.Fatal(err)
	}
	if added != 2 {
		t.Errorf("added = %d, want 2 (v-b like, v-c save)", added)
	}
	again, _ := s.Import("u1", []string{"v-a", "v-b"}, []string{"v-c"}, accept)
	if again != 0 {
		t.Errorf("second import added %d", again)
	}
	if got := ids(s.List("u1").Likes); len(got) != 2 {
		t.Errorf("likes = %v", got)
	}
}

func TestRemoveMediaAndCounts(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	_ = s.Set("u1", Like, "v-a", true)
	_ = s.Set("u2", Like, "v-a", true)
	_ = s.Set("u2", Save, "v-a", true)
	_ = s.Set("u2", Save, "v-b", true)

	if c := s.Counts()["v-a"]; c.Likes != 2 || c.Saves != 1 {
		t.Errorf("counts = %+v", c)
	}
	if err := s.RemoveMedia("v-a"); err != nil {
		t.Fatal(err)
	}
	reloaded := open(t, dir)
	if _, ok := reloaded.Counts()["v-a"]; ok {
		t.Error("removed media still counted after reload")
	}
	if !reloaded.Has("u2", Save, "v-b") {
		t.Error("unrelated save lost")
	}

	if err := s.DeleteUser("u2"); err != nil {
		t.Fatal(err)
	}
	if open(t, dir).Has("u2", Save, "v-b") {
		t.Error("deleted user's reactions survived")
	}
}

func TestRejectsPathLikeUserIDs(t *testing.T) {
	s := open(t, t.TempDir())
	if err := s.Set("../evil", Like, "v-a", true); err != ErrInvalid {
		t.Errorf("Set with traversal id = %v", err)
	}
}
