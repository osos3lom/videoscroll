import type { LocalVideo } from '../types/api'

/**
 * Saves a video to the device.
 *
 * The API answers `download` URLs with `Content-Disposition: attachment`, so a
 * plain navigation downloads the file and the app stays where it is. The
 * `download` attribute only matters for same-origin files (the demo build);
 * browsers ignore it cross-origin. A temporary link is used because a video
 * card is itself a link, and links cannot nest.
 */
export function downloadVideo(video: LocalVideo): void {
    const link = document.createElement('a')
    link.href = video.download ?? video.src
    link.download = downloadFileName(video)
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
}

function downloadFileName(video: LocalVideo): string {
    const dot = video.fileName.lastIndexOf('.')
    const ext = dot > 0 ? video.fileName.slice(dot) : ''
    const title = video.title.replace(/[\\/:*?"<>|\p{Cc}]/gu, '').trim()
    return (title || video.fileName.slice(0, dot > 0 ? dot : undefined)) + ext
}
