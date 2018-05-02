const VERSION = 3
const staticCacheName = `static-v${VERSION}`
const staticUrlsToCache = [
    '/comments.js',
    '/external-links.js',
    '/manifest.json',
    '/offline.html',
    '/styles.css',
]
const viewsCacheName = 'views'
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

async function handleViewRequest(req) {
    try {
        const res = await fetch(req)
        const cache = await caches.open(viewsCacheName)
        cache.put(req, res.clone())
        return res
    } catch (_) {
        const res = await caches.match(req)
        return res
            ? res
            : caches.match('/offline.html')
    }
}

async function handleStaticRequest(req) {
    const res = await caches.match(req)
    return res
        ? res
        : fetch(req)
}

function onFetch(ev) {
    const url = new URL(ev.request.url)

    if (ev.request.mode === 'navigate' && url.pathname.endsWith('/')) {
        ev.respondWith(handleViewRequest(ev.request))
        return
    }

    if (ev.request.method === 'GET' && url.origin === location.origin && staticUrlsToCache.includes(url.pathname))
        ev.respondWith(handleStaticRequest(ev.request))
}

self.addEventListener('install', onInstall)
self.addEventListener('activate', onActivate)
self.addEventListener('fetch', onFetch)
