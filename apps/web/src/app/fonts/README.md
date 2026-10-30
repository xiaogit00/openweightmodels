# Vendored fonts

These files are self-hosted so `next build` never fetches from
`fonts.googleapis.com`. Both Turbopack and webpack intermittently fail when
Google serves an extensionless `/l/font?kit=` URL, which breaks CI and Docker
builds with `next/font/google`.

| File | Family | Axis/weight | Subset |
|---|---|---|---|
| `geist.woff2` | Geist | variable, `wght` 100–900 | latin |
| `space-grotesk-500.woff2` | Space Grotesk | 500 | latin |
| `space-mono-400.woff2` | Space Mono | 400 | latin |

Source: [Google Fonts](https://fonts.google.com). Each family is licensed under
the SIL Open Font License 1.1; see the matching `*-OFL.txt` file.
