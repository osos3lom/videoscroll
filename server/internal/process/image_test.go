package process

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/media"
)

func TestPublishImageKeepsTheOriginalBytes(t *testing.T) {
	p := newPipeline(t)
	p.Images = media.NewImageIndex(p.Layout)

	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1600, 900))); err != nil {
		t.Fatal(err)
	}
	// Named .jpg but really a PNG: the extension follows the content.
	src := filepath.Join(p.Layout.Incoming, "job.src")
	if err := os.WriteFile(src, buf.Bytes(), 0o640); err != nil {
		t.Fatal(err)
	}

	meta, err := p.PublishImage(Input{SourcePath: src, OriginalName: "Beach Day.jpg", UploaderID: "u1", UploadedAt: time.Now(), SourceID: "job"})
	if err != nil {
		t.Fatal(err)
	}
	if meta.Kind != media.KindImage || meta.Width != 1600 || meta.Height != 900 || filepath.Ext(meta.FileName) != ".png" {
		t.Errorf("meta = %+v", meta)
	}
	published, err := os.ReadFile(filepath.Join(p.Layout.Images, meta.FileName))
	if err != nil || !bytes.Equal(published, buf.Bytes()) {
		t.Errorf("published bytes differ from the upload (err=%v)", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("source left in incoming/")
	}
	if p.Layout.PosterPath(meta.VideoID) == "" {
		t.Error("no thumbnail")
	}
	if got, ok := p.Images.BySourceID("job"); !ok || got.VideoID != meta.VideoID {
		t.Error("image not in the image index")
	}
	if _, ok := p.Index.Get(meta.VideoID); ok {
		t.Error("image leaked into the video index")
	}
}

func TestPublishImageRejectsNonImages(t *testing.T) {
	p := newPipeline(t)
	p.Images = media.NewImageIndex(p.Layout)
	src := filepath.Join(p.Layout.Incoming, "bad.src")
	_ = os.WriteFile(src, []byte("not a picture"), 0o640)
	if _, err := p.PublishImage(Input{SourcePath: src, OriginalName: "x.jpg"}); err == nil {
		t.Fatal("published a non-image")
	}
	if entries, _ := os.ReadDir(p.Layout.Images); len(entries) != 0 {
		t.Errorf("left files in images/: %v", entries)
	}
}
