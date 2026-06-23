/**
 * site.config.ts — single source of truth for the landing page content.
 *
 * Everything human-editable about the page lives here so copy and links can be
 * tuned without touching component markup. Section components import the slice
 * they render. Keep claims accurate to the extension (see ../../README.md and
 * ../../CONTEXT.md) — this product is deliberately honest about its scope.
 */

export interface NavLink {
  href: string;
  label: string;
}

export interface Step {
  index: string;
  title: string;
  body: string;
  /** key into the inline icon set in components/ui/Icon.astro */
  icon: string;
}

export interface Feature {
  title: string;
  body: string;
  icon: string;
}

export interface Guarantee {
  text: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export const SITE = {
  name: 'One-Click Video Downloader',
  /** used in <title> and OG */
  tagline: 'Save authorized web video in one click',
  description:
    'A personal Manifest V3 extension for Chrome and Edge that detects the best source the page is already playing and saves a clean MP4. Direct files use your browser; adaptive and split streams are merged locally by FFmpeg. Best quality, local processing, no cloud.',
  version: '0.2.0',
  license: 'GPL-3.0-only',

  /**
   * External links. All live as of 2026-06-23; the primary install journey is
   * still on-page (#install), so the page stands alone regardless.
   */
  links: {
    repo: 'https://github.com/juansilvadesign/one-click-video-downloader',
    // GitBook docs site (Git Sync) on the custom domain. GitBook-hosted
    // fallback origin: https://proxy.gitbook.site/sites/site_qTNVY
    docs: 'https://one-click-video-downloader.juanpablosilva.com.br/docs',
    backlog: 'https://github.com/juansilvadesign/one-click-video-downloader/blob/main/BACKLOG.md',
    license: 'https://www.gnu.org/licenses/gpl-3.0.html',
  },

  logos: {
    color: '/logo/profile-nobg.svg',
    white: '/logo/profile-white.svg',
    brand: '/logo/brand.png',
  },

  showcase: {
    animated: '/showcase/one-click-video-downloader-showcase.webp',
    poster: '/showcase/one-click-video-downloader-showcase-poster.png',
    video: '/showcase/one-click-video-downloader-showcase-edited.mp4',
  },

  /** social card image (the polished poster frame) */
  ogImage: '/showcase/one-click-video-downloader-showcase-poster.png',
} as const;

export const NAV_LINKS: NavLink[] = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#install', label: 'Install' },
  { href: '#faq', label: 'FAQ' },
];

export const HERO = {
  eyebrow: 'Manifest V3 · Chrome & Edge',
  // The word wrapped in <gradient></gradient> gets the brand gradient.
  titleLead: 'Save authorized web video with',
  titleGradient: 'one click',
  body:
    'One-Click Video Downloader detects the best source the page is already playing, then saves a clean MP4. Direct files go straight through your browser. Adaptive and split streams are merged locally by FFmpeg. Best quality, local processing, no cloud.',
  primaryCta: { href: '#install', label: 'Install the extension' },
  secondaryCta: { href: '#how', label: 'See how it works' },
  trust: ['100% local', 'No analytics', 'GPL-3.0', 'Authorized media only'],
} as const;

/** Capability chips under the hero — echoes the brand poster. */
export const TRUST_CHIPS: string[] = [
  'Direct MP4',
  'HLS / DASH',
  'Split A / V',
  'Live capture',
  'Codec-aware',
  'No cloud required',
];

export const HOW = {
  eyebrow: 'How it works',
  title: 'From page to MP4 in one action',
  subtitle:
    'The normal path hides manifests, fragments, stream pairing, codecs, and FFmpeg flags. You start playback, open the popup, and press one button.',
  steps: <Step[]>[
    {
      index: '01',
      icon: 'radar',
      title: 'Detect',
      body: 'The extension watches what the active page requests and ranks every candidate: direct MP4, HLS, DASH, or separately delivered video and audio.',
    },
    {
      index: '02',
      icon: 'route',
      title: 'Choose',
      body: 'A direct MP4 goes straight through your browser’s download manager. Anything adaptive or split is handed to a small local helper instead.',
    },
    {
      index: '03',
      icon: 'cpu',
      title: 'Process',
      body: 'A local Python host runs FFmpeg to merge, remux, or transcode only what is incompatible. Media bytes never leave your machine.',
    },
    {
      index: '04',
      icon: 'save',
      title: 'Save',
      body: 'A validated MP4 lands in your Downloads folder, named from the page title. One explicit action, start to finish.',
    },
  ],
} as const;

export const FEATURES = {
  eyebrow: 'Features',
  title: 'Smaller on purpose, complete where it counts',
  subtitle:
    'No resource lists, no manual parser controls, no engine settings. One automatic plan replaces the busywork, while the hard cases still work.',
  items: <Feature[]>[
    {
      icon: 'cursor',
      title: 'One primary action',
      body: 'Open the popup and press Download best quality. The highest compatible source is selected for you, every time.',
    },
    {
      icon: 'layers',
      title: 'Every stream type',
      body: 'Direct MP4, HLS (.m3u8), DASH (.mpd), and separately delivered video and audio are detected and paired automatically.',
    },
    {
      icon: 'record',
      title: 'Live recording',
      body: 'Capture live streams with Stop and save. The host finalizes the file and validates it before it is marked done.',
    },
    {
      icon: 'sliders',
      title: 'Codec-aware output',
      body: 'Compatible streams are copied untouched; only incompatible video or audio is transcoded. Faster saves, cleaner quality.',
    },
    {
      icon: 'stack',
      title: 'Concurrent and resilient',
      body: 'Run up to three downloads at once with live progress. Bounded reconnects and retries ride out temporary failures, even if you close the popup.',
    },
    {
      icon: 'shield',
      title: 'Local and private',
      body: 'Everything runs on your machine. No analytics, no remote parser, no cloud service. Only HTTP(S) media you are authorized to save.',
    },
  ],
} as const;

