import { serwist } from '@serwist/next/config'

// Serwist runs as its own build step (`serwist build`) rather than as a Next
// plugin: the plugin is webpack-only, and Next 16 defaults to Turbopack.
export default await serwist.withNextConfig(() => ({
    swSrc: 'src/sw.ts',
    swDest: 'public/sw.js',
}))
