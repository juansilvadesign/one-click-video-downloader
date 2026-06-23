// @ts-check
import { defineConfig } from 'astro/config';

// Static marketing site for One-Click Video Downloader.
// Pure Astro — no React/Tailwind — so it builds to plain static HTML/CSS.
// Set `site` to the real deploy origin before publishing (used for canonical
// URLs, sitemap, and absolute OG image links).
export default defineConfig({
  site: 'https://one-click-video-downloader.example',
  output: 'static',
});
