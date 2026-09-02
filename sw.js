const SHELL_CACHE = 'lisbon-github-pages-v2-shell';
const MAP_CACHE = 'lisbon-github-pages-v1-maps';
const BASE = new URL('./', self.location.href);
const MAP_URLS = [
  new URL('./maps/lisbon.pmtiles', BASE).href,
  new URL('./maps/coast.pmtiles', BASE).href
];
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/leaflet.css',
  './assets/leaflet.js',
  './assets/pmtiles.js',
  './assets/protomaps-leaflet.js',
  './assets/itinerary.js?v=20260902-day1',
  './assets/app.css?v=20260902-day1',
  './assets/app.js?v=20260902-day1',
  './assets/offline.js?v=20260902-day1'
].map(function (path) {
  return new URL(path, BASE).href;
});

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names
        .filter(function (name) {
          return name.startsWith('lisbon-github-pages-') &&
            name !== SHELL_CACHE &&
            name !== MAP_CACHE;
        })
        .map(function (name) { return caches.delete(name); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function parseByteRange(header, size) {
  if (!header || !header.startsWith('bytes=') || header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start: start, end: end };
}

async function cachedMapResponse(request) {
  const cache = await caches.open(MAP_CACHE);
  const rangeHeader = request.headers.get('Range');
  let cached = await cache.match(request.url);

  if (!cached) {
    if (!rangeHeader) return fetch(request);
    const fullRequest = new Request(request.url, { cache: 'reload' });
    const response = await fetch(fullRequest);
    if (!response.ok) return response;
    await cache.put(request.url, response.clone());
    cached = response;
  }

  if (!rangeHeader) return cached;
  const blob = await cached.blob();
  const range = parseByteRange(rangeHeader, blob.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': 'bytes */' + blob.size }
    });
  }

  const body = blob.slice(range.start, range.end + 1);
  return new Response(body, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + blob.size,
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream'
    }
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(BASE.href)) return;

  if (MAP_URLS.includes(url.href)) {
    event.respondWith(cachedMapResponse(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async function (response) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(new URL('./index.html', BASE).href, response.clone());
          return response;
        })
        .catch(function () {
          return caches.match(new URL('./index.html', BASE).href);
        })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async function (response) {
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(function () { return caches.match(request); })
  );
});
