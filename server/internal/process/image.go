package process

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/osos3lom/videoscroll/server/internal/imaging"
	"github.com/osos3lom/videoscroll/server/internal/media"
)

// ThumbnailSide is the longer side of an image thumbnail, in pixels. Large
// enough for the grid and for the blurred background behind a photo.
const ThumbnailSide = 720

var errNoImageIndex = errors.New("images are not enabled")

// PublishImage publishes one uploaded photo. The bytes are kept exactly as
// uploaded; only a thumbnail is made. The order matches Publish:
//
//  1. thumbnail to posters/<id>.jpg (via .tmp and rename)
//  2. meta/<id>.json
//  3. move the source to images/<name> — the moment the image exists
//  4. add it to the image index
func (p *Pipeline) PublishImage(in Input) (media.Meta, error) {
	if p.Images == nil {
		return media.Meta{}, errNoImageIndex
	}
	info, err := imaging.Probe(in.SourcePath)
	if err != nil {
		return media.Meta{}, err
	}

	// The extension follows the content, whatever the upload was called.
	finalName := p.Layout.PublishedImageName(in.OriginalName, imaging.Extension(info.Format))
	finalPath := filepath.Join(p.Layout.Images, finalName)
	imageID := media.ImageID(finalName)

	if err := p.writeThumbnail(in.SourcePath, imageID); err != nil {
		return media.Meta{}, fmt.Errorf("thumbnail: %w", err)
	}

	meta, err := imageMeta(info, in.SourcePath, finalName, in)
	if err != nil {
		p.removeThumbnail(imageID)
		return media.Meta{}, err
	}
	if err := p.Images.WriteMeta(meta); err != nil {
		p.removeThumbnail(imageID)
		return media.Meta{}, err
	}
	if err := media.MoveFile(in.SourcePath, finalPath); err != nil {
		p.removeThumbnail(imageID)
		removeQuietly(p.Images.MetaPath(imageID))
		return media.Meta{}, err
	}
	p.Images.Add(meta)
	return meta, nil
}

// BackfillImage registers a photo placed in images/ by hand. It has no
// uploader, so only the owner sees it.
func (p *Pipeline) BackfillImage(fileName string) error {
	if p.Images == nil {
		return errNoImageIndex
	}
	path := filepath.Join(p.Layout.Images, fileName)
	stat, err := os.Stat(path)
	if err != nil {
		return err
	}
	info, err := imaging.Probe(path)
	if err != nil {
		return err
	}
	imageID := media.ImageID(fileName)
	if p.Layout.PosterPath(imageID) == "" {
		if err := p.writeThumbnail(path, imageID); err != nil {
			return err
		}
	}
	in := Input{OriginalName: timestampPrefix.ReplaceAllString(fileName, ""), UploadedAt: stat.ModTime()}
	meta, err := imageMeta(info, path, fileName, in)
	if err != nil {
		return err
	}
	if err := p.Images.WriteMeta(meta); err != nil {
		return err
	}
	p.Images.Add(meta)
	return nil
}

func (p *Pipeline) writeThumbnail(src, imageID string) error {
	final := filepath.Join(p.Layout.Posters, filepath.Base(imageID)+".jpg")
	tmp := final + ".tmp"
	if err := imaging.Thumbnail(src, tmp, ThumbnailSide); err != nil {
		removeQuietly(tmp)
		return err
	}
	return os.Rename(tmp, final)
}

func (p *Pipeline) removeThumbnail(imageID string) {
	removeQuietly(filepath.Join(p.Layout.Posters, filepath.Base(imageID)+".jpg"))
}

func imageMeta(info imaging.Info, path, fileName string, in Input) (media.Meta, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return media.Meta{}, err
	}
	uploaded := in.UploadedAt.UTC()
	if uploaded.IsZero() {
		uploaded = time.Now().UTC()
	}
	return media.Meta{
		VideoID:    media.ImageID(fileName),
		Kind:       media.KindImage,
		FileName:   fileName,
		Title:      media.TitleFrom(in.OriginalName),
		Size:       stat.Size(),
		UploadedAt: uploaded,
		UploaderID: in.UploaderID,
		Width:      info.Width,
		Height:     info.Height,
		VideoCodec: info.Format,
		Processing: "image",
		SourceID:   in.SourceID,
	}, nil
}
