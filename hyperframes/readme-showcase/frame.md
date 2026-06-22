# Frame: One-Click Video Downloader Showcase

## Purpose

A short, silent product reel for the repository README. It should explain the extension's value in one viewing: detect the best available source, merge locally when needed, and save a clean MP4 through one primary action.

## Format

- Canvas: 1920 × 1080, 16:9
- Duration: 12 seconds
- Frame rate: 30 fps
- Delivery: H.264 MP4 plus a representative PNG poster
- Context: GitHub README; legible without audio or captions

## Brand source

- Primary visual reference: `assets/logo/brand.png`
- Mark source: `assets/logo/profile-nobg.svg`
- High-contrast processor mark: project source `../../assets/logo/profile-white.svg`, vendored render copy `assets/profile-white.svg`
- The video is a stylized product explanation, not a literal browser recording.

## Palette

| Token | Value | Use |
|---|---|---|
| Canvas | `#F9F9F9` | Persistent light background |
| Ink | `#182539` | Headlines, cursor, structural contrast |
| Primary blue | `#084DF0` | Main routes, buttons, focal edges |
| Electric cyan | `#00C6FD` | Detection pulse, highlights, click rays |
| Mid blue | `#0E94F4` | Progress, secondary routes |
| Deep blue | `#176DEE` | Download arrow and depth accents |
| Pale blue | `#D7E0FB` | Panels, atmospheric shapes, subtle dividers |
| White | `#FFFFFF` | Logo artwork on saturated blue only |

The only gradient is the brand route from `#084DF0` to `#00C6FD`. Neutrals stay tinted toward blue; do not introduce green, purple, or dead gray.

## Typography

- Display and product statements: `"Inter", sans-serif`, weight 800–900
- Technical labels and metadata: `"JetBrains Mono", monospace`, weight 700
- Display tracking: `-0.04em`
- Labels: uppercase with `0.12em`–`0.18em` tracking
- Minimum sizes: headline 72px, body 30px, metadata 18px

Both families are vendored as local WOFF2 files under `assets/fonts`; no external font fetch is required.

## Shape and depth

- Corners: 22px for cards, 32px for hero panels, pill radius for metadata
- Borders: 2–3px using `#D7E0FB` or saturated blue
- Shadows: soft blue-black depth, visible but restrained
- Structural language: routed connector lines, corner brackets, progress rails, scan ticks
- Background: light canvas with localized radial blue/cyan glows, sparse grid/rules, and fine grain

## Motion character

- Precise, optimistic, and local-first
- Entrances combine drawing, snapping, sliding, counting, and controlled scaling
- Directional movement follows the workflow: page → detector → local processor → Downloads
- Ambient movement is subtle: route pulses, cursor-ring breathing, slow metadata drift
- Transitions stay purposeful and CSS-based: diagonal route wipe, focus-pull blur, download-circle iris

## Do

- Keep two focal points in every scene.
- Fill the frame with one primary product action and one supporting technical proof.
- Use the logo icon as the recurring anchor.
- Keep all text readable in under two seconds.
- Preserve a clean light canvas while making accents compression-visible.

## Do not

- Do not use dark-mode cyberpunk, neon purple, green success UI, generic glassmorphism, or card grids.
- Do not imply DRM support, cloud processing, batch queues, or automatic credential access.
- Do not show real private URLs, cookies, tokens, or browser accounts.
- Do not fetch assets, fonts, scripts, or media from the network at render time.
- Do not use jump cuts; transitions carry every scene handoff.
