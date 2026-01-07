# Tools Repository

Static HTML tools hosted on GitHub Pages. No build steps, no frameworks.

## Constraints

- **Self-contained HTML**: Each tool is a single `.html` file
- **No build steps**: No React, Vue, Webpack, Vite, etc.
- **Dependencies via CDN only**: Use cdnjs, unpkg, jsdelivr, or esm.sh
- **Pin versions**: Never use `@latest` - always specify exact versions
- **Naming**: Use kebab-case for filenames (e.g., `json-formatter.html`)

## Verifying CDN Resources

**Critical: Always verify CDN URLs before committing**

Common issues found in git history:
- Broken CDN URLs (404s)
- Incorrect SRI integrity hashes causing tools to fail loading
- Module loading failures ("grey curtain" bugs)
- Version mismatches between URL and integrity hash

**Verification checklist:**
1. **Test the URL**: Open the CDN URL directly in browser - ensure it loads and shows the expected content
2. **Verify SRI hash** (if using):
   ```bash
   curl -s 'https://cdn.example.com/lib.js' | openssl dgst -sha384 -binary | openssl base64 -A
   ```
   Compare output with your `integrity` attribute value
3. **Test locally**: Open the tool in browser and check console for loading errors
4. **Check crossorigin**: Ensure `crossorigin="anonymous"` is set for all CDN resources with integrity hashes

**Common CDN patterns:**
- unpkg: `https://unpkg.com/package@version/file.js`
- jsdelivr: `https://cdn.jsdelivr.net/npm/package@version/file.js`
- cdnjs: `https://cdnjs.cloudflare.com/ajax/libs/package/version/file.js`
- esm.sh: `https://esm.sh/package@version`

**SRI (Subresource Integrity):**
- Always add `integrity` and `crossorigin` attributes for security
- Format: `<script src="URL" integrity="sha384-HASH" crossorigin="anonymous"></script>`
- Generate hashes: https://www.srihash.org/ or use curl command above
- Recent batch update added these to all tools - maintain consistency

## Tool Structure

Minimal required structure for each tool:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tool Name</title>
    <style>
        /* Inline styles or import from CDN */
    </style>
</head>
<body>
    <!-- Tool content -->
    <script>
        /* Inline scripts or import from CDN */
    </script>
</body>
</html>
```

## UX Design

**Consistent Design Across Tools:**
- Dark theme with `#f97316` (orange) accent color
- "← Tools" back link: top-left, color: `#888`, hover to `#f97316`
- Buttons: 8-12px border-radius, scale(0.95) on active
- Mobile breakpoints: 640px, 768px
- Success: `#22c55e` (green), Error: `#ef4444` (red)

Reference any tool for examples of these patterns in action.

## Debug Pattern

For tools that benefit from debugging (especially those using complex APIs like Bluetooth, Media, etc.), implement a collapsible debug section:

**Features:**
- Collapsible section (collapsed by default) with 🐛 icon
- Toggle checkbox to enable/disable debug logging (persists to localStorage)
- Optional: Secondary checkbox for verbose/status logging
- Three action buttons:
  - 📋 Copy - copies log to clipboard (with mobile fallback)
  - 🗑️ Clear - clears the log
  - 💾 Download - downloads as timestamped .txt file
- Monospace log display with:
  - High-precision timestamps (HH:mm:ss.SSS)
  - Color-coded log levels (info, success, warn, error)
  - Auto-scroll to bottom
  - Empty state message

**Implementation:**
- `logDebug(message, level)` function that:
  - ALWAYS logs to console (for browser devtools)
  - Only adds to UI log if debug logging is enabled
  - Supports emoji indicators: ✓ (success), ❌ (error), ⚠ (warn), ► (send), ◄ (receive)
- localStorage key pattern: `{tool-name}_debug_logging_enabled`

**When to add:**
- Complex API interactions (Bluetooth, WebRTC, etc.)
- Asynchronous operations with multiple steps
- State machines or connection management
- When users may need to report issues to you

**Benefits:**
- Works perfectly on mobile (touch-friendly, collapsible)
- Users can copy/download logs to help debug issues
- No performance impact when disabled (default state)
- Professional debugging experience

See `bedjet-bluetooth-control.html:904-1023` (CSS) and `:1714-1804` (JavaScript) for reference implementation.

## Adding a New Tool

1. Create `tool-name.html` following the structure above
2. Add entry to `tools.json`:
   ```json
   {
     "id": "tool-name",
     "title": "Tool Name",
     "description": "Brief description of what the tool does",
     "icon": "lucide-icon-name",
     "dateAdded": "YYYY-MM-DD"
   }
   ```
   - `icon`: Lucide icon name from https://lucide.dev/icons/ (required)
   - `dateAdded`: ISO 8601 date (YYYY-MM-DD) when tool was created (required)
   - `dateUpdated`: Optional - only add when tool receives significant updates
3. Update `README.md` to include the new tool in the "Available Tools" list
4. The `index.html` reads from `tools.json` dynamically - no manual update needed

## Manifest: tools.json

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

**Required fields:**
- `id`: Must match the filename (without `.html` extension)
- `title`: Display name of the tool
- `description`: Brief description shown on the index page
- `icon`: Lucide icon name from https://lucide.dev/icons/
- `dateAdded`: ISO 8601 date (YYYY-MM-DD) when tool was created

**Optional fields:**
- `dateUpdated`: ISO 8601 date - only include when tool receives significant updates

## Deployment

Changes pushed to `main` are automatically deployed to GitHub Pages (~30-40 seconds).

**Optional: Monitor deployment progress**
```bash
# View latest workflow run
gh run list --limit 1

# Watch specific run (blocking until complete)
gh run watch <RUN_ID>

# Watch latest run
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

## References

- **BedJet**: [markus1189/bedjet-re](https://github.com/markus1189/bedjet-re) - Decompiled official Android application with notes
