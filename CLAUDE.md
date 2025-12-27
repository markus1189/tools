# Tools Repository

Static HTML tools hosted on GitHub Pages. No build steps, no frameworks.

## Constraints

- **Self-contained HTML**: Each tool is a single `.html` file
- **No build steps**: No React, Vue, Webpack, Vite, etc.
- **Dependencies via CDN only**: Use cdnjs, unpkg, jsdelivr, or esm.sh
- **Pin versions**: Never use `@latest` - always specify exact versions
- **Naming**: Use kebab-case for filenames (e.g., `json-formatter.html`)

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
3. The `index.html` reads from `tools.json` dynamically - no manual update needed

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
