package httpapi

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/collections"
	"github.com/osos3lom/videoscroll/server/internal/media"
	"github.com/osos3lom/videoscroll/server/internal/users"
)

// Media kinds as the app sees them.
const (
	kindVideo = "video"
	kindImage = "image"
)

// CollectionItemView is mirrored by `CollectionItem` in src/types/api.ts.
type CollectionItemView struct {
	ID      string    `json:"id"`
	MediaID string    `json:"mediaId"`
	Kind    string    `json:"kind"`
	AddedAt time.Time `json:"addedAt"`
}

// CollectionView is mirrored by `Collection` in src/types/api.ts. Items is
// only filled for a single collection, not in listings.
type CollectionView struct {
	ID          string               `json:"id"`
	Section     string               `json:"section"`
	Title       string               `json:"title"`
	Description string               `json:"description"`
	Visibility  string               `json:"visibility"`
	CoverItemID string               `json:"coverItemId,omitempty"`
	Cover       *CollectionItemView  `json:"cover,omitempty"`
	ItemCount   int                  `json:"itemCount"`
	VideoCount  int                  `json:"videoCount"`
	ImageCount  int                  `json:"imageCount"`
	ShareCode   string               `json:"shareCode,omitempty"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
	Items       []CollectionItemView `json:"items,omitempty"`
}

// mediaFor resolves a media id to its metadata and kind, for a viewer.
// Hidden or deleted media resolves to nothing.
func (s *Server) mediaFor(user users.User, mediaID string) (media.Meta, string, bool) {
	if meta, ok := s.index.Get(mediaID); ok {
		return meta, kindVideo, true
	}
	if meta, ok := s.images.Get(mediaID); ok && canSeeImage(user, meta) {
		return meta, kindImage, true
	}
	return media.Meta{}, "", false
}

func (s *Server) collectionView(user users.User, c collections.Collection, withItems bool) CollectionView {
	view := CollectionView{
		ID: c.ID, Section: c.Section, Title: c.Title, Description: c.Description,
		Visibility: c.Visibility, CoverItemID: c.CoverItemID, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
	if c.Visibility == collections.Public {
		view.ShareCode = s.collectionCode(c)
	}
	items := make([]CollectionItemView, 0, len(c.Items))
	for _, item := range c.Items {
		_, kind, ok := s.mediaFor(user, item.MediaID)
		if !ok {
			continue
		}
		items = append(items, CollectionItemView{ID: item.ID, MediaID: item.MediaID, Kind: kind, AddedAt: item.AddedAt})
		if kind == kindVideo {
			view.VideoCount++
		} else {
			view.ImageCount++
		}
	}
	view.ItemCount = len(items)
	for i := range items {
		if items[i].ID == c.CoverItemID {
			view.Cover = &items[i]
		}
	}
	if view.Cover == nil && len(items) > 0 {
		view.Cover = &items[0]
	}
	if withItems {
		view.Items = items
	}
	return view
}

// ownCollection is the collection in the path if the caller owns it. Anyone
// else gets the same 404 as for a collection that does not exist.
func (s *Server) ownCollection(w http.ResponseWriter, r *http.Request, user users.User) (collections.Collection, bool) {
	c, ok := s.collections.Get(r.PathValue("id"))
	if !ok || c.OwnerID != user.ID {
		writeError(w, http.StatusNotFound, "collection not found")
		return collections.Collection{}, false
	}
	return c, true
}

func (s *Server) writeCollectionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, collections.ErrNotFound):
		writeError(w, http.StatusNotFound, "collection not found")
	case errors.Is(err, collections.ErrItemNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, errMediaNotAllowed):
		writeError(w, http.StatusNotFound, "media not found")
	case errors.Is(err, errVideoInImages):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, collections.ErrInvalidTitle), errors.Is(err, collections.ErrDescription),
		errors.Is(err, collections.ErrInvalidField), errors.Is(err, collections.ErrBadOrder),
		errors.Is(err, collections.ErrFull), errors.Is(err, collections.ErrTooMany):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		slog.Error("collection", "err", err)
		writeError(w, http.StatusInternalServerError, "could not save")
	}
}

var (
	errMediaNotAllowed = errors.New("media not found")
	errVideoInImages   = errors.New("image categories hold images only")
)

// acceptFor checks that user may put mediaID into c: every video, and the
// images the user can see; image categories take images only.
func (s *Server) acceptFor(user users.User, section string) func(string) error {
	return func(mediaID string) error {
		_, kind, ok := s.mediaFor(user, mediaID)
		if !ok {
			return errMediaNotAllowed
		}
		if section == collections.SectionImages && kind != kindImage {
			return errVideoInImages
		}
		return nil
	}
}

type collectionsResponse struct {
	Collections         []CollectionView `json:"collections"`
	MediaToken          string           `json:"mediaToken"`
	MediaTokenExpiresAt time.Time        `json:"mediaTokenExpiresAt"`
}

type collectionResponse struct {
	Collection          CollectionView `json:"collection"`
	MediaToken          string         `json:"mediaToken"`
	MediaTokenExpiresAt time.Time      `json:"mediaTokenExpiresAt"`
}

func (s *Server) writeCollection(w http.ResponseWriter, status int, user users.User, c collections.Collection) {
	token, claims := s.signer.IssueMedia(user.ID, user.Ver)
	writeJSON(w, status, collectionResponse{
		Collection: s.collectionView(user, c, true), MediaToken: token, MediaTokenExpiresAt: claims.ExpiresAt(),
	})
}

// handleListCollections returns the caller's own collections in a section
// (?section=collections|images), most recently changed first.
func (s *Server) handleListCollections(w http.ResponseWriter, r *http.Request, user users.User) {
	section := r.URL.Query().Get("section")
	if section != "" && section != collections.SectionCollections && section != collections.SectionImages {
		writeError(w, http.StatusBadRequest, collections.ErrInvalidField.Error())
		return
	}
	// ?items=1 includes every collection's items, for the browsing view.
	withItems := r.URL.Query().Get("items") == "1"
	list := s.collections.ListByOwner(user.ID, section)
	views := make([]CollectionView, 0, len(list))
	for _, c := range list {
		views = append(views, s.collectionView(user, c, withItems))
	}
	token, claims := s.signer.IssueMedia(user.ID, user.Ver)
	writeJSON(w, http.StatusOK, collectionsResponse{Collections: views, MediaToken: token, MediaTokenExpiresAt: claims.ExpiresAt()})
}

func (s *Server) handleCreateCollection(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		Section     string   `json:"section"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Visibility  string   `json:"visibility"`
		MediaIDs    []string `json:"mediaIds"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Section == "" {
		body.Section = collections.SectionCollections
	}
	if len(body.MediaIDs) > collections.MaxItemsPerWrite {
		writeError(w, http.StatusBadRequest, "too many items in one request")
		return
	}
	// Check the media before creating anything, so a refused item does not
	// leave an empty collection behind.
	accept := s.acceptFor(user, body.Section)
	for _, id := range body.MediaIDs {
		if err := accept(id); err != nil {
			s.writeCollectionError(w, err)
			return
		}
	}
	c, err := s.collections.Create(user.ID, body.Section, body.Title, body.Description, body.Visibility)
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	if len(body.MediaIDs) > 0 {
		if c, _, err = s.collections.AddItems(c.ID, body.MediaIDs, accept); err != nil {
			s.writeCollectionError(w, err)
			return
		}
	}
	s.writeCollection(w, http.StatusCreated, user, c)
}

func (s *Server) handleGetCollection(w http.ResponseWriter, r *http.Request, user users.User) {
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	s.writeCollection(w, http.StatusOK, user, c)
}

func (s *Server) handleUpdateCollection(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Visibility  *string `json:"visibility"`
		CoverItemID *string `json:"coverItemId"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	updated, err := s.collections.Edit(c.ID, collections.Patch{
		Title: body.Title, Description: body.Description, Visibility: body.Visibility, CoverItemID: body.CoverItemID,
	})
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	s.writeCollection(w, http.StatusOK, user, updated)
}

