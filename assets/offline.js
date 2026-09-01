(function () {
  'use strict';

  var button = document.getElementById('offline-button');
  var status = document.getElementById('offline-status');
  var mapUrls = ['./maps/lisbon.pmtiles', './maps/coast.pmtiles'];
  if (!button) return;

  function setOfflineState(label, disabled, ready) {
    button.textContent = label;
    button.disabled = disabled;
    button.classList.toggle('is-ready', Boolean(ready));
    if (status) status.textContent = label;
  }

  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    setOfflineState('浏览器不支持离线', true, false);
    return;
  }

  navigator.serviceWorker.register('./sw.js').catch(function () {
    setOfflineState('离线功能载入失败', false, false);
  });

  async function checkMaps() {
    var cache = await caches.open('lisbon-github-pages-v1-maps');
    var matches = await Promise.all(mapUrls.map(function (url) {
      return cache.match(url);
    }));
    if (matches.every(Boolean)) setOfflineState('已保存离线', false, true);
  }

  button.addEventListener('click', async function () {
    setOfflineState('准备下载…', true, false);
    try {
      var cache = await caches.open('lisbon-github-pages-v1-maps');
      var labels = ['下载市区街图 1/2…', '下载海岸街图 2/2…'];
      for (var i = 0; i < mapUrls.length; i += 1) {
        var existing = await cache.match(mapUrls[i]);
        if (!existing) {
          setOfflineState(labels[i], true, false);
          var response = await fetch(mapUrls[i], { cache: 'reload' });
          if (!response.ok) throw new Error('地图下载失败');
          await cache.put(mapUrls[i], response);
        }
      }
      setOfflineState('已保存离线', false, true);
    } catch (_) {
      setOfflineState('失败，点此重试', false, false);
    }
  });

  checkMaps().catch(function () {});
})();
