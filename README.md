# Tiny Edit

A small, fast Markdown and plain-text editor for macOS. It highlights Markdown and fenced code but never hides syntax, never autocorrects, and never reformats your text.

- `npm install` · `npm run dev` · `npm run check`
- `npm run package` builds `dist/mac-arm64/Tiny Edit.app`; `npm run install:app` also copies it to `/Applications` for all users (asks for your admin password; quit the running app first); `npm run install:app:user` installs to `~/Applications` without admin rights.
- Design: `docs/architecture.md` · Decisions: `docs/plan.md` · Working rules: `CLAUDE.md`
