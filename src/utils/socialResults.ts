import type { SocialKey, VideoSocial } from '../types/video'

/** Reads a counter off the locally stored social data, defaulting to zero. */
export const getSocialResults = (social: VideoSocial | undefined, key: SocialKey): number => social?.[key] ?? 0
