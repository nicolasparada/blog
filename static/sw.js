const VERSION = 19
const staticCacheName = `static-v${VERSION}`
const staticUrlsToCache = [
    '/external-links.js',
    '/manifest.json',
    '/offline.html',
    '/reg-sw.js',
    '/styles.css',
    '/syntax.css',
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

async function staleWhileRevalidate(req, cacheName) {
    const cache = await caches.open(cacheName)
    const res = await cache.match(req)
    const network = fetch(req).then(res => {
        cache.put(req, res.clone())
        return res
    }).catch(() => caches.match('/offline.html'))
    return res || network
}

async function cachedFirst(req) {
    const res = await caches.match(req)
    return res ? res : fetch(req)
}

function onFetch(ev) {
    const url = new URL(ev.request.url)

    if (ev.request.mode === 'navigate' && url.pathname.endsWith('/')) {
        ev.respondWith(staleWhileRevalidate(ev.request, viewsCacheName))
        return
    }

    ev.respondWith(cachedFirst(ev.request))
}

/**
 *
 * @param {MessageEvent} event
 */
function onMessage(event) {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting()
    }
}

self.addEventListener('install', onInstall)
self.addEventListener('activate', onActivate)
self.addEventListener('fetch', onFetch)
self.addEventListener('message', onMessage)
