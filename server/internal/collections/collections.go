// Package collections stores members' collections: ordered lists that
// reference published videos and images by id.
//
// A collection never owns media. Deleting a collection, or removing an item
// from it, deletes only the reference; the video or image is untouched.
//
// One JSON file per collection, data/collections/<id>.json, all held in
// memory. An edit rewrites one small file, however many collections exist.
package collections

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/store"
)

const (
	// SectionCollections holds videos and images; SectionImages, the image
	// categories shown under /images, holds images only.
	SectionCollections = "collections"
	SectionImages      = "images"

	Private = "private"
	Public  = "public"

	MaxItems         = 2000
	MaxPerOwner      = 500
	MaxTitleRunes    = 80
	MaxDescription   = 500
	MaxItemsPerWrite = 200
)

type Item struct {
	// ID is random and local to the collection. Public links address items
	// by it, so they never reveal a media id.
	ID      string    `json:"id"`
	MediaID string    `json:"mediaId"`
	AddedAt time.Time `json:"addedAt"`
}

type Collection struct {
	ID          string `json:"id"`
	OwnerID     string `json:"ownerId"`
	Section     string `json:"section"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	// CoverItemID names the item whose poster is the cover; empty means the
	// first item.
	CoverItemID string `json:"coverItemId,omitempty"`
	Visibility  string `json:"visibility"`
	// ShareGen is mixed into the public link. Bumping it kills every link
	// handed out before.
	ShareGen  int       `json:"shareGen"`
	Items     []Item    `json:"items"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (c Collection) clone() Collection {
	c.Items = slices.Clone(c.Items)
	if c.Items == nil {
		c.Items = []Item{}
	}
	return c
}

// Cover is the item shown on the collection's card, if any.
func (c Collection) Cover() (Item, bool) {
	for _, item := range c.Items {
		if item.ID == c.CoverItemID {
			return item, true
		}
	}
	if len(c.Items) > 0 {
		return c.Items[0], true
	}
	return Item{}, false
}

// Item finds one item by its id.
func (c Collection) Item(itemID string) (Item, bool) {
	for _, item := range c.Items {
		if item.ID == itemID {
			return item, true
		}
	}
	return Item{}, false
}

var (
	ErrNotFound     = errors.New("collection not found")
	ErrInvalidTitle = errors.New("collection name must be 1-80 characters")
	ErrDescription  = errors.New("description must be at most 500 characters")
	ErrInvalidField = errors.New("invalid section or visibility")
	ErrTooMany      = errors.New("collection limit reached")
	ErrFull         = errors.New("a collection holds at most 2000 items")
	ErrBadOrder     = errors.New("order must list every item exactly once")
	ErrItemNotFound = errors.New("item not found")
)

type Store struct {
	dir  string
	mu   sync.RWMutex
	byID map[string]*Collection
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// ValidID reports whether id could name a collection (and so a file).
func ValidID(id string) bool { return idPattern.MatchString(id) }

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, byID: map[string]*Collection{}}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".json") {
			continue
		}
		var c Collection
		if _, err := store.ReadJSON(filepath.Join(dir, name), &c); err != nil {
			return nil, err
		}
		if ValidID(c.ID) && c.ID+".json" == name {
			s.byID[c.ID] = &c
		}
	}
	return s, nil
}

func (s *Store) path(id string) string { return filepath.Join(s.dir, id+".json") }

func (s *Store) saveLocked(c *Collection) error {
	return store.WriteJSON(s.path(c.ID), c, 0o600)
}

func normalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > MaxTitleRunes {
		return "", ErrInvalidTitle
	}
	return title, nil
}

func normalizeDescription(desc string) (string, error) {
	desc = strings.TrimSpace(desc)
	if utf8.RuneCountInString(desc) > MaxDescription {
		return "", ErrDescription
	}
	return desc, nil
}

func validSection(section string) bool {
	return section == SectionCollections || section == SectionImages
}

func validVisibility(v string) bool { return v == Private || v == Public }

