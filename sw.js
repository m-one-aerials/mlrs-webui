const CACHE_NAME = 'mlrs-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/serial.js',
    '/js/parser.js',
    '/js/api.js',
    '/js/ui.js',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon.svg',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
});
