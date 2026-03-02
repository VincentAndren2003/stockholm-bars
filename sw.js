const CACHE = 'billigaste-olen-v6';
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(['/bars.json']).catch(function () {});
    })
  );
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (e) {
  var url = e.request.url;
  var isDoc = e.request.mode === 'navigate' || url.indexOf('index.html') !== -1 || url === self.location.origin + '/' || url === self.location.origin + '/index.html';
  if (isDoc) {
    e.respondWith(fetch(e.request).then(function (res) { return res; }).catch(function () { return caches.match(e.request); }));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        var clone = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(e.request, clone); });
        return res;
      });
    })
  );
});
