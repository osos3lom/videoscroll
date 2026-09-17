package users

import (
	"path/filepath"
	"testing"
)

func TestNormalizeUsername(t *testing.T) {
	cases := map[string]string{
		// Every common way of writing a Saudi mobile number is one account.
		"0501234567":       "+966501234567",
		"050 123 4567":     "+966501234567",
		"050-123-4567":     "+966501234567",
		"501234567":        "+966501234567",
		"966501234567":     "+966501234567",
		"+966501234567":    "+966501234567",
		"+966 50 123 4567": "+966501234567",
		"00966501234567":   "+966501234567",
		" (050) 123-4567 ": "+966501234567",
		// Other countries need their code.
		"+20 100 123 4567": "+201001234567",
		"00447700900123":   "+447700900123",
		// Handles are lower-cased.
		"Osos":      "osos",
		" Ahmed.K ": "ahmed.k",
	}
	for in, want := range cases {
		if got := NormalizeUsername(in); got != want {
			t.Errorf("NormalizeUsername(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateUsername(t *testing.T) {
	valid := []string{"+966501234567", "+201001234567", "osos", "ahmed.k", "user_1"}
	for _, u := range valid {
		if err := ValidateUsername(NormalizeUsername(u)); err != nil {
			t.Errorf("%q rejected: %v", u, err)
		}
	}

	phones := []string{"12345", "0112345678", "+0501234567", "+1234"}
	for _, u := range phones {
		if err := ValidateUsername(NormalizeUsername(u)); err != ErrInvalidPhone {
			t.Errorf("%q: err = %v, want ErrInvalidPhone", u, err)
		}
	}

	handles := []string{"ab", "has space", "émile", "a/b"}
	for _, u := range handles {
		if err := ValidateUsername(NormalizeUsername(u)); err != ErrInvalidUsername {
			t.Errorf("%q: err = %v, want ErrInvalidUsername", u, err)
		}
	}
}

func TestOwnerCreatedAccountLifecycle(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "users.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner, _ := s.Create("osos", "owner-password-1", RoleOwner)

	member, err := s.CreateMember("050 123 4567", "Ahmed", "temporary-pass-1", RoleViewer)
	if err != nil {
		t.Fatal(err)
	}
	if member.Username != "+966501234567" || member.DisplayName != "Ahmed" || !member.MustChangePassword {
		t.Fatalf("member = %+v", member)
	}
	if _, err := s.CreateMember("+966501234567", "", "temporary-pass-1", RoleViewer); err != ErrUsernameTaken {
		t.Errorf("duplicate phone: err = %v", err)
	}

	// Signs in with the local format.
	if _, ok := s.Authenticate("0501234567", "temporary-pass-1"); !ok {
		t.Fatal("local-format sign-in failed")
	}

	changed, _ := s.SetPassword(member.ID, "my-own-password")
	if changed.MustChangePassword || changed.Ver != member.Ver+1 {
		t.Errorf("after own change: %+v", changed)
	}

	reset, _ := s.SetTemporaryPassword(member.ID, "another-temp-1")
	if !reset.MustChangePassword || reset.Ver != changed.Ver+1 {
		t.Errorf("after owner reset: %+v", reset)
	}

	if err := s.Delete(owner.ID); err != ErrLastOwner {
		t.Errorf("deleting the last owner: err = %v", err)
	}
	if err := s.Delete(member.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get(member.ID); ok {
		t.Error("deleted member still exists")
	}
}
