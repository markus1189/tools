# Raindrop.io API Complete Specification

## Base Information

**Base API URL:** `https://api.raindrop.io/rest/v1`

**Rate Limiting:** 120 requests per minute per authenticated user (OAuth)

**Authentication:** OAuth 2.0 Bearer token

**Date Format:** ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)

**Response Format:** JSON with HTTP status codes (200, 204, 4xx, 5xx)

---

## Authentication

### OAuth Flow

1. **Register Application:** https://app.raindrop.io/#/settings/apps/dev
   - Obtain: `client_id` and `client_secret`

2. **Authorization Request:**
   ```
   GET https://raindrop.io/oauth/authorize?client_id={id}&redirect_uri={uri}
   ```

3. **Token Exchange:**
   ```
   POST https://raindrop.io/oauth/access_token
   Body: {
     "grant_type": "authorization_code",
     "code": "{auth_code}",
     "client_id": "{id}",
     "client_secret": "{secret}",
     "redirect_uri": "{uri}"
   }
   ```
   Response: `access_token`, `refresh_token`, `expires_in` (2 weeks)

4. **Token Refresh:**
   ```
   POST https://raindrop.io/oauth/access_token
   Body: {
     "grant_type": "refresh_token",
     "refresh_token": "{token}",
     "client_id": "{id}",
     "client_secret": "{secret}"
   }
   ```

### Making Authorized Calls

```
Header: Authorization: Bearer {access_token}
```

**Development:** Copy "Test token" from app settings for quick testing

---

## Collections API

### System Collections

- `-1`: Unsorted
- `-99`: Trash
- `0`: All collections

### Collection Schema

```json
{
  "_id": 123,
  "title": "String",
  "count": 0,
  "cover": ["url"],
  "color": "#HEX",
  "public": false,
  "view": "list|simple|grid|masonry",
  "created": "ISO8601",
  "lastUpdate": "ISO8601",
  "access": {
    "level": 4,
    "draggable": true
  },
  "parent": {"$id": 456},
  "sort": 0
}
```

**Access Levels:**
- 1 = Read-only
- 2 = Read collaborator
- 3 = Write collaborator
- 4 = Owner

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/collections` | Root collections |
| GET | `/collections/childrens` | Nested collections |
| GET | `/collection/{id}` | Single collection |
| POST | `/collection` | Create collection |
| PUT | `/collection/{id}` | Update collection |
| DELETE | `/collection/{id}` | Delete collection |
| DELETE | `/collections` | Delete multiple (body: `{ids: []}`) |

### Create Collection

**Request Body:**
```json
{
  "title": "string",
  "view": "list|simple|grid|masonry",
  "sort": 0,
  "public": false,
  "parent": {"$id": 123},
  "cover": ["url"]
}
```

### Update Collection

**Request Body:**
```json
{
  "title": "string",
  "view": "list|simple|grid|masonry",
  "sort": 0,
  "public": false,
  "expanded": false,
  "parent": {"$id": 123},
  "cover": ["url"]
}
```

### Sharing Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/collection/{id}/sharing` | Share with users (emails array, max 10) |
| GET | `/collection/{id}/sharing` | List collaborators |
| DELETE | `/collection/{id}/sharing` | Unshare all/leave |
| PUT | `/collection/{id}/sharing/{userId}` | Update collaborator role |
| DELETE | `/collection/{id}/sharing/{userId}` | Remove collaborator |
| POST | `/collection/{id}/join` | Accept invitation |

**Permission Levels:**
- **Member**: Write + invite others
- **Viewer**: Read-only

**Sharing Request Body:**
```json
{
  "emails": ["user@example.com"],
  "role": "member|viewer"
}
```

**Limits:**
- Max 10 emails per request
- Max 100 pending invitations per user

---

## Raindrops (Bookmarks) API

### Raindrop Schema

```json
{
  "_id": 123,
  "collection": {"$id": 456},
  "cover": "url",
  "created": "ISO8601",
  "domain": "example.com",
  "excerpt": "description (max 10k chars)",
  "note": "user notes (max 10k chars)",
  "lastUpdate": "ISO8601",
  "link": "url",
  "media": [{"link": "url"}],
  "tags": ["tag1", "tag2"],
  "title": "title (max 1k chars)",
  "type": "link|article|image|video|document|audio",
  "user": {"$id": 789},
  "important": false,
  "broken": false,
  "highlights": []
}
```

### Single Raindrop Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/raindrop/{id}` | Get raindrop |
| POST | `/raindrop` | Create |
| PUT | `/raindrop/{id}` | Update |
| DELETE | `/raindrop/{id}` | Move to trash |