// handleDeleteCollection removes the collection only. Its videos and images
// stay exactly where they were.
func (s *Server) handleDeleteCollection(w http.ResponseWriter, r *http.Request, user users.User) {
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	if err := s.collections.Delete(c.ID); err != nil {
		s.writeCollectionError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAddCollectionItems(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		MediaIDs []string `json:"mediaIds"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if len(body.MediaIDs) > collections.MaxItemsPerWrite {
		writeError(w, http.StatusBadRequest, "too many items in one request")
		return
	}
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	updated, _, err := s.collections.AddItems(c.ID, body.MediaIDs, s.acceptFor(user, c.Section))
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	s.writeCollection(w, http.StatusOK, user, updated)
}

// handleRemoveCollectionItem takes one item out of the collection. The
// video or image itself is not touched.
func (s *Server) handleRemoveCollectionItem(w http.ResponseWriter, r *http.Request, user users.User) {
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	updated, err := s.collections.RemoveItem(c.ID, r.PathValue("itemId"))
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	s.writeCollection(w, http.StatusOK, user, updated)
}

func (s *Server) handleReorderCollection(w http.ResponseWriter, r *http.Request, user users.User) {
	var body struct {
		ItemIDs []string `json:"itemIds"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	// Items whose media has gone are invisible to the client, so it cannot
	// list them; keep them at the end rather than refusing the order.
	sent := make(map[string]bool, len(body.ItemIDs))
	for _, id := range body.ItemIDs {
		sent[id] = true
	}
	for _, item := range c.Items {
		if _, _, ok := s.mediaFor(user, item.MediaID); !ok && !sent[item.ID] {
			body.ItemIDs = append(body.ItemIDs, item.ID)
		}
	}
	updated, err := s.collections.Reorder(c.ID, body.ItemIDs)
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	s.writeCollection(w, http.StatusOK, user, updated)
}

// handleResetCollectionShare kills the current public link; if the
// collection is public, the response carries the new one.
func (s *Server) handleResetCollectionShare(w http.ResponseWriter, r *http.Request, user users.User) {
	c, ok := s.ownCollection(w, r, user)
	if !ok {
		return
	}
	updated, err := s.collections.ResetShare(c.ID)
	if err != nil {
		s.writeCollectionError(w, err)
		return
	}
	s.writeCollection(w, http.StatusOK, user, updated)
}

// ------------------------------------------------------ public links --

// collectionCode is the public link's secret: the collection id and a MAC
// over it and the share generation. Nothing is stored, so the owner can see
// the link again at any time, and bumping the generation revokes it.
func (s *Server) collectionCode(c collections.Collection) string {
	mac := s.signer.MAC("collection", c.ID, strconv.Itoa(c.ShareGen))[:16]
	return c.ID + "." + base64.RawURLEncoding.EncodeToString(mac)
}

// PublicCollectionItem is mirrored by `PublicCollectionItem` in
// src/types/api.ts. Key is the item's random id within the collection: no
// media id, file name or uploader.
type PublicCollectionItem struct {
	Key      string  `json:"key"`
	Kind     string  `json:"kind"`
	Title    string  `json:"title"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	Duration float64 `json:"duration,omitempty"`
}

// PublicCollection is mirrored by `PublicCollection` in src/types/api.ts.
type PublicCollection struct {
	Title       string                 `json:"title"`
	Description string                 `json:"description"`
	Items       []PublicCollectionItem `json:"items"`
}

// publicMedia resolves an item of a public collection for someone without
// an account. Images are shown only while they belong to the collection's
// owner, so the owner role cannot publish another member's private photos.
func (s *Server) publicMedia(c collections.Collection, item collections.Item) (media.Meta, string, bool) {
	if meta, ok := s.index.Get(item.MediaID); ok {
		return meta, kindVideo, true
	}
	if meta, ok := s.images.Get(item.MediaID); ok && meta.UploaderID != "" && meta.UploaderID == c.OwnerID {
		return meta, kindImage, true
	}
	return media.Meta{}, "", false
}

// publicCollection resolves ?s= to a live public collection: the code must
// match the current generation, the collection must still be public, and
// its owner must still have an active account. Every failure looks the same
// and counts toward the caller's guessing budget.
func (s *Server) publicCollection(w http.ResponseWriter, r *http.Request) (collections.Collection, bool) {
	ip := auth.ClientIP(r, s.cfg.TrustLoopbackProxy)
	if s.publicByIP.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return collections.Collection{}, false
	}
	code := strings.TrimSpace(r.URL.Query().Get("s"))
	if id, _, found := strings.Cut(code, "."); found && collections.ValidID(id) {
		if c, ok := s.collections.Get(id); ok && c.Visibility == collections.Public {
			owner, exists := s.users.Get(c.OwnerID)
			want := s.collectionCode(c)
			if exists && !owner.Disabled && subtle.ConstantTimeCompare([]byte(code), []byte(want)) == 1 {
				return c, true
			}
		}
	}
	s.publicByIP.Fail(ip)
	writeError(w, http.StatusNotFound, "this share link is invalid, expired, or stopped")
	return collections.Collection{}, false
}

func (s *Server) handlePublicCollection(w http.ResponseWriter, r *http.Request) {
	c, ok := s.publicCollection(w, r)
	if !ok {
		return
	}
	out := PublicCollection{Title: c.Title, Description: c.Description, Items: []PublicCollectionItem{}}
	for _, item := range c.Items {
		meta, kind, ok := s.publicMedia(c, item)
		if !ok {
			continue
		}
		out.Items = append(out.Items, PublicCollectionItem{
			Key: item.ID, Kind: kind, Title: meta.Title, Width: meta.Width, Height: meta.Height, Duration: meta.Duration,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// publicItem resolves ?s= and ?i= to one live item.
func (s *Server) publicItem(w http.ResponseWriter, r *http.Request) (media.Meta, string, bool) {
	c, ok := s.publicCollection(w, r)
	if !ok {
		return media.Meta{}, "", false
	}
	if item, found := c.Item(r.URL.Query().Get("i")); found {
		if meta, kind, ok := s.publicMedia(c, item); ok {
			return meta, kind, true
		}
	}
	s.publicByIP.Fail(auth.ClientIP(r, s.cfg.TrustLoopbackProxy))
	writeError(w, http.StatusNotFound, "this share link is invalid, expired, or stopped")
	return media.Meta{}, "", false
}

// handlePublicCollectionMedia serves an item's bytes. Video goes through the
// same cap as single-video links, so strangers never starve members.
func (s *Server) handlePublicCollectionMedia(w http.ResponseWriter, r *http.Request) {
	meta, kind, ok := s.publicItem(w, r)
	if !ok {
		return
	}
	if kind == kindImage {
		s.serveImageFile(w, r, meta)
		return
	}
	select {
	case s.publicStreams <- struct{}{}:
		defer func() { <-s.publicStreams }()
	default:
		writeError(w, http.StatusServiceUnavailable, "too many people are watching shared videos, try again shortly")
		return
	}
	s.serveFile(w, r, s.videosRoot, meta.FileName, media.MimeType(meta.FileName))
}

func (s *Server) handlePublicCollectionPoster(w http.ResponseWriter, r *http.Request) {
	meta, kind, ok := s.publicItem(w, r)
	if !ok {
		return
	}
	if kind == kindImage {
		s.serveImageThumb(w, r, meta)
		return
	}
	s.servePoster(w, r, meta.VideoID)
}
