// studio/wallpaper/web/sw.js
// Offline-resilient Service Worker for GitHub Pages auto-updates.
const CACHE_NAME = 'live-zagreb-wallpaper-d31eed4fc482';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './panel.css',
    './bg/zagreb-spring.webp',
    './bg/zagreb-summer.webp',
    './bg/zagreb-autumn.webp',
    './bg/zagreb-winter.webp',
    './bg/zagreb-spring-dry.webp',
    './bg/zagreb-summer-dry.webp',
    './bg/zagreb-autumn-dry.webp',
    './bg/zagreb-winter-dry.webp',
    './fonts/press-start-2p-latin.woff2',
    './fonts/press-start-2p-latin-ext.woff2'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k.startsWith('live-zagreb-wallpaper-') && k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return; // Never intercept Open-Meteo API calls

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            return cached || fetch(event.request);
        })
    );
});
