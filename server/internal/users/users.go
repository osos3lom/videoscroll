// Package users stores community members and invites in one JSON file.
//
// A closed community is tens of people, not thousands: an in-memory map
// persisted atomically is simpler and faster than any database, and the file
// is trivially backed up.
package users

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/auth"
	"github.com/osos3lom/videoscroll/server/internal/store"
)

type Role string

const (
	RoleOwner    Role = "owner"
	RoleUploader Role = "uploader"
	RoleViewer   Role = "viewer"
)

func (r Role) Valid() bool {
	return r == RoleOwner || r == RoleUploader || r == RoleViewer
}

// CanUpload is true for uploader and owner.
func (r Role) CanUpload() bool { return r == RoleOwner || r == RoleUploader }

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	Role         Role   `json:"role"`
	PasswordHash string `json:"passwordHash"`
	// Ver is embedded in every token. Incrementing it revokes them all.
	Ver       int       `json:"ver"`
	Disabled  bool      `json:"disabled"`
	CreatedAt time.Time `json:"createdAt"`
}

// Public is the shape sent to clients: never the hash, never the version.
type Public struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	Role        Role      `json:"role"`
	Disabled    bool      `json:"disabled"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (u User) Public() Public {
	return Public{u.ID, u.Username, u.DisplayName, u.Role, u.Disabled, u.CreatedAt}
}

type Invite struct {
	ID string `json:"id"`
	// Only the SHA-256 of the code is stored, so a leaked users.json cannot
	// be used to join.
	CodeHash  string     `json:"codeHash"`
	Role      Role       `json:"role"`
	CreatedBy string     `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	UsedBy    string     `json:"usedBy,omitempty"`
	UsedAt    *time.Time `json:"usedAt,omitempty"`
}