**Create Request Body:**
```json
{
  "link": "https://example.com",
  "title": "optional",
  "excerpt": "optional",
  "note": "optional",
  "tags": ["tag1", "tag2"],
  "collection": {"$id": 123},
  "pleaseParse": {},
  "media": [{"link": "url"}],
  "highlights": []
}
```

**Update Request Body:**
Same fields as create. Use `pleaseParse: {}` to re-parse metadata.

**Delete Behavior:**
- First delete: Moves to Trash (collection -99)
- Delete from Trash: Permanent deletion

### Multiple Raindrops Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/raindrops/{collectionId}` | Get raindrops (use 0 for all) |
| POST | `/raindrops` | Batch create (max 100) |
| PUT | `/raindrops/{collectionId}` | Bulk update |
| DELETE | `/raindrops/{collectionId}` | Bulk delete |

**GET Query Parameters:**
- `sort`: `-created`, `created`, `score`, `title`, `-title`, `domain`, `-domain`
- `perpage`: Items per page (max 50)
- `page`: Page number (0, 1, 2...)
- `search`: Search query (see search operators)
- `nested`: Include nested collections (boolean)

**Batch Create Request:**
```json
{
  "items": [
    {"link": "url1", "title": "optional"},
    {"link": "url2", "title": "optional"}
  ]
}
```
Max 100 items per request.

**Bulk Update Request:**
```json
{
  "ids": [123, 456],
  "important": true,
  "tags": ["new", "tags"],
  "media": [],
  "cover": "url",
  "collection": {"$id": 789}
}
```

**Special cover value:** `<screenshot>` = auto-capture

**Bulk Delete:**
- Use `collectionId=-99` for permanent deletion
- Query parameters: `search`, `ids`, `nested`

---

## Search Operators

### Basic Operators

- `word word` - All words present
- `"exact phrase"` - Exact match
- `-word` - Exclude term

### Tags

- `#tag` - Single word tag
- `#"multi-word tag"` - Multi-word tag

### Date Operators

- `created:YYYY-MM-DD` - Specific date
- `created:YYYY-MM` - Month
- `created:YYYY` - Year
- `created:<YYYY-MM-DD` - Before date
- `created:>YYYY-MM-DD` - After date
- `lastUpdate:YYYY-MM-DD` - Last modified

### Field-Specific Operators

- `title:sample` or `title:"phrase"` - Search in title
- `excerpt:sample` - Search in description
- `note:sample` - Search in notes
- `link:sample` - Search in URL

### Type Operators

- `type:link`
- `type:article`
- `type:image`
- `type:video`
- `type:document`
- `type:audio`

### Status Operators

- `❤️` - Favorites only
- `file:true` - Uploaded files
- `notag:true` - Untagged items
- `cache.status:ready` - Permanent copies available
- `reminder:true` - Has reminder set
- `match:OR` - Use OR logic (default is AND)

### Pro Features

- `Broken links` - Find broken bookmarks
- `Duplicates` - Find duplicate entries

---

## Tags API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/tags/{collectionId?}` | Get tags (omit ID for all) |
| PUT | `/tags/{collectionId?}` | Rename/merge tags |
| DELETE | `/tags/{collectionId?}` | Remove tags |

**GET Query Parameters:**
- `tagsSort`: `-count` (by frequency) or `_id` (alphabetical, default)

**Response:**
```json
{
  "result": true,
  "items": [
    {"_id": "tag-name", "count": 5}
  ]
}
```

**Rename Tag Request:**
```json
{
  "replace": "new-name",
  "tags": ["old-name"]
}
```

**Merge Tags Request:**
```json
{
  "replace": "consolidated-name",
  "tags": ["tag1", "tag2", "tag3"]
}
```

**Remove Tags Request:**
```json
{
  "tags": ["tag1", "tag2"]
}
```

**Optional:** Include `collectionId` in path to restrict operation to one collection.

---

