const staticCacheName = 'static-cache-v1'
const staticUrlsToCache = [
    '/comments.js',
    '/external-links.js',
    '/offline.html',
    '/styles.css',
]
const viewsCacheName = 'views-cache'
const cacheWhitelist = [
    staticCacheName,
    viewsCacheName,
]

function cacheStaticUrls() {
    return caches.open(staticCacheName)
        .then(cache => cache.addAll(staticUrlsToCache))
}

function cleanOldCache() {
    return caches.keys()
        .then(cacheNames => Promise.all(
            cacheNames
                .filter(cacheName => !cacheWhitelist.includes(cacheName))
                .map(cacheName => caches.delete(cacheName))
        ))
}

function viewsCacheResponse(ev) {
    return caches.open(viewsCacheName)
        .then(cache => cache.match(ev.request).then(res => res || fetch(ev.request).then(res => {
            cache.put(ev.request, res.clone())
            return res
        })))
        .catch(() => caches.match('/offline.html'))
}

self.addEventListener('install', function onInstall(ev) {
    ev.waitUntil(cacheStaticUrls())
})

self.addEventListener('activate', function onActivate(ev) {
    ev.waitUntil(cleanOldCache())
})

self.addEventListener('fetch', function onFetch(ev) {
    if (ev.request.mode === 'navigate') {
        ev.respondWith(viewsCacheResponse(ev))
        return
    }

    ev.respondWith(fetch(ev.request))
})