var (
	ErrNotFound        = errors.New("not found")
	ErrUsernameTaken   = errors.New("that username is taken")
	ErrInvalidUsername = errors.New("username must be 3-32 characters: letters, digits, dot, dash or underscore")
	ErrWeakPassword    = errors.New("password must be at least 10 characters")
	ErrInvalidRole     = errors.New("invalid role")
	ErrInviteInvalid   = errors.New("this invite is invalid, expired, or already used")
	ErrLastOwner       = errors.New("the community must keep at least one active owner")
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9_.-]{3,32}$`)

type fileData struct {
	Users   []User   `json:"users"`
	Invites []Invite `json:"invites"`
}

type Store struct {
	path string

	mu        sync.RWMutex
	data      fileData
	modTime   time.Time
	lastCheck time.Time
}

// Open loads path, creating an empty store if it does not exist yet.
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	if err := s.reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) reload() error {
	var data fileData
	mod, err := store.ReadJSON(s.path, &data)
	if os.IsNotExist(err) {
		s.data, s.modTime = fileData{}, time.Time{}
		return nil
	}
	if err != nil {
		return err
	}
	s.data, s.modTime = data, mod
	return nil
}

// refreshLocked picks up edits made by the CLI while the server is running.
// It stats the file at most every few seconds. Caller holds s.mu for writing.
func (s *Store) refreshLocked(force bool) {
	if !force && time.Since(s.lastCheck) < 3*time.Second {
		return
	}
	s.lastCheck = time.Now()
	info, err := os.Stat(s.path)
	if err != nil || info.ModTime().Equal(s.modTime) {
		return
	}
	_ = s.reload()
}

func (s *Store) saveLocked() error {
	if err := store.WriteJSON(s.path, s.data, 0o600); err != nil {
		return err
	}
	if info, err := os.Stat(s.path); err == nil {
		s.modTime = info.ModTime()
	}
	return nil
}

// read runs fn under a read lock after an occasional change check.
func (s *Store) read(fn func()) {
	s.mu.Lock()
	s.refreshLocked(false)
	s.mu.Unlock()

	s.mu.RLock()
	defer s.mu.RUnlock()
	fn()
}

// write runs fn against fresh data and persists if it succeeds.
func (s *Store) write(fn func() error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshLocked(true)
	if err := fn(); err != nil {
		return err
	}
	return s.saveLocked()
}

func (s *Store) Get(id string) (User, bool) {
	var user User
	var found bool
	s.read(func() {
		if i := s.indexByID(id); i >= 0 {
			user, found = s.data.Users[i], true
		}
	})
	return user, found
}

func (s *Store) ByUsername(username string) (User, bool) {
	var user User
	var found bool
	s.read(func() {
		if i := s.indexByUsername(NormalizeUsername(username)); i >= 0 {
			user, found = s.data.Users[i], true
		}
	})
	return user, found
}

func (s *Store) List() []User {
	var list []User
	s.read(func() {
		list = append([]User(nil), s.data.Users...)
	})
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.Before(list[j].CreatedAt) })
	return list
}

func (s *Store) HasOwner() bool {
	has := false
	s.read(func() {
		for _, u := range s.data.Users {
			if u.Role == RoleOwner && !u.Disabled {
				has = true
				return
			}
		}
	})
	return has
}

func NormalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

// Create adds a user. Hashing happens before taking the lock.
func (s *Store) Create(username, password string, role Role) (User, error) {
	username = NormalizeUsername(username)
	if !usernamePattern.MatchString(username) {
		return User{}, ErrInvalidUsername
	}
	if !role.Valid() {
		return User{}, ErrInvalidRole
	}
	if len(password) < auth.MinPasswordLength {
		return User{}, ErrWeakPassword
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return User{}, err
	}

	user := User{
		ID:           randomID(),
		Username:     username,
		DisplayName:  username,
		Role:         role,
		PasswordHash: hash,
		Ver:          1,
		CreatedAt:    time.Now().UTC(),
	}
	err = s.write(func() error {
		if s.indexByUsername(username) >= 0 {
			return ErrUsernameTaken
		}
		s.data.Users = append(s.data.Users, user)
		return nil
	})
	return user, err
}

// Authenticate returns the user for a correct username and password. The
// cost is the same whether or not the username exists.
func (s *Store) Authenticate(username, password string) (User, bool) {
	user, found := s.ByUsername(username)
	hash := ""
	if found && !user.Disabled {
		hash = user.PasswordHash
	}
	if !auth.VerifyPassword(password, hash) {
		return User{}, false
	}
	return user, true
}

// SetPassword changes the password and bumps the version, revoking every
// existing token. Returns the updated user.
func (s *Store) SetPassword(id, password string) (User, error) {
	if len(password) < auth.MinPasswordLength {
		return User{}, ErrWeakPassword
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return User{}, err
	}
	return s.mutate(id, func(u *User) error {
		u.PasswordHash = hash
		u.Ver++
		return nil
	})
}

// RevokeSessions invalidates every token the user holds.
func (s *Store) RevokeSessions(id string) (User, error) {
	return s.mutate(id, func(u *User) error {
		u.Ver++
		return nil
	})
}

type Patch struct {
	Role        *Role   `json:"role"`
	Disabled    *bool   `json:"disabled"`
	DisplayName *string `json:"displayName"`
}

// Update applies an owner's change. Role changes and disabling revoke
// sessions, so a demoted uploader cannot keep uploading on an old token.
func (s *Store) Update(id string, patch Patch) (User, error) {
	return s.mutate(id, func(u *User) error {
		revoke := false
		if patch.Role != nil && *patch.Role != u.Role {
			if !patch.Role.Valid() {
				return ErrInvalidRole
			}
			if u.Role == RoleOwner && s.activeOwnersExcept(u.ID) == 0 {
				return ErrLastOwner
			}
			u.Role = *patch.Role
			revoke = true
		}
		if patch.Disabled != nil && *patch.Disabled != u.Disabled {
			if *patch.Disabled && u.Role == RoleOwner && s.activeOwnersExcept(u.ID) == 0 {
				return ErrLastOwner
			}
			u.Disabled = *patch.Disabled
			revoke = true
		}
		if patch.DisplayName != nil {
			name := strings.TrimSpace(*patch.DisplayName)
			if name == "" || len(name) > 48 {
				return errors.New("display name must be 1-48 characters")
			}
			u.DisplayName = name
		}
		if revoke {
			u.Ver++
		}
		return nil
	})
}

func (s *Store) mutate(id string, fn func(*User) error) (User, error) {
	var result User
	err := s.write(func() error {
		i := s.indexByID(id)
		if i < 0 {
			return ErrNotFound
		}
		updated := s.data.Users[i]
		if err := fn(&updated); err != nil {
			return err
		}
		s.data.Users[i] = updated
		result = updated
		return nil
	})
	return result, err
}

// CreateInvite returns the plaintext code exactly once.
func (s *Store) CreateInvite(role Role, createdBy string, ttl time.Duration) (string, Invite, error) {
	if !role.Valid() {
		return "", Invite{}, ErrInvalidRole
	}
	code := randomCode()
	now := time.Now().UTC()
	invite := Invite{
		ID:        randomID(),
		CodeHash:  hashCode(code),
		Role:      role,
		CreatedBy: createdBy,
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}
	err := s.write(func() error {
		s.data.Invites = append(s.data.Invites, invite)
		return nil
	})
	return code, invite, err
}

func (s *Store) ListInvites() []Invite {
	var list []Invite
	s.read(func() {
		list = append([]Invite(nil), s.data.Invites...)
	})
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.After(list[j].CreatedAt) })
	return list
}

func (s *Store) DeleteInvite(id string) error {
	return s.write(func() error {
		for i, inv := range s.data.Invites {
			if inv.ID == id {
				s.data.Invites = append(s.data.Invites[:i], s.data.Invites[i+1:]...)
				return nil
			}
		}
		return ErrNotFound
	})
}

// RedeemInvite creates the account and consumes the invite atomically.
func (s *Store) RedeemInvite(code, username, password string) (User, error) {
	username = NormalizeUsername(username)
	if !usernamePattern.MatchString(username) {
		return User{}, ErrInvalidUsername
	}
	if len(password) < auth.MinPasswordLength {
		return User{}, ErrWeakPassword
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return User{}, err
	}

	codeHash := hashCode(strings.TrimSpace(code))
	var user User
	err = s.write(func() error {
		idx := -1
		for i, inv := range s.data.Invites {
			if inv.UsedAt == nil && time.Now().Before(inv.ExpiresAt) &&
				hmacEqual(inv.CodeHash, codeHash) {
				idx = i
				break
			}
		}
		if idx < 0 {
			return ErrInviteInvalid
		}
		if s.indexByUsername(username) >= 0 {
			return ErrUsernameTaken
		}

		now := time.Now().UTC()
		user = User{
			ID:           randomID(),
			Username:     username,
			DisplayName:  username,
			Role:         s.data.Invites[idx].Role,
			PasswordHash: hash,
			Ver:          1,
			CreatedAt:    now,
		}
		s.data.Users = append(s.data.Users, user)
		s.data.Invites[idx].UsedBy = user.ID
		s.data.Invites[idx].UsedAt = &now
		return nil
	})
	return user, err
}

func (s *Store) indexByID(id string) int {
	for i, u := range s.data.Users {
		if u.ID == id {
			return i
		}
	}
	return -1
}

func (s *Store) indexByUsername(username string) int {
	for i, u := range s.data.Users {
		if u.Username == username {
			return i
		}
	}
	return -1
}

func (s *Store) activeOwnersExcept(id string) int {
	n := 0
	for _, u := range s.data.Users {
		if u.ID != id && u.Role == RoleOwner && !u.Disabled {
			n++
		}
	}
	return n
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// randomCode is 128 bits, URL-safe.
func randomCode() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func hmacEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