// Create makes an empty collection.
func (s *Store) Create(ownerID, section, title, description, visibility string) (Collection, error) {
	title, err := normalizeTitle(title)
	if err != nil {
		return Collection{}, err
	}
	if description, err = normalizeDescription(description); err != nil {
		return Collection{}, err
	}
	if visibility == "" {
		visibility = Private
	}
	if !validSection(section) || !validVisibility(visibility) {
		return Collection{}, ErrInvalidField
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	owned := 0
	for _, c := range s.byID {
		if c.OwnerID == ownerID {
			owned++
		}
	}
	if owned >= MaxPerOwner {
		return Collection{}, ErrTooMany
	}

	now := time.Now().UTC()
	c := &Collection{
		ID: auth.NewID(), OwnerID: ownerID, Section: section, Title: title, Description: description,
		Visibility: visibility, Items: []Item{}, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.saveLocked(c); err != nil {
		return Collection{}, err
	}
	s.byID[c.ID] = c
	return c.clone(), nil
}

func (s *Store) Get(id string) (Collection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.byID[id]
	if !ok {
		return Collection{}, false
	}
	return c.clone(), true
}

// ListByOwner returns one member's collections in a section, most recently
// changed first.
func (s *Store) ListByOwner(ownerID, section string) []Collection {
	s.mu.RLock()
	out := []Collection{}
	for _, c := range s.byID {
		if c.OwnerID == ownerID && (section == "" || c.Section == section) {
			out = append(out, c.clone())
		}
	}
	s.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// update applies change to a copy, saves it, and only then makes it current.
func (s *Store) update(id string, change func(c *Collection) error) (Collection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.byID[id]
	if !ok {
		return Collection{}, ErrNotFound
	}
	next := current.clone()
	if err := change(&next); err != nil {
		return Collection{}, err
	}
	next.UpdatedAt = time.Now().UTC()
	if err := s.saveLocked(&next); err != nil {
		return Collection{}, err
	}
	s.byID[id] = &next
	return next.clone(), nil
}

// Patch is a partial edit; nil fields are left alone.
type Patch struct {
	Title       *string
	Description *string
	Visibility  *string
	CoverItemID *string
}

func (s *Store) Edit(id string, p Patch) (Collection, error) {
	return s.update(id, func(c *Collection) error {
		if p.Title != nil {
			title, err := normalizeTitle(*p.Title)
			if err != nil {
				return err
			}
			c.Title = title
		}
		if p.Description != nil {
			desc, err := normalizeDescription(*p.Description)
			if err != nil {
				return err
			}
			c.Description = desc
		}
		if p.Visibility != nil {
			if !validVisibility(*p.Visibility) {
				return ErrInvalidField
			}
			c.Visibility = *p.Visibility
		}
		if p.CoverItemID != nil {
			if *p.CoverItemID != "" {
				if _, ok := c.Item(*p.CoverItemID); !ok {
					return ErrItemNotFound
				}
			}
			c.CoverItemID = *p.CoverItemID
		}
		return nil
	})
}

// ResetShare invalidates every public link to the collection.
func (s *Store) ResetShare(id string) (Collection, error) {
	return s.update(id, func(c *Collection) error {
		c.ShareGen++
		return nil
	})
}

// AddItems appends media at the end, skipping media already present.
// accept is asked about each new id and may refuse it with an error.
func (s *Store) AddItems(id string, mediaIDs []string, accept func(mediaID string) error) (Collection, int, error) {
	added := 0
	c, err := s.update(id, func(c *Collection) error {
		present := make(map[string]bool, len(c.Items))
		for _, item := range c.Items {
			present[item.MediaID] = true
		}
		now := time.Now().UTC()
		for _, mediaID := range mediaIDs {
			if mediaID == "" || present[mediaID] {
				continue
			}
			if err := accept(mediaID); err != nil {
				return err
			}
			if len(c.Items) >= MaxItems {
				return ErrFull
			}
			present[mediaID] = true
			c.Items = append(c.Items, Item{ID: auth.NewID(), MediaID: mediaID, AddedAt: now})
			added++
		}
		return nil
	})
	return c, added, err
}

// RemoveItem drops one reference. The media itself is untouched.
func (s *Store) RemoveItem(id, itemID string) (Collection, error) {
	return s.update(id, func(c *Collection) error {
		index := slices.IndexFunc(c.Items, func(item Item) bool { return item.ID == itemID })
		if index < 0 {
			return ErrItemNotFound
		}
		c.Items = slices.Delete(c.Items, index, index+1)
		if c.CoverItemID == itemID {
			c.CoverItemID = ""
		}
		return nil
	})
}

// Reorder sets the order of the items. itemIDs must name every item exactly
// once, so a client working from a stale copy cannot drop or duplicate any.
func (s *Store) Reorder(id string, itemIDs []string) (Collection, error) {
	return s.update(id, func(c *Collection) error {
		if len(itemIDs) != len(c.Items) {
			return ErrBadOrder
		}
		byID := make(map[string]Item, len(c.Items))
		for _, item := range c.Items {
			byID[item.ID] = item
		}
		next := make([]Item, 0, len(itemIDs))
		for _, itemID := range itemIDs {
			item, ok := byID[itemID]
			if !ok {
				return ErrBadOrder
			}
			delete(byID, itemID)
			next = append(next, item)
		}
		c.Items = next
		return nil
	})
}

// Delete removes the collection — its file and nothing else.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byID[id]; !ok {
		return ErrNotFound
	}
	if err := os.Remove(s.path(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	delete(s.byID, id)
	return nil
}

// DeleteByOwner removes a member's collections, e.g. when the account is
// deleted.
func (s *Store) DeleteByOwner(ownerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var firstErr error
	for id, c := range s.byID {
		if c.OwnerID != ownerID {
			continue
		}
		if err := os.Remove(s.path(id)); err != nil && !os.IsNotExist(err) {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		delete(s.byID, id)
	}
	return firstErr
}

// RemoveMedia drops every reference to deleted media.
func (s *Store) RemoveMedia(mediaID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var firstErr error
	for id, c := range s.byID {
		if !slices.ContainsFunc(c.Items, func(item Item) bool { return item.MediaID == mediaID }) {
			continue
		}
		next := c.clone()
		removed := map[string]bool{}
		next.Items = slices.DeleteFunc(next.Items, func(item Item) bool {
			if item.MediaID == mediaID {
				removed[item.ID] = true
				return true
			}
			return false
		})
		if removed[next.CoverItemID] {
			next.CoverItemID = ""
		}
		if err := s.saveLocked(&next); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.byID[id] = &next
	}
	return firstErr
}
