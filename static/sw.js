const VERSION = 2
const staticCacheName = `static-cache-v${VERSION}`
const staticUrlsToCache = [
    '/comments.js',
    '/external-links.js',
    '/manifest.json',
    '/offline.html',
    '/styles.css',
]
const viewsCacheName = 'views-cache-v${VERSION}'
const cacheWhitelist = [
    staticCacheName,
    viewsCacheName,
]

async function cacheStaticUrls() {
    const cache = await caches.open(staticCacheName)
    return cache.addAll(staticUrlsToCache)
}

function onInstall(ev) {
    ev.waitUntil(cacheStaticUrls())
}

async function cleanOldCache() {
    const cacheNames = await caches.keys()
    const promises = cacheNames
        .filter(cacheName => !cacheWhitelist.includes(cacheName))
        .map(cacheName => caches.delete(cacheName))
    return Promise.all(promises)
}

function onActivate(ev) {
    ev.waitUntil(cleanOldCache())
}

async function viewsCacheResponse(ev) {
    try {
        const res = await fetch(ev.request)
        const cache = await caches.open(viewsCacheName)
        cache.put(ev.request, res.clone())
        return res
    } catch (_) {
        const res = await caches.match(ev.request)
        return res
            ? res
            : caches.match('/offline.html')
    }
}

async function staticCacheResponse(ev) {
    const res = await caches.match(ev.request)
    return res
        ? res
        : fetch(ev.request)
}

function onFetch(ev) {
    const url = new URL(ev.request.url)

    if (ev.request.mode === 'navigate' && url.pathname.endsWith('/')) {
        ev.respondWith(viewsCacheResponse(ev))
        return
    }

    if (ev.request.method === 'GET' && url.origin === location.origin && staticUrlsToCache.includes(url.pathname))
        ev.respondWith(staticCacheResponse(ev))
}

self.addEventListener('install', onInstall)
self.addEventListener('activate', onActivate)
self.addEventListener('fetch', onFetch)
