package collections

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func acceptAll(string) error { return nil }

func mediaIDs(c Collection) []string {
	out := make([]string, len(c.Items))
	for i, item := range c.Items {
		out[i] = item.MediaID
	}
	return out
}

func TestCreateEditAndPersist(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)

	if _, err := s.Create("u1", SectionCollections, "  ", "", ""); !errors.Is(err, ErrInvalidTitle) {
		t.Errorf("blank title: %v", err)
	}
	if _, err := s.Create("u1", "elsewhere", "Trips", "", ""); !errors.Is(err, ErrInvalidField) {
		t.Errorf("bad section: %v", err)
	}
	if _, err := s.Create("u1", SectionCollections, strings.Repeat("ع", 81), "", ""); !errors.Is(err, ErrInvalidTitle) {
		t.Errorf("long title: %v", err)
	}

	c, err := s.Create("u1", SectionCollections, " رحلات ", "صيف 2026", "")
	if err != nil {
		t.Fatal(err)
	}
	if c.Title != "رحلات" || c.Visibility != Private || c.Items == nil {
		t.Errorf("created = %+v", c)
	}

	c, added, err := s.AddItems(c.ID, []string{"v-a", "v-b", "v-a", "i-c"}, acceptAll)
	if err != nil || added != 3 {
		t.Fatalf("add: added=%d err=%v", added, err)
	}
	if _, again, _ := s.AddItems(c.ID, []string{"v-b"}, acceptAll); again != 0 {
		t.Error("the same media was added twice")
	}

	public := Public
	cover := c.Items[2].ID
	if _, err := s.Edit(c.ID, Patch{Visibility: &public, CoverItemID: &cover}); err != nil {
		t.Fatal(err)
	}
	bogus := "nope"
	if _, err := s.Edit(c.ID, Patch{CoverItemID: &bogus}); !errors.Is(err, ErrItemNotFound) {
		t.Errorf("cover not in collection: %v", err)
	}

	reloaded, ok := open(t, dir).Get(c.ID)
	if !ok || reloaded.Visibility != Public || len(reloaded.Items) != 3 || reloaded.CoverItemID != cover {
		t.Errorf("after reload = %+v", reloaded)
	}
}

func TestAcceptCanRefuse(t *testing.T) {
	s := open(t, t.TempDir())
	c, _ := s.Create("u1", SectionImages, "Photos", "", "")
	refuse := errors.New("not an image")
	_, _, err := s.AddItems(c.ID, []string{"i-ok", "v-video"}, func(id string) error {
		if strings.HasPrefix(id, "v-") {
			return refuse
		}
		return nil
	})
	if !errors.Is(err, refuse) {
		t.Fatalf("err = %v", err)
	}
	// All or nothing: the image before the refused video was not added.
	if got, _ := s.Get(c.ID); len(got.Items) != 0 {
		t.Errorf("partial add kept: %v", mediaIDs(got))
	}
}

func TestReorderMustBeAPermutation(t *testing.T) {
	s := open(t, t.TempDir())
	c, _ := s.Create("u1", SectionCollections, "Order", "", "")
	c, _, _ = s.AddItems(c.ID, []string{"v-a", "v-b", "v-c"}, acceptAll)
	a, b, cc := c.Items[0].ID, c.Items[1].ID, c.Items[2].ID

	for _, bad := range [][]string{{a, b}, {a, b, b}, {a, b, "x"}, {a, b, cc, cc}} {
		if _, err := s.Reorder(c.ID, bad); !errors.Is(err, ErrBadOrder) {
			t.Errorf("order %v: err = %v", bad, err)
		}
	}
	got, err := s.Reorder(c.ID, []string{cc, a, b})
	if err != nil {
		t.Fatal(err)
	}
	if ids := mediaIDs(got); strings.Join(ids, ",") != "v-c,v-a,v-b" {
		t.Errorf("order = %v", ids)
	}
}

func TestRemovingNeverTouchesMedia(t *testing.T) {
	dir := t.TempDir()
	mediaFile := filepath.Join(t.TempDir(), "video.mp4")
	_ = os.WriteFile(mediaFile, []byte("bytes"), 0o640)

	s := open(t, dir)
	c, _ := s.Create("u1", SectionCollections, "Keep", "", "")
	c, _, _ = s.AddItems(c.ID, []string{"v-a", "v-b"}, acceptAll)
	cover := c.Items[0].ID
	_, _ = s.Edit(c.ID, Patch{CoverItemID: &cover})

	c, err := s.RemoveItem(c.ID, cover)
	if err != nil || len(c.Items) != 1 || c.CoverItemID != "" {
		t.Fatalf("remove item: %+v %v", c, err)
	}
	if err := s.Delete(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get(c.ID); ok {
		t.Error("deleted collection still listed")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("files left in the collection directory: %v", entries)
	}
	if _, err := os.Stat(mediaFile); err != nil {
		t.Errorf("media file affected: %v", err)
	}
}

func TestRemoveMediaEverywhereAndListing(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	one, _ := s.Create("u1", SectionCollections, "One", "", "")
	two, _ := s.Create("u1", SectionImages, "Two", "", "")
	other, _ := s.Create("u2", SectionCollections, "Other", "", "")
	for _, c := range []Collection{one, two, other} {
		_, _, _ = s.AddItems(c.ID, []string{"x-gone", "x-stays"}, acceptAll)
	}
	if err := s.RemoveMedia("x-gone"); err != nil {
		t.Fatal(err)
	}
	reloaded := open(t, dir)
	for _, c := range []Collection{one, two, other} {
		got, _ := reloaded.Get(c.ID)
		if ids := mediaIDs(got); len(ids) != 1 || ids[0] != "x-stays" {
			t.Errorf("%s items = %v", c.Title, ids)
		}
	}

	if got := s.ListByOwner("u1", SectionImages); len(got) != 1 || got[0].ID != two.ID {
		t.Errorf("u1 images = %+v", got)
	}
	if got := s.ListByOwner("u1", ""); len(got) != 2 {
		t.Errorf("u1 all = %d", len(got))
	}

	if err := s.DeleteByOwner("u1"); err != nil {
		t.Fatal(err)
	}
	if len(s.ListByOwner("u1", "")) != 0 || len(s.ListByOwner("u2", "")) != 1 {
		t.Error("DeleteByOwner removed the wrong collections")
	}
}

func TestResetShareBumpsGeneration(t *testing.T) {
	s := open(t, t.TempDir())
	c, _ := s.Create("u1", SectionCollections, "Share", "", Public)
	got, err := s.ResetShare(c.ID)
	if err != nil || got.ShareGen != c.ShareGen+1 {
		t.Errorf("reset: %+v %v", got, err)
	}
}
