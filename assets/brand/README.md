# Loopmark Brand Assets

## Purpose

Preserve provenance for checked-in Loopmark logo assets and identify which files are source images versus runtime derivatives.

## Source Note

Generated on 2026-06-16 from the final `LM Solid Mark` direction.

## Assets

- `loopmark-logo-source.png`: original generated final logo image, preserved for provenance and future reprocessing.
- `loopmark-logo.png`: normalized 1024x1024 transparent PNG master.
- `loopmark-logo-readme.png`: lightweight 256x256 PNG with a rounded warm paper background, used by the GitHub README.

Runtime favicon and app icon derivatives live in `public/`. They use a rounded warm paper background so the black mark stays readable in dark browser and GitHub surfaces:

- `favicon.ico`
- `favicon-16x16.png`
- `favicon-32x32.png`
- `favicon-48x48.png`
- `apple-touch-icon.png`
- `icon-192.png`, also used by the in-app header for a sharper 32px logo
- `icon-512.png`

The web app manifest lives at `public/site.webmanifest` and references the `icon-192.png` and `icon-512.png` derivatives.

## Update When

- The logo direction changes.
- Runtime icon derivatives in `public/` are regenerated from a new source image.
