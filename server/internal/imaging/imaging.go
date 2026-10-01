// Package imaging reads uploaded photos and makes their thumbnails, in pure
// Go so it does not depend on what the installed ffmpeg can decode or whether
// it honours EXIF orientation.
//
// The original file is never rewritten: browsers apply EXIF orientation to an
// <img> themselves. Only the thumbnail is decoded, scaled and rotated.
package imaging

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

// MaxPixels refuses images whose decoded bitmap would not fit comfortably in
// the server's 4 GB of RAM: about 50 megapixels, 200 MB as RGBA.
const MaxPixels = 50_000_000

var (
	ErrUnsupported = errors.New("unsupported image format")
	ErrTooLarge    = errors.New("image dimensions are too large")
)

// Info describes an image as it is displayed, i.e. after EXIF rotation.
type Info struct {
	Format string
	Width  int
	Height int
	// EXIF orientation, 1–8. 1 means as stored.
	Orientation int
}

func decodeConfig(r io.Reader, format string) (image.Config, error) {
	switch format {
	case "jpeg":
		return jpeg.DecodeConfig(r)
	case "png":
		return png.DecodeConfig(r)
	case "gif":
		return gif.DecodeConfig(r)
	case "webp":
		return webp.DecodeConfig(r)
	}
	return image.Config{}, ErrUnsupported
}

func decode(r io.Reader, format string) (image.Image, error) {
	switch format {
	case "jpeg":
		return jpeg.Decode(r)
	case "png":
		return png.Decode(r)
	case "gif":
		return gif.Decode(r)
	case "webp":
		return webp.Decode(r)
	}
	return nil, ErrUnsupported
}

// sniff identifies the format from the file's first bytes, never from its
// name.
func sniff(head []byte) string {
	switch {
	case len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF:
		return "jpeg"
	case len(head) >= 8 && string(head[:8]) == "\x89PNG\r\n\x1a\n":
		return "png"
	case len(head) >= 6 && (string(head[:6]) == "GIF87a" || string(head[:6]) == "GIF89a"):
		return "gif"
	case len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP":
		return "webp"
	}
	return ""
}

// Extension is the canonical file extension for a format.
func Extension(format string) string {
	switch format {
	case "jpeg":
		return ".jpg"
	case "png", "gif", "webp":
		return "." + format
	}
	return ""
}

// Probe reads only the header: format, size and orientation.
func Probe(path string) (Info, error) {
	f, err := os.Open(path)
	if err != nil {
		return Info{}, err
	}
	defer f.Close()

	head := make([]byte, 16)
	n, _ := io.ReadFull(f, head)
	format := sniff(head[:n])
	if format == "" {
		return Info{}, ErrUnsupported
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return Info{}, err
	}
	cfg, err := decodeConfig(bufio.NewReader(f), format)
	if err != nil {
		return Info{}, fmt.Errorf("%w: %v", ErrUnsupported, err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return Info{}, ErrUnsupported
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return Info{}, ErrTooLarge
	}

	info := Info{Format: format, Width: cfg.Width, Height: cfg.Height, Orientation: 1}
	if format == "jpeg" {
		if _, err := f.Seek(0, io.SeekStart); err == nil {
			info.Orientation = jpegOrientation(bufio.NewReader(f))
		}
	}
	if info.Orientation >= 5 {
		info.Width, info.Height = info.Height, info.Width
	}
	return info, nil
}

// Thumbnail writes a JPEG of the image, rotated upright, whose longer side is
// at most maxSide. The caller writes to a temp path and renames.
func Thumbnail(src, dst string, maxSide int) error {
	info, err := Probe(src)
	if err != nil {
		return err
	}
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	img, err := decode(bufio.NewReader(f), info.Format)
	f.Close()
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnsupported, err)
	}

	// Scale in stored orientation, then rotate the small result.
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if longer := max(w, h); longer > maxSide {
		w = max(1, w*maxSide/longer)
		h = max(1, h*maxSide/longer)
	}
	scaled := image.NewRGBA(image.Rect(0, 0, w, h))
	// Transparent PNG and GIF areas become white, not black, in a JPEG.
	draw.Draw(scaled, scaled.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.BiLinear.Scale(scaled, scaled.Bounds(), img, b, draw.Over, nil)

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(out, orient(scaled, info.Orientation), &jpeg.Options{Quality: 82}); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}

// orient applies an EXIF orientation (1–8) to img.
func orient(img *image.RGBA, orientation int) *image.RGBA {
	if orientation <= 1 || orientation > 8 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	ow, oh := w, h
	if orientation >= 5 {
		ow, oh = h, w
	}
	out := image.NewRGBA(image.Rect(0, 0, ow, oh))
	for y := range h {
		for x := range w {
			var nx, ny int
			switch orientation {
			case 2: // mirrored
				nx, ny = w-1-x, y
			case 3: // rotated 180
				nx, ny = w-1-x, h-1-y
			case 4: // mirrored vertically
				nx, ny = x, h-1-y
			case 5: // transposed
				nx, ny = y, x
			case 6: // rotated 90 clockwise
				nx, ny = h-1-y, x
			case 7: // transversed
				nx, ny = h-1-y, w-1-x
			case 8: // rotated 90 counter-clockwise
				nx, ny = y, w-1-x
			}
			out.SetRGBA(nx, ny, img.RGBAAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return out
}

// jpegOrientation finds the EXIF orientation tag in a JPEG's APP1 segment.
// Anything unexpected yields 1: a sideways thumbnail is better than none.
func jpegOrientation(r *bufio.Reader) int {
	var marker [2]byte
	if _, err := io.ReadFull(r, marker[:]); err != nil || marker != [2]byte{0xFF, 0xD8} {
		return 1
	}
	for {
		if _, err := io.ReadFull(r, marker[:]); err != nil || marker[0] != 0xFF {
			return 1
		}
		// Start of scan or end of image: no EXIF before the pixels.
		if marker[1] == 0xDA || marker[1] == 0xD9 {
			return 1
		}
		var size [2]byte
		if _, err := io.ReadFull(r, size[:]); err != nil {
			return 1
		}
		length := int(binary.BigEndian.Uint16(size[:])) - 2
		if length < 0 {
			return 1
		}
		if marker[1] != 0xE1 {
			if _, err := r.Discard(length); err != nil {
				return 1
			}
			continue
		}
		segment := make([]byte, length)
		if _, err := io.ReadFull(r, segment); err != nil {
			return 1
		}
		if len(segment) < 6 || string(segment[:6]) != "Exif\x00\x00" {
			continue
		}
		return exifOrientation(segment[6:])
	}
}

func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 1
	}
	count := int(order.Uint16(tiff[ifd : ifd+2]))
	for i := range count {
		entry := ifd + 2 + i*12
		if entry+12 > len(tiff) {
			return 1
		}
		if order.Uint16(tiff[entry:entry+2]) == 0x0112 {
			value := int(order.Uint16(tiff[entry+8 : entry+10]))
			if value >= 1 && value <= 8 {
				return value
			}
			return 1
		}
	}
	return 1
}
