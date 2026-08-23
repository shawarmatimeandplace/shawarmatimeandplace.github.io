# Shawarma Time & Place — Eleventy + Pug

This repository contains the source for the bilingual static site.

## Structure

- `src/pages/` — page templates; each template is rendered once for English and once for French.
- `src/redirects/` — page redirects; each page is rendered at the base path /page-name/ and will automatically redirect the user to /en/page-name or /fr/page-name based on their browser's language.
- `src/_includes/` — shared Nunjucks layout and reusable mixins.
- `src/_data/` — translations, menu data, site metadata, and page metadata.
- `src/styles/` — CSS.
- `src/scripts/` — progressive-enhancement JavaScript where compile-time doesn't cut it.
- `src/media/` — media assets.
- `src/icons/` — favicon/PWA icons of the logo.
- `.github/workflows/` — GitHub Pages build/deployment workflow.
- `_site/` — generated build output; do not commit it.

## Local development

Requires Node.js 24+.

```bash
npm install
npm run start
```

Build only:

```bash
npm run build
```

The generated site is written to `_site/`.

## URL structure

The localized pages are generated as directory indexes:

- `/en/` → `_site/en/index.html`
- `/fr/` → `_site/fr/index.html`
- `/en/menu/` → `_site/en/menu/index.html`
- `/fr/menu/` → `_site/fr/menu/index.html`
- `/en/story/` → `_site/en/story/index.html`
- `/fr/story/` → `_site/fr/story/index.html`
- `/en/contact/` → `_site/en/contact/index.html`
- `/fr/contact/` → `_site/fr/contact/index.html`
- `/en/privacy/` → `_site/en/privacy/index.html`

The root-language selection/redirect behaviour maps /page/ to /en/page/ or /fr/page/ automatically based on the user's browser language.

## Deployment

GitHub Pages is configured to use **GitHub Actions** as the publishing source. The workflow builds `_site/` and deploys that directory as the Pages artifact.

With a custom GitHub Actions workflow, the custom domain is configured in the repository's GitHub Pages settings; a repository `CNAME` file is not required.
