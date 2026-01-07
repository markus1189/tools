// Raindrop Quick Add - Service Worker
// Version: 3.0.1 - Fixed PWA icons

const CACHE_NAME = 'raindrop-quick-add-v7';
const urlsToCache = [
  './raindrop-quick-add.html',
  './raindrop-quick-add.manifest.json',
  './raindrop-icon-192.png',
  './raindrop-icon-512.png'
];

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================================
// Web Share Target API - Handle POST requests with files
// ============================================================================

const SHARE_CACHE_NAME = 'raindrop-share-data';

// Handle share target POST requests
async function handleShareTarget(event) {
  const url = new URL(event.request.url);

  // Only handle share target POSTs to our app
  if (event.request.method !== 'POST' || !url.pathname.includes('raindrop-quick-add.html')) {
    return null;
  }

  try {
    const formData = await event.request.formData();
    const sharedData = {
      title: formData.get('title') || '',
      text: formData.get('text') || '',
      url: formData.get('url') || '',
      timestamp: Date.now()
    };

    // Handle shared files
    const file = formData.get('file');
    if (file && file instanceof File) {
      // Store file as blob
      sharedData.file = {
        name: file.name,
        type: file.type,
        size: file.size,
        blob: await file.arrayBuffer()
      };
    }

    // Cache the shared data
    const cache = await caches.open(SHARE_CACHE_NAME);
    const response = new Response(JSON.stringify(sharedData), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('share-data', response);

    // Redirect to the app (GET request)
    return Response.redirect(url.pathname + '?shared=true', 303);

  } catch (error) {
    console.error('[ServiceWorker] Failed to handle share target:', error);
    return Response.redirect(url.pathname, 303);
  }
}

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Handle share target POST requests
  if (event.request.method === 'POST') {
    const shareResponse = handleShareTarget(event);
    if (shareResponse) {
      event.respondWith(shareResponse);
      return;
    }
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Don't cache API requests to Raindrop.io
  if (event.request.url.includes('api.raindrop.io')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          console.log('[ServiceWorker] Found in cache:', event.request.url);
          return response;
        }

        // Clone the request
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(response => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          // Cache the fetched response for future use
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        }).catch(error => {
          console.log('[ServiceWorker] Fetch failed:', error);
          // Could return a custom offline page here
          throw error;
        });
      })
  );
});

// Handle messages from the client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============================================================================
// Background Sync API - IndexedDB Queue Management
// ============================================================================

const DB_NAME = 'raindrop-sync-queue';
const STORE_NAME = 'pending-bookmarks';
const MAX_RETRIES = 3;
const SYNC_TAG = 'sync-bookmarks';
const RAINDROP_API_BASE = 'https://api.raindrop.io/rest/v1';
const UNSORTED_COLLECTION_ID = -1;

// Open IndexedDB database
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

// Get all queued items
async function getQueuedItems() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Update queue item
async function updateQueueItem(id, updates) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const item = { ...getRequest.result, ...updates };
      const updateRequest = store.put(item);
      updateRequest.onsuccess = () => resolve();
      updateRequest.onerror = () => reject(updateRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// Remove from queue
async function removeFromQueue(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Get access token from client
async function getAccessTokenFromClient() {
  const clients = await self.clients.matchAll();
  if (clients.length === 0) {
    console.warn('[ServiceWorker] No clients available for token request');
    return null;
  }

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      reject(new Error('Token request timeout'));
    }, 5000);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data.token);
    };

    clients[0].postMessage({ type: 'GET_ACCESS_TOKEN' }, [channel.port2]);
  });
}

// Sync single bookmark
async function syncBookmark(item, token) {
  if (!token) {
    const error = new Error('No access token available');
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${RAINDROP_API_BASE}/raindrop`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      link: item.url,
      collection: { $id: UNSORTED_COLLECTION_ID },
      pleaseParse: {}
    })
  });

  if (!response.ok) {
    const error = new Error(`Sync failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return await response.json();
}

// Notify client of sync results
async function notifyClient(message) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    console.log('[ServiceWorker] Sending message to client:', message.type);
    client.postMessage(message);
  });
}

// Process sync queue
async function processSyncQueue() {
  console.log('[ServiceWorker] Processing sync queue');

  try {
    const items = await getQueuedItems();
    const pendingItems = items.filter(item => item.status === 'pending');

    if (pendingItems.length === 0) {
      console.log('[ServiceWorker] No pending items to sync');
      return;
    }

    console.log(`[ServiceWorker] Found ${pendingItems.length} items to sync`);

    // Get access token
    const token = await getAccessTokenFromClient();

    if (!token) {
      console.error('[ServiceWorker] No access token available');
      await notifyClient({ type: 'SYNC_AUTH_FAILED' });
      throw new Error('No access token');
    }

    let hasFailures = false;

    for (const item of pendingItems) {
      console.log(`[ServiceWorker] Syncing item ${item.id}: ${item.url}`);

      try {
        // Update status to syncing
        await updateQueueItem(item.id, { status: 'syncing' });

        // Sync the bookmark
        await syncBookmark(item, token);

        // Remove from queue on success
        await removeFromQueue(item.id);
        await notifyClient({ type: 'SYNC_SUCCESS', url: item.url });

        console.log(`[ServiceWorker] Successfully synced item ${item.id}`);

      } catch (error) {
        console.error(`[ServiceWorker] Failed to sync item ${item.id}:`, error);

        if (error.status === 401) {
          // Auth failure - don't retry
          await updateQueueItem(item.id, {
            status: 'failed',
            lastError: 'Invalid token'
          });
          await notifyClient({ type: 'SYNC_AUTH_FAILED' });
          hasFailures = true;

        } else {
          // Network/other error - retry with limit
          const retryCount = item.retryCount + 1;

          if (retryCount >= MAX_RETRIES) {
            console.warn(`[ServiceWorker] Max retries reached for item ${item.id}`);
            await updateQueueItem(item.id, {
              status: 'failed',
              lastError: error.message,
              retryCount
            });
            hasFailures = true;
          } else {
            console.log(`[ServiceWorker] Will retry item ${item.id} (attempt ${retryCount}/${MAX_RETRIES})`);
            await updateQueueItem(item.id, {
              status: 'pending',
              retryCount
            });
            hasFailures = true;
          }
        }
      }
    }

    // If any failures, throw to trigger Background Sync retry
    if (hasFailures) {
      console.log('[ServiceWorker] Some items failed, will retry later');
      throw new Error('Some items failed to sync');
    }

    console.log('[ServiceWorker] All items synced successfully');

  } catch (error) {
    console.error('[ServiceWorker] Sync queue processing error:', error);
    throw error;
  }
}

// Background Sync Event Handler
self.addEventListener('sync', event => {
  console.log('[ServiceWorker] Sync event received:', event.tag);

  if (event.tag === SYNC_TAG) {
    event.waitUntil(processSyncQueue());
  }
});