export const PRIVACY = {
  eyebrow: 'Privacy by architecture',
  title: 'Your media never touches a server',
  body:
    'The extension only sends control data to the local host: URLs, an allowlisted subset of request headers, and job commands. FFmpeg fetches and processes the media directly. The bytes stay between the page and your disk.',
  guarantees: <Guarantee[]>[
    { text: 'Media bytes never pass through Native Messaging' },
    { text: 'Only validated HTTP(S) inputs are accepted' },
    { text: 'Request headers are allowlisted; newline-bearing values are rejected' },
    { text: 'URLs, cookies, and tokens are redacted from logs and saved state' },
    { text: 'Optional cookie, scripting, and power permissions stay user-initiated' },
    { text: 'No analytics and no remote service, ever' },
  ],
} as const;

export const SCOPE = {
  eyebrow: 'Honest by design',
  title: 'What it deliberately does not do',
  body:
    'This is a focused tool for media you own or are authorized to save. Several popular capabilities are out of scope on purpose, and that restraint is the point.',
  excluded: [
    'DRM circumvention',
    'Paywall bypass',
    'Credential automation',
    'Batch download queues',
    'Cloud conversion',
    'Site-specific extractors',
  ],
} as const;

export const INSTALL = {
  eyebrow: 'Install',
  title: 'Get started in a few minutes',
  subtitle:
    'Direct MP4 downloads need only the extension. Adaptive, split, and live jobs use a small local host built on Python and FFmpeg.',
  requirements: [
    'Chrome or Edge 102+ (Chromium-based)',
    'Python 3.10+ on the same operating system',
    'FFmpeg and ffprobe available on your PATH',
  ],
  steps: <Step[]>[
    {
      index: '01',
      icon: 'puzzle',
      title: 'Load the extension',
      body: 'Open chrome://extensions, enable Developer mode, choose Load unpacked, and select the project’s extension/ folder. Copy the 32-character extension ID.',
    },
    {
      index: '02',
      icon: 'terminal',
      title: 'Install the native host',
      body: 'Run the installer with the project’s .venv and your extension ID. It creates an isolated production environment and registers the host for that exact ID.',
    },
    {
      index: '03',
      icon: 'play',
      title: 'Download',
      body: 'Play a video you are authorized to save, open the popup, and press Download best quality. The file lands in your Downloads folder.',
    },
  ],
  // shown verbatim in a code block — taken from the project README
  installCommand: `.venv/bin/python native-host/install_host.py \\
  --extension-id YOUR_EXTENSION_ID \\
  --browser chrome \\
  --with-yt-dlp`,
} as const;

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Which browsers does it support?',
    a: 'Chrome or Edge 102 and newer (any Chromium-based browser at that floor). It loads as an unpacked Manifest V3 extension.',
  },
  {
    q: 'Is it free and open source?',
    a: 'Yes. It is licensed GPL-3.0-only. The request-observation approach is informed by Cat Catch, which is also GPL-3.0.',
  },
  {
    q: 'Can it download from Netflix, Disney+, or other DRM sites?',
    a: 'No. DRM circumvention and paywall bypass are out of scope by design. It only saves media you own or are authorized to save.',
  },
  {
    q: 'Do I need anything besides the extension?',
    a: 'For direct MP4 files, no. For HLS, DASH, split tracks, or live streams, a small local host using Python 3.10+ and FFmpeg/ffprobe does the processing on your machine.',
  },
  {
    q: 'Does any of my data get uploaded?',
    a: 'No. Everything runs locally. The extension sends only control data (URLs and allowlisted headers) to the local host, and FFmpeg fetches the media directly. There is no analytics and no cloud.',
  },
  {
    q: 'Where do downloads go?',
    a: 'Into your operating system’s Downloads folder, with a clean kebab-case filename derived from the page title, for example showcase-video.mp4.',
  },
  {
    q: 'Can I download more than one at a time?',
    a: 'Yes, up to three at once, each with its own live progress. Downloads keep running in the background if you close the popup.',
  },
  {
    q: 'What about live streams?',
    a: 'Supported. Use Stop and save: the host asks FFmpeg to finalize the file and validates it before presenting it as complete.',
  },
];

export const FINAL_CTA = {
  title: 'Best quality. Local processing.',
  body: 'One explicit action. Authorized media only. No cloud required.',
  primaryCta: { href: '#install', label: 'Install the extension' },
  secondaryCta: { href: SITE.links.repo, label: 'View the source' },
} as const;

export const FOOTER = {
  blurb: 'A focused, local-first extension for saving authorized page video as a clean MP4.',
  columns: [
    {
      title: 'Product',
      links: <NavLink[]>[
        { href: '#how', label: 'How it works' },
        { href: '#features', label: 'Features' },
        { href: '#privacy', label: 'Privacy' },
        { href: '#install', label: 'Install' },
      ],
    },
    {
      title: 'Resources',
      links: <NavLink[]>[
        { href: SITE.links.docs, label: 'Setup guide' },
        { href: SITE.links.backlog, label: 'Backlog' },
        { href: SITE.links.repo, label: 'Source code' },
        { href: SITE.links.license, label: 'License (GPL-3.0)' },
      ],
    },
  ],
  legal: 'For media you own or are authorized to save. Everything stays local.',
} as const;
