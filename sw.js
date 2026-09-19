'use strict';
// Bump the release identifier whenever any application asset changes.
const CACHE_PREFIX = 'count-app-' + new URL(self.registration.scope).pathname + '-';
const CACHE = CACHE_PREFIX + 'v4.0.16';
const PRECACHE = [
  './', './index.html', './manifest.webmanifest', './app.bundle.js',
  './src/app.js', './src/model.js', './src/storage.js', './src/catalog.js', './src/strings.js', './src/voice.js', './src/cloud.js', './src/styles.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './images/crateGrnE.webp', './images/crateBluE.webp', './images/crateGrnF.webp', './images/crateBluF.webp',
  './images/crateGrnGarage.webp', './images/crateTub.webp', './images/keg20.webp', './images/keg20slim.webp', './images/palEUR.webp'
];
const ASSETS = new Set(PRECACHE.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const home = new URL('./', self.registration.scope).pathname;
  const isAppPage = event.request.mode === 'navigate' && (url.pathname === home || url.pathname === home + 'index.html');
  if (!isAppPage && !ASSETS.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(isAppPage ? new URL('./index.html', self.registration.scope).href : event.request);
    return cached || fetch(event.request);
  }));
});

