# Agent Instructions for Tools Repository

## Task Tracking

This project uses Taskwarrior for tracking work. Environment is set via `.envrc`.

```bash
task next          # See prioritized work queue
task N start       # Begin working on task N
task annotate N "findings..."  # Record progress/findings
task N done        # Complete task
task N modify +needs-human     # Flag for human input
```

Tasks are stored in `.task/` (committed to git).

## Project Overview

Static HTML tools hosted on GitHub Pages. No build steps, no frameworks. Each tool is a self-contained `.html` file.

## Constraints

**Core principle**: Each tool must work directly from GitHub Pages as a single `.html` file with zero build process.

- **Self-contained HTML**: Each tool is a single `.html` file that works when opened directly
- **No build steps**: No compilation, transpilation, or bundling - what you write is what gets served
- **All dependencies via CDN**: Use cdnjs, unpkg, jsdelivr, or esm.sh for any external libraries
- **Pin exact versions**: Never use `@latest` tags - always specify exact versions (e.g., `react@18.2.0`)
- **Naming**: Use kebab-case for filenames (e.g., `json-formatter.html`)

**Technology choices**:
- **Vanilla JS preferred** for simplicity and zero dependencies
- **Frameworks allowed** if loaded via CDN (React, Vue, Alpine, etc.)
  - Use production/minified builds
  - Include all required dependencies (e.g., React needs react + react-dom + babel-standalone for JSX)
  - Verify tools work when opened locally in a browser (`file://`)

The key test: Can you `git clone` the repo, open `tool-name.html` in a browser, and have it work immediately?

## CDN Resources and SRI Verification

**Critical: Always verify CDN URLs before committing**

Common issues found in git history:
- Broken CDN URLs (404s)
- Incorrect SRI integrity hashes causing tools to fail loading
- Module loading failures ("grey curtain" bugs)
- Version mismatches between URL and integrity hash

**Verification checklist:**
1. Test the URL directly - ensure it loads expected content
2. Verify SRI hash: `curl -s 'URL' | openssl dgst -sha384 -binary | openssl base64 -A`
3. Ensure `crossorigin="anonymous"` is set for all CDN resources with integrity hashes

**Common CDN patterns:**
- unpkg: `https://unpkg.com/package@version/file.js`
- jsdelivr: `https://cdn.jsdelivr.net/npm/package@version/file.js`
- cdnjs: `https://cdnjs.cloudflare.com/ajax/libs/package/version/file.js`
- esm.sh: `https://esm.sh/package@version`

**SRI format:** `<script src="URL" integrity="sha384-HASH" crossorigin="anonymous"></script>`

## UX Design Guidelines

**Consistent Design Across Tools:**
- Dark theme with `#f97316` (orange) accent color
- "← Tools" back link: top-left, color: `#888`, hover to `#f97316`
- Buttons: 8-12px border-radius, scale(0.95) on active
- Mobile breakpoints: 640px, 768px
- Success: `#22c55e` (green), Error: `#ef4444` (red)

## Debug Pattern

For tools with complex APIs (Bluetooth, WebRTC, Media, etc.), implement a collapsible debug section:

**Features:**
- Collapsible section (collapsed by default) with 🐛 icon
- Toggle checkbox to enable/disable debug logging (persists to localStorage)
- Three action buttons: 📋 Copy, 🗑️ Clear, 💾 Download
- Monospace log display with timestamps (HH:mm:ss.SSS) and color-coded levels
- localStorage key pattern: `{tool-name}_debug_logging_enabled`

**When to add:** Complex API interactions, async multi-step operations, state machines, connection management.

## tools.json Manifest

All tools are registered in `tools.json`:

```json
{
  "tools": [
    {
      "id": "tool-name",
      "title": "Tool Name",
      "description": "Brief description",
      "icon": "lucide-icon-name",
      "dateAdded": "YYYY-MM-DD",
      "dateUpdated": "YYYY-MM-DD"
    }
  ]
}
```

**Required fields:** `id` (matches filename without `.html`), `title`, `description`, `icon` (from https://lucide.dev/icons/), `dateAdded` (ISO 8601)

**Optional:** `dateUpdated` - only include when tool receives significant updates

## Tool-Specific Documentation

Some tools have complex state management or architecture requiring detailed docs:

- **routine-builder.html**: See `docs/routine-builder.md` for state machine, audio system, sets/pyramid progression logic

**When to read tool docs:**
- Before modifying the tool
- When fixing bugs or adding features
- If you see unexpected state behavior

## Code Review Checklist

When reviewing or making changes, verify:

1. **CDN URLs and SRI hashes**: URLs are valid and integrity hashes match
2. **Design consistency**: Dark theme, orange accent (#f97316), proper button styles, mobile responsiveness
3. **Code quality**: Clean, readable code; proper error handling; no console errors
4. **Changelog**: CHANGELOG.md is updated for user-facing changes
5. **tools.json**: For new tools, entry is added with correct `dateAdded`. For updates, verify `dateUpdated` is set to current date
6. **README.md**: Tool descriptions match current functionality and stay in sync with tools.json metadata
7. When performing code review, you ALWAYS MUST include a summary comment:
     - What files you reviewed
     - What aspects you focused on
     - Any files you couldn't fully analyze
