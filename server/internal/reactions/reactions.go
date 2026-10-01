// Package reactions stores each member's likes and saves.
//
// One small JSON file per user, data/reactions/<userId>.json, held in memory
// and rewritten atomically on every change. A member's reactions reference
// media ids only; deleting a reaction never touches the media.
package reactions

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/store"
)

type Kind string

const (
	Like Kind = "like"
	Save Kind = "save"
)

func ParseKind(s string) (Kind, bool) {
	switch Kind(s) {
	case Like, Save:
		return Kind(s), true
	}
	return "", false
}

// MaxPerKind bounds one member's likes or saves, so a runaway client cannot
// grow a file without limit.
const MaxPerKind = 20000

type Entry struct {
	MediaID string    `json:"mediaId"`
	At      time.Time `json:"at"`
}

// Lists is mirrored by `Reactions` in src/types/api.ts. Newest first.
type Lists struct {
	Likes []Entry `json:"likes"`
	Saves []Entry `json:"saves"`
}

var (
	ErrLimit   = errors.New("too many likes or saves")
	ErrInvalid = errors.New("invalid media id")
)

// Store keeps every user's lists, oldest first internally.
type Store struct {
	dir string

	mu     sync.RWMutex
	byUser map[string]*Lists
}

var userIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Open loads every file in dir, creating dir if needed.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, byUser: map[string]*Lists{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".json") {
			continue
		}
		var lists Lists
		if _, err := store.ReadJSON(filepath.Join(dir, name), &lists); err != nil {
			return nil, err
		}
		s.byUser[strings.TrimSuffix(name, ".json")] = &lists
	}
	return s, nil
}

func (s *Store) path(userID string) string {
	return filepath.Join(s.dir, filepath.Base(userID)+".json")
}

func (s *Store) saveLocked(userID string, lists *Lists) error {
	return store.WriteJSON(s.path(userID), lists, 0o600)
}

func (l *Lists) list(kind Kind) *[]Entry {
	if kind == Like {
		return &l.Likes
	}
	return &l.Saves
}

func clone(entries []Entry) []Entry {
	out := make([]Entry, len(entries))
	for i, e := range entries {
		out[len(entries)-1-i] = e
	}
	return out
}

// List returns a user's likes and saves, newest first. Never nil slices.
func (s *Store) List(userID string) Lists {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lists, ok := s.byUser[userID]
	if !ok {
		return Lists{Likes: []Entry{}, Saves: []Entry{}}
	}
	return Lists{Likes: clone(lists.Likes), Saves: clone(lists.Saves)}
}

// Has reports whether userID has reacted to mediaID with kind.
func (s *Store) Has(userID string, kind Kind, mediaID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lists, ok := s.byUser[userID]
	if !ok {
		return false
	}
	for _, e := range *lists.list(kind) {
		if e.MediaID == mediaID {
			return true
		}
	}
	return false
}

// Set adds (on) or removes a reaction. Both directions are idempotent.
func (s *Store) Set(userID string, kind Kind, mediaID string, on bool) error {
	if !userIDPattern.MatchString(userID) {
		return ErrInvalid
	}
	if mediaID == "" {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	lists, ok := s.byUser[userID]
	if !ok {
		lists = &Lists{Likes: []Entry{}, Saves: []Entry{}}
	}
	target := lists.list(kind)
	previous := *target
	index := -1
	for i, e := range previous {
		if e.MediaID == mediaID {
			index = i
			break
		}
	}

	switch {
	case on && index >= 0, !on && index < 0:
		return nil
	case on:
		if len(previous) >= MaxPerKind {
			return ErrLimit
		}
		next := make([]Entry, len(previous), len(previous)+1)
		copy(next, previous)
		*target = append(next, Entry{MediaID: mediaID, At: time.Now().UTC()})
	default:
		next := make([]Entry, 0, len(previous)-1)
		next = append(next, previous[:index]...)
		*target = append(next, previous[index+1:]...)
	}

	if err := s.saveLocked(userID, lists); err != nil {
		*target = previous
		return err
	}
	s.byUser[userID] = lists
	return nil
}

// Import merges ids a device kept locally before reactions lived on the
// server. Ids already present are skipped, so importing twice is harmless.
// accept filters out ids the caller may not react to.
func (s *Store) Import(userID string, likes, saves []string, accept func(string) bool) (int, error) {
	if !userIDPattern.MatchString(userID) {
		return 0, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	lists, ok := s.byUser[userID]
	if !ok {
		lists = &Lists{Likes: []Entry{}, Saves: []Entry{}}
	}
	previous := Lists{Likes: lists.Likes, Saves: lists.Saves}
	now := time.Now().UTC()
	added := 0

	merge := func(kind Kind, ids []string) {
		target := lists.list(kind)
		seen := make(map[string]bool, len(*target))
		for _, e := range *target {
			seen[e.MediaID] = true
		}
		next := make([]Entry, len(*target), len(*target)+len(ids))
		copy(next, *target)
		for _, id := range ids {
			if id == "" || seen[id] || len(next) >= MaxPerKind || !accept(id) {
				continue
			}
			seen[id] = true
			next = append(next, Entry{MediaID: id, At: now})
			added++
		}
		*target = next
	}
	merge(Like, likes)
	merge(Save, saves)

	if added == 0 {
		return 0, nil
	}
	if err := s.saveLocked(userID, lists); err != nil {
		lists.Likes, lists.Saves = previous.Likes, previous.Saves
		return 0, err
	}
	s.byUser[userID] = lists
	return added, nil
}

// RemoveMedia drops every reaction to mediaID, e.g. when it is deleted.
func (s *Store) RemoveMedia(mediaID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var firstErr error
	for userID, lists := range s.byUser {
		changed := false
		for _, kind := range []Kind{Like, Save} {
			target := lists.list(kind)
			kept := make([]Entry, 0, len(*target))
			for _, e := range *target {
				if e.MediaID != mediaID {
					kept = append(kept, e)
				}
			}
			if len(kept) != len(*target) {
				*target = kept
				changed = true
			}
		}
		if changed {
			if err := s.saveLocked(userID, lists); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// DeleteUser forgets a member's reactions, e.g. when the account is deleted.
func (s *Store) DeleteUser(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byUser, userID)
	err := os.Remove(s.path(userID))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Count is how many members reacted to one media item.
type Count struct {
	Likes int `json:"likes"`
	Saves int `json:"saves"`
}

// Counts totals every member's reactions per media id.
func (s *Store) Counts() map[string]Count {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]Count{}
	for _, lists := range s.byUser {
		for _, e := range lists.Likes {
			c := out[e.MediaID]
			c.Likes++
			out[e.MediaID] = c
		}
		for _, e := range lists.Saves {
			c := out[e.MediaID]
			c.Saves++
			out[e.MediaID] = c
		}
	}
	return out
}
