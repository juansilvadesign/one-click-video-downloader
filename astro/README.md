# One-Click Video Downloader — Landing Page

A static marketing site for the **One-Click Video Downloader** extension, built
with [Astro](https://astro.build/). Pure Astro + scoped CSS (no React, no
Tailwind) so it compiles straight to static HTML/CSS that can be hosted anywhere.

## Design

- **Brand:** the extension's own blue → cyan gradient (`#00C6FD → #084DF0`) on
  slate neutrals, with the logo's navy ink (`#182539`). Recolored from the
  CocoCut light-theme reference (`knowledge/sources/lp-clones/cococut/`); the
  structure and mechanics (gradient-text titles, pill buttons, soft cards) come
  from there, the palette is this project's real identity.
- **Type:** Space Grotesk (display) + Outfit (body), loaded from Google Fonts.
- **Architecture** follows the PsiAtiva `landing-page-v2` Astro project
  (`BaseLayout` + `SEOHead` + config-driven sections), trimmed to a single static
  page with no i18n or islands.

All copy and links live in **`src/config/site.config.ts`** — edit there, not in
the components.

## Develop

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # → dist/
npm run preview    # serve the built dist/
```

## Before publishing

- `astro.config.mjs` → set `site` to the real deploy origin (canonical + OG).
- `src/config/site.config.ts` → fill in `SITE.links` (`repo`, `docs`, `backlog`).
  They default to `#`, so the on-page install flow works in the meantime.

## Assets

Brand assets are copied into `public/` from the project's `assets/`:

| Path | Source |
|---|---|
| `public/logo/profile-nobg.svg` | colour mark (navbar, footer) |
| `public/logo/profile-white.svg` | white mark (dark sections) |
| `public/logo/brand.png` | full brand board |
| `public/showcase/*.webp` | animated hero |
| `public/showcase/*-poster.png` | hero/OG fallback frame |
| `public/showcase/*-edited.mp4` | motion source/fallback |
| `public/favicon/*` | favicon set |

If the brand assets change upstream, re-copy them from
`../assets/`.

## Structure

```
src/
  config/site.config.ts     all editable copy + links
  styles/global.css         design tokens, base, buttons, cards, chips
  layouts/BaseLayout.astro  html shell, head, nav + footer, scroll reveal
  components/
    seo/SEOHead.astro
    ui/{Icon,Button,SectionHeading}.astro
    sections/{Navbar,Hero,TrustBar,HowItWorks,Features,
              Privacy,Scope,Install,FAQ,FinalCTA,Footer}.astro
  pages/index.astro         composes the page + JSON-LD schema
```
