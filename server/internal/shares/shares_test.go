package shares

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func open(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "shares.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	return s, path
}

func TestCreateLookupAndPersistence(t *testing.T) {
	s, path := open(t)
	code, share, err := s.Create("v-abc", "u1", 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 22 || share.ExpiresAt == nil {
		t.Fatalf("code %q, share %+v", code, share)
	}

	got, err := s.Lookup(" " + code + " ")
	if err != nil || got.ID != share.ID {
		t.Fatalf("Lookup = %+v, %v", got, err)
	}
	if _, err := s.Lookup(code + "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("wrong code: %v", err)
	}
	if _, err := s.Lookup(""); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty code: %v", err)
	}

	// The code itself never reaches the disk.
	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), code) {
		t.Error("plaintext code written to disk")
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Lookup(code); err != nil {
		t.Errorf("after reopen: %v", err)
	}
}

func TestNoExpiry(t *testing.T) {
	s, _ := open(t)
	code, share, _ := s.Create("v-abc", "u1", 0)
	if share.ExpiresAt != nil {
		t.Fatal("ttl 0 must mean no expiry")
	}
	if _, err := s.Lookup(code); err != nil {
		t.Fatal(err)
	}
}

func TestExpiredLinksStopWorkingAndArePruned(t *testing.T) {
	s, _ := open(t)
	code, share, _ := s.Create("v-abc", "u1", time.Hour)
	past := time.Now().Add(-time.Minute)
	s.data.Shares[0].ExpiresAt = &past

	if _, err := s.Lookup(code); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired lookup: %v", err)
	}
	if len(s.List()) != 0 {
		t.Error("expired link listed")
	}
	if err := s.Prune(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get(share.ID); ok {
		t.Error("expired link not pruned")
	}
}

func TestDeletes(t *testing.T) {
	s, _ := open(t)
	a, shareA, _ := s.Create("v-1", "u1", 0)
	b, _, _ := s.Create("v-2", "u1", 0)
	c, _, _ := s.Create("v-2", "u2", 0)
	d, _, _ := s.Create("v-3", "u2", 0)

	if err := s.Delete(shareA.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(shareA.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
	if err := s.DeleteForVideo("v-2"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteByUser("u2"); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{a, b, c, d} {
		if _, err := s.Lookup(code); !errors.Is(err, ErrNotFound) {
			t.Errorf("link %s still works", code)
		}
	}
}