## Highlights API

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/highlights` | All highlights |
| GET | `/highlights/{collectionId}` | Collection highlights |
| GET | `/raindrop/{id}` | Highlights for raindrop |
| PUT | `/raindrop/{id}` | Add/update/remove highlights |

**Query Parameters:**
- `page`: Page number
- `perpage`: Items per page (max 50, default 25)

### Highlight Schema

```json
{
  "_id": "highlight-id",
  "text": "highlighted text",
  "title": "bookmark title",
  "color": "yellow|blue|red|green",
  "note": "annotation",
  "created": "ISO8601",
  "tags": [],
  "link": "url"
}
```

### Managing Highlights

**Add Highlights:**
```json
{
  "highlights": [
    {"text": "quote", "color": "red", "note": "annotation"}
  ]
}
```

**Update Highlight:**
```json
{
  "highlights": [
    {"_id": "existing-id", "text": "updated", "color": "blue"}
  ]
}
```

**Remove Highlight:**
```json
{
  "highlights": [
    {"_id": "existing-id", "text": ""}
  ]
}
```
Set `text` to empty string to delete.

---

## User API

**Endpoint:** `GET /user`

**Response Schema:**
```json
{
  "_id": 123,
  "email": "user@example.com",
  "email_MD5": "gravatar-hash",
  "fullName": "User Name",
  "pro": false,
  "proExpire": "ISO8601",
  "registered": "ISO8601",
  "password": true,
  "config": {
    "broken_level": "default",
    "font_color": "#hex",
    "font_size": 0,
    "lang": "en",
    "last_collection": 0,
    "raindrops_sort": "-created",
    "raindrops_view": "list"
  },
  "groups": [],
  "files": {
    "used": 0,
    "size": 104857600,
    "lastCheckPoint": "ISO8601"
  },
  "facebook": {"enabled": false},
  "twitter": {"enabled": false},
  "google": {"enabled": false},
  "vkontakte": {"enabled": false},
  "dropbox": {"enabled": false},
  "gdrive": {"enabled": false}
}
```

---

## Filters API

**Endpoint:** `GET /filters/{collectionId}`
- Use `collectionId=0` for all collections

**Query Parameters:**
- `tagsSort`: `-count` or `_id`
- `search`: Filter by search query

**Response:**
```json
{
  "result": true,
  "broken": {"count": 0},
  "duplicates": {"count": 0},
  "important": {"count": 0},
  "notag": {"count": 0},
  "tags": [
    {"_id": "tag-name", "count": 5}
  ],
  "types": [
    {"_id": "article", "count": 10},
    {"_id": "image", "count": 3}
  ]
}
```

---

## Import API

**Supported Formats:** Netscape, Pocket, Instapaper HTML bookmark files

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/import/url/parse?url={url}` | Parse URL metadata |
| POST | `/import/url/exists` | Check if URLs exist |
| POST | `/import/file` | Parse HTML import file |

**Parse URL Response:**
```json
{
  "item": {
    "title": "Page Title",
    "excerpt": "Description",
    "type": "article",
    "media": [{"link": "image-url"}],
    "meta": {
      "canonical": "url",
      "site": "Site Name",
      "tags": ["auto", "tags"]
    }
  }
}
```

**Check Existence Request:**
```json
{
  "urls": ["https://example.com", "https://example.org"]
}
```

**Check Existence Response:**
```json
{
  "result": true,
  "ids": [123, 456]
}
```

**Parse HTML Import:**
- Method: POST
- Content-Type: multipart/form-data
- Field name: `import`
- Response: Nested JSON structure with folders and bookmarks

---

## Export API

**Endpoint:** `GET /raindrops/{collectionId}/export.{format}`

**Path Parameters:**
- `collectionId`: Collection ID or `0` for all
- `format`: `csv`, `html`, or `zip`

**Query Parameters:**
- `sort`: Same as GET /raindrops (e.g., `-created`)
- `search`: Filter exports with search query

**Examples:**
```
GET /raindrops/0/export.csv
GET /raindrops/123/export.html?sort=-created
GET /raindrops/0/export.zip?search=type:article
```

---

## Backups API

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/backups` | List all backups (newest first) |
| GET | `/backup/{id}.{format}` | Download backup |
| GET | `/backup` | Generate new backup (async) |

**Backup Formats:**
- `html` - HTML bookmark file
- `csv` - CSV export

**List Response:**
```json
{
  "result": true,
  "items": [
    {
      "_id": "659d42a35ffbb2eb5ae1cb86",
      "created": "ISO8601"
    }
  ]
}
```

**Download Example:**
```
GET /backup/659d42a35ffbb2eb5ae1cb86.csv
```

**Generate Backup:**
- Async operation
- Processing time depends on bookmark count and queue
- Check `/backups` endpoint for completion

---

## Notes

### Safety Warnings

From the official documentation:

> "Our API response could contain other fields, not described above. It's unsafe to use them in your integration! They could be removed or renamed at any time."

Only use documented fields in your integration.

### Best Practices

1. **Rate Limiting:** Respect the 120 req/min limit
2. **Token Management:** Refresh tokens before 2-week expiration
3. **Search Testing:** Test search queries in the Raindrop app first, then use in API
4. **Pagination:** Use `perpage` (max 50) and `page` parameters for large result sets
5. **Error Handling:** Handle HTTP 4xx/5xx status codes appropriately
6. **Batch Operations:** Use bulk endpoints when modifying multiple items

---

## Resources

- **Official API Docs:** https://developer.raindrop.io/
- **App Management:** https://app.raindrop.io/#/settings/apps/dev
- **Search Help:** https://help.raindrop.io/using-search
