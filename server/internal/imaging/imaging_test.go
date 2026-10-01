package imaging

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// exifSegment builds an APP1 EXIF segment holding one orientation tag.
func exifSegment(orientation uint16, order binary.ByteOrder) []byte {
	tiff := make([]byte, 8+2+12+4)
	if order == binary.LittleEndian {
		copy(tiff, "II")
	} else {
		copy(tiff, "MM")
	}
	order.PutUint16(tiff[2:], 42)
	order.PutUint32(tiff[4:], 8)
	order.PutUint16(tiff[8:], 1)
	order.PutUint16(tiff[10:], 0x0112)
	order.PutUint16(tiff[12:], 3) // SHORT
	order.PutUint32(tiff[14:], 1)
	order.PutUint16(tiff[18:], orientation)

	payload := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	return append(seg, payload...)
}

// writeJPEG writes a w×h JPEG, left half red and right half blue, with an
// optional EXIF orientation.
func writeJPEG(t *testing.T, path string, w, h int, orientation uint16) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.RGBA{255, 0, 0, 255}
			if x >= w/2 {
				c = color.RGBA{0, 0, 255, 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	if orientation != 0 {
		// Insert APP1 right after SOI.
		data = append(append(append([]byte{}, data[:2]...), exifSegment(orientation, binary.BigEndian)...), data[2:]...)
	}
	if err := os.WriteFile(path, data, 0o640); err != nil {
		t.Fatal(err)
	}
}

func TestProbeReadsOrientationAndSwapsSize(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		orientation uint16
		w, h        int
	}{{0, 40, 20}, {1, 40, 20}, {3, 40, 20}, {6, 20, 40}, {8, 20, 40}} {
		path := filepath.Join(dir, "a.jpg")
		writeJPEG(t, path, 40, 20, tc.orientation)
		info, err := Probe(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Format != "jpeg" || info.Width != tc.w || info.Height != tc.h {
			t.Errorf("orientation %d: %+v, want %dx%d", tc.orientation, info, tc.w, tc.h)
		}
	}
}

func TestExifOrientationBothByteOrders(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		seg := exifSegment(6, order)
		jpegBytes := append([]byte{0xFF, 0xD8}, seg...)
		jpegBytes = append(jpegBytes, 0xFF, 0xDA)
		if got := jpegOrientation(bufio.NewReader(bytes.NewReader(jpegBytes))); got != 6 {
			t.Errorf("%v: orientation = %d", order, got)
		}
	}
	// Garbage never panics and means "as stored".
	for _, junk := range [][]byte{nil, {0xFF}, {0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x01}, append([]byte{0xFF, 0xD8}, exifSegment(6, binary.BigEndian)[:12]...)} {
		if got := jpegOrientation(bufio.NewReader(bytes.NewReader(junk))); got != 1 {
			t.Errorf("junk %x: orientation = %d", junk, got)
		}
	}
}

func TestThumbnailIsUprightAndBounded(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "wide.jpg")
	// Stored 400×200 with red on the left; orientation 6 displays it
	// 200×400 with red on top.
	writeJPEG(t, src, 400, 200, 6)
	dst := filepath.Join(dir, "thumb.jpg")
	if err := Thumbnail(src, dst, 100); err != nil {
		t.Fatal(err)
	}
	f, _ := os.Open(dst)
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	if b.Dx() != 50 || b.Dy() != 100 {
		t.Fatalf("thumbnail %dx%d, want 50x100", b.Dx(), b.Dy())
	}
	r, _, bl, _ := img.At(25, 10).RGBA()
	if r < bl {
		t.Errorf("top of the rotated thumbnail is not red: r=%d b=%d", r, bl)
	}
}

func TestRejectsNonImagesAndHugeImages(t *testing.T) {
	dir := t.TempDir()
	text := filepath.Join(dir, "x.jpg")
	_ = os.WriteFile(text, []byte("definitely not an image"), 0o640)
	if _, err := Probe(text); !errors.Is(err, ErrUnsupported) {
		t.Errorf("text file: %v", err)
	}

	// A PNG header claiming 10000×10000 pixels.
	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewGray(image.Rect(0, 0, 1, 1)))
	data := buf.Bytes()
	binary.BigEndian.PutUint32(data[16:], 10000)
	binary.BigEndian.PutUint32(data[20:], 10000)
	binary.BigEndian.PutUint32(data[29:], crc32.ChecksumIEEE(data[12:29]))
	huge := filepath.Join(dir, "huge.png")
	_ = os.WriteFile(huge, data, 0o640)
	if _, err := Probe(huge); !errors.Is(err, ErrTooLarge) {
		t.Errorf("huge png: %v", err)
	}
}
