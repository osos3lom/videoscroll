package probe

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func box(boxType string, payload int) []byte {
	b := make([]byte, 8+payload)
	binary.BigEndian.PutUint32(b[:4], uint32(len(b)))
	copy(b[4:8], boxType)
	return b
}

func TestMoovBeforeMdat(t *testing.T) {
	faststart := bytes.Join([][]byte{box("ftyp", 16), box("moov", 64), box("mdat", 256)}, nil)
	if ok, err := moovBeforeMdat(bytes.NewReader(faststart)); err != nil || !ok {
		t.Errorf("faststart file: ok=%v err=%v", ok, err)
	}

	tail := bytes.Join([][]byte{box("ftyp", 16), box("free", 8), box("mdat", 256), box("moov", 64)}, nil)
	if ok, err := moovBeforeMdat(bytes.NewReader(tail)); err != nil || ok {
		t.Errorf("moov-at-end file: ok=%v err=%v", ok, err)
	}

	// 64-bit largesize box before moov.
	large := make([]byte, 16+32)
	binary.BigEndian.PutUint32(large[:4], 1)
	copy(large[4:8], "wide")
	binary.BigEndian.PutUint64(large[8:16], uint64(len(large)))
	withLarge := bytes.Join([][]byte{box("ftyp", 16), large, box("moov", 8)}, nil)
	if ok, err := moovBeforeMdat(bytes.NewReader(withLarge)); err != nil || !ok {
		t.Errorf("largesize box: ok=%v err=%v", ok, err)
	}

	if _, err := moovBeforeMdat(bytes.NewReader([]byte("not an mp4 at all"))); err == nil {
		t.Error("garbage accepted")
	}
}

func TestMoovBeforeMdatOnDemoClip(t *testing.T) {
	_, here, _, _ := runtime.Caller(0)
	clip := filepath.Join(filepath.Dir(here), "..", "..", "..", "videos", "clip1.mp4")
	if _, err := os.Stat(clip); err != nil {
		t.Skip("demo clip not present")
	}
	if _, err := MoovBeforeMdat(clip); err != nil {
		t.Fatalf("real MP4 not parseable: %v", err)
	}
}

func TestDisplaySizeSwapsForRotation(t *testing.T) {
	s := Stream{Width: 1920, Height: 1080}
	s.SideData = append(s.SideData, struct {
		Rotation float64 `json:"rotation"`
	}{Rotation: -90})
	if w, h := s.DisplaySize(); w != 1080 || h != 1920 {
		t.Errorf("rotated display size = %dx%d", w, h)
	}
}
