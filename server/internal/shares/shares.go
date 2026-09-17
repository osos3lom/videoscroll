// Package shares stores public links to single videos.
//
// A share link is the only way a person without an account reaches any
// community content, so the store keeps it narrow: one video per link, only
// the SHA-256 of the code on disk, and an optional expiry. Whether the video
// and the member who shared it still exist is checked by the caller on every
// request.
package shares

import (
	"crypto/subtle"
	"errors"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/store"
)

type Share struct {
	ID        string    `json:"id"`
	CodeHash  string    `json:"codeHash"`
	VideoID   string    `json:"videoId"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	// Nil means the link works until someone stops it.
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

// Expired reports whether the link has passed its expiry at now.
func (s Share) Expired(now time.Time) bool {
	return s.ExpiresAt != nil && !now.Before(*s.ExpiresAt)
}

var ErrNotFound = errors.New("share link not found")

type fileData struct {
	Shares []Share `json:"shares"`
}

type Store struct {
	path string
	mu   sync.RWMutex
	data fileData
}

// Open loads path, or starts empty when it does not exist yet.
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	if _, err := store.ReadJSON(path, &s.data); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	return store.WriteJSON(s.path, s.data, 0o600)
}

// Create returns the plaintext code exactly once. A ttl of zero or less
// means no expiry.
func (s *Store) Create(videoID, userID string, ttl time.Duration) (string, Share, error) {
	code := auth.NewCode()
	now := time.Now().UTC()
	share := Share{
		ID:        auth.NewID(),
		CodeHash:  auth.HashCode(code),
		VideoID:   videoID,
		CreatedBy: userID,
		CreatedAt: now,
	}
	if ttl > 0 {
		expires := now.Add(ttl)
		share.ExpiresAt = &expires
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Shares = append(s.data.Shares, share)
	if err := s.saveLocked(); err != nil {
		s.data.Shares = s.data.Shares[:len(s.data.Shares)-1]
		return "", Share{}, err
	}
	return code, share, nil
}

// Lookup finds the unexpired share for a code.
func (s *Store) Lookup(code string) (Share, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return Share{}, ErrNotFound
	}
	hash := []byte(auth.HashCode(code))
	now := time.Now()

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, share := range s.data.Shares {
		if subtle.ConstantTimeCompare([]byte(share.CodeHash), hash) == 1 {
			if share.Expired(now) {
				return Share{}, ErrNotFound
			}
			return share, nil
		}
	}
	return Share{}, ErrNotFound
}

func (s *Store) Get(id string) (Share, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, share := range s.data.Shares {
		if share.ID == id {
			return share, true
		}
	}
	return Share{}, false
}

// List is newest first and leaves out expired links.
func (s *Store) List() []Share {
	now := time.Now()
	s.mu.RLock()
	list := make([]Share, 0, len(s.data.Shares))
	for _, share := range s.data.Shares {
		if !share.Expired(now) {
			list = append(list, share)
		}
	}
	s.mu.RUnlock()
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.After(list[j].CreatedAt) })
	return list
}

// Delete stops one link.
func (s *Store) Delete(id string) error {
	removed, err := s.removeWhere(func(share Share) bool { return share.ID == id })
	if err == nil && removed == 0 {
		return ErrNotFound
	}
	return err
}

// DeleteForVideo stops every link to a video, e.g. when it is deleted.
func (s *Store) DeleteForVideo(videoID string) error {
	_, err := s.removeWhere(func(share Share) bool { return share.VideoID == videoID })
	return err
}

// DeleteByUser stops every link a member created, e.g. when they are deleted.
func (s *Store) DeleteByUser(userID string) error {
	_, err := s.removeWhere(func(share Share) bool { return share.CreatedBy == userID })
	return err
}

// Prune drops expired links from the file.
func (s *Store) Prune() error {
	now := time.Now()
	_, err := s.removeWhere(func(share Share) bool { return share.Expired(now) })
	return err
}

func (s *Store) removeWhere(match func(Share) bool) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]Share, 0, len(s.data.Shares))
	for _, share := range s.data.Shares {
		if !match(share) {
			kept = append(kept, share)
		}
	}
	removed := len(s.data.Shares) - len(kept)
	if removed == 0 {
		return 0, nil
	}
	previous := s.data.Shares
	s.data.Shares = kept
	if err := s.saveLocked(); err != nil {
		s.data.Shares = previous
		return 0, err
	}
	return removed, nil
}
