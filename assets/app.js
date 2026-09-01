(function () {
  'use strict';

  var DATA = window.LISBON_DATA;
  var routes = DATA.routes;
  var starts = DATA.starts;
  var routeId = 'day1';
  var stopIndex = 0;
  var startId = 'eduardo';
  var map = null;
  var currentBaseLayer = null;
  var activeMapKey = '';
  var routeLayer = null;
  var markerLayer = null;
  var markerById = {};
  var mapRenderToken = 0;
  var archiveSources = {};
  var baseLayers = {};
  var mapUrls = {
    lisbon: './maps/lisbon.pmtiles',
    coast: './maps/coast.pmtiles'
  };

  var els = {
    app: document.getElementById('app'),
    tabs: document.getElementById('route-tabs'),
    starts: document.getElementById('start-buttons'),
    intro: document.getElementById('intro'),
    progress: document.getElementById('progress'),
    card: document.getElementById('stop-card'),
    nav: document.getElementById('nav-row'),
    list: document.getElementById('stop-list'),
    fit: document.getElementById('fit-route'),
    loading: document.getElementById('map-loading'),
    loadingTitle: document.getElementById('loading-title'),
    loadingNote: document.getElementById('loading-note')
  };

  var statusText = {
    open: '可去',
    closed: '暂停 / 关闭',
    booking: '需确认订单',
    optional: '可删'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function findRoute() {
    for (var i = 0; i < routes.length; i += 1) {
      if (routes[i].id === routeId) return routes[i];
    }
    return routes[0];
  }

  function findStart() {
    for (var i = 0; i < starts.length; i += 1) {
      if (starts[i].id === startId) return starts[i];
    }
    return starts[0];
  }

  function routeStops(route) {
    var copied = route.stops.map(function (stop) {
      return Object.assign({}, stop);
    });
    if (route.id === 'day1') {
      var selected = findStart();
      copied[0] = Object.assign({}, copied[0], {
        name: selected.name,
        lat: selected.lat,
        lon: selected.lon,
        note: selected.id === 'eduardo'
          ? '从 SB 标志出发；后面的顺序不变。'
          : '从自由大道出发；后面的顺序不变，去 Bica 的 Bolt 时间会略短。'
      });
    }
    return copied;
  }

  function saveProgress() {
    try {
      localStorage.setItem('lisbon-standalone-progress', JSON.stringify({
        routeId: routeId,
        stopIndex: stopIndex,
        startId: startId
      }));
    } catch (_) {}
  }

  function restoreProgress() {
    try {
      var saved = JSON.parse(localStorage.getItem('lisbon-standalone-progress') || '{}');
      if (routes.some(function (route) { return route.id === saved.routeId && route.id !== 'closed'; })) {
        routeId = saved.routeId;
      }
      if (starts.some(function (start) { return start.id === saved.startId; })) {
        startId = saved.startId;
      }
      if (Number.isInteger(saved.stopIndex) && saved.stopIndex >= 0) {
        stopIndex = saved.stopIndex;
      }
    } catch (_) {}
  }

  function renderTabs(route) {
    els.tabs.innerHTML = routes
      .filter(function (item) { return item.id !== 'closed'; })
      .map(function (item) {
        return '<button type="button" data-route="' + escapeHtml(item.id) + '" class="' +
          (item.id === route.id ? 'active' : '') + '">' + escapeHtml(item.label) + '</button>';
      }).join('');
    Array.prototype.forEach.call(els.tabs.querySelectorAll('button'), function (button) {
      button.addEventListener('click', function () {
        routeId = button.getAttribute('data-route');
        stopIndex = 0;
        render();
      });
    });
  }

  function renderStarts() {
    els.starts.innerHTML = starts.map(function (start) {
      return '<button type="button" data-start="' + escapeHtml(start.id) + '" class="' +
        (start.id === startId ? 'active' : '') + '">' + escapeHtml(start.shortName) + '</button>';
    }).join('');
    Array.prototype.forEach.call(els.starts.querySelectorAll('button'), function (button) {
      button.addEventListener('click', function () {
        startId = button.getAttribute('data-start');
        if (routeId === 'day1') stopIndex = 0;
        render();
      });
    });
  }

  function renderIntro(route) {
    els.intro.innerHTML =
      '<div class="date-chip">' + escapeHtml(route.date) + '</div>' +
      '<h2>' + escapeHtml(route.title) + '</h2>' +
      '<p>' + escapeHtml(route.summary) + '</p>' +
      '<div class="weather"><span aria-hidden="true">☀</span>' + escapeHtml(route.weather) + '</div>' +
      '<div class="alert"><strong>现场提醒：</strong> ' + escapeHtml(route.alert) + '</div>';
  }

  function renderCard(route, stops) {
    var stop = stops[stopIndex];
    var status = statusText[stop.status] || stop.status;
    var official = stop.officialUrl
      ? '<a class="official" href="' + escapeHtml(stop.officialUrl) +
        '" target="_blank" rel="noreferrer">联网时打开官网 ↗</a>'
      : '';
    var leg = '';
    if (stop.next) {
      leg =
        '<div class="leg">' +
          '<div class="leg-head"><span>接下来：' + escapeHtml(stop.next.mode) + '</span>' +
          '<span>约 ' + escapeHtml(stop.next.minutes) + ' 分钟</span></div>' +
          '<p>' + escapeHtml(stop.next.instruction) + '</p>' +
          '<p class="fallback"><strong>备选：</strong>' + escapeHtml(stop.next.fallback) + '</p>' +
        '</div>';
    }
    els.card.innerHTML =
      '<div class="stop-kicker"><span>第 ' + (stopIndex + 1) + ' / ' + stops.length + ' 站</span>' +
      '<span class="status ' + escapeHtml(stop.status) + '">' + escapeHtml(status) + '</span></div>' +
      '<h3>' + escapeHtml(stop.name) + '</h3>' +
      '<div class="stop-time">' + escapeHtml(stop.time) + ' · ' + escapeHtml(stop.duration) + '</div>' +
      '<p class="action">' + escapeHtml(stop.action) + '</p>' +
      '<p class="note">' + escapeHtml(stop.note) + '</p>' +
      official + leg;

    var percent = Math.round(((stopIndex + 1) / stops.length) * 100);
    els.progress.innerHTML =
      '<div class="progress-copy"><span>' + escapeHtml(route.label) + '</span><span>' + percent + '%</span></div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div>';

    els.nav.innerHTML =
      '<button type="button" id="previous-stop"' + (stopIndex === 0 ? ' disabled' : '') + '>← 上一站</button>' +
      '<button type="button" id="next-stop"' + (stopIndex === stops.length - 1 ? ' disabled' : '') + '>下一站 →</button>';
    document.getElementById('previous-stop').addEventListener('click', function () {
      if (stopIndex > 0) {
        stopIndex -= 1;
        render();
      }
    });
    document.getElementById('next-stop').addEventListener('click', function () {
      if (stopIndex < stops.length - 1) {
        stopIndex += 1;
        render();
      }
    });
  }

  function renderList(stops) {
    els.list.innerHTML = stops.map(function (stop, index) {
      return '<button type="button" data-index="' + index + '" class="' +
        (index === stopIndex ? 'active' : '') + '">' +
        '<span class="stop-number">' + (index + 1) + '</span>' +
        '<span class="stop-name">' + escapeHtml(stop.name) + '</span>' +
        '<time>' + escapeHtml(stop.time) + '</time>' +
      '</button>';
    }).join('');
    Array.prototype.forEach.call(els.list.querySelectorAll('button'), function (button) {
      button.addEventListener('click', function () {
        stopIndex = Number(button.getAttribute('data-index'));
        render();
      });
    });
  }

  function setLoading(title, note, error) {
    els.loading.classList.remove('hidden');
    els.loadingTitle.textContent = title;
    els.loadingNote.textContent = note || '';
    els.loadingTitle.classList.toggle('map-error', Boolean(error));
    var spinner = els.loading.querySelector('.loader');
    spinner.style.display = error ? 'none' : 'block';
  }

  function hideLoading() {
    els.loading.classList.add('hidden');
  }

  function nextPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        setTimeout(resolve, 0);
      });
    });
  }

  function EmbeddedSource(elementId, label) {
    this.elementId = elementId;
    this.label = label;
    this.bytes = null;
    this.loading = null;
  }

  EmbeddedSource.prototype.getKey = function () {
    return 'embedded://' + this.elementId;
  };

  EmbeddedSource.prototype.ensureBytes = function () {
    var self = this;
    if (self.bytes) return Promise.resolve(self.bytes);
    if (self.loading) return self.loading;

    self.loading = (async function () {
      var element = document.getElementById(self.elementId);
      var base64 = element.textContent.replace(/\s/g, '');
      var padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
      var outputLength = Math.floor(base64.length * 3 / 4) - padding;
      var output = new Uint8Array(outputLength);
      var chunkSize = 1024 * 1024;
      var offset = 0;

      for (var start = 0; start < base64.length; start += chunkSize) {
        var chunk = atob(base64.slice(start, Math.min(start + chunkSize, base64.length)));
        for (var i = 0; i < chunk.length; i += 1) output[offset + i] = chunk.charCodeAt(i);
        offset += chunk.length;
        if (start > 0 && start % (chunkSize * 4) === 0) {
          els.loadingNote.textContent = self.label + '已读取 ' +
            Math.min(99, Math.round((start / base64.length) * 100)) + '%';
          await nextPaint();
        }
      }

      self.bytes = output;
      element.textContent = '';
      return output;
    })();
    return self.loading;
  };

  EmbeddedSource.prototype.getBytes = async function (offset, length, signal) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    var bytes = await this.ensureBytes();
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return { data: bytes.slice(offset, offset + length).buffer };
  };

  function getArchiveSource(mapKey) {
    if (!archiveSources[mapKey]) {
      archiveSources[mapKey] = new EmbeddedSource(
        mapKey === 'coast' ? 'pmtiles-coast' : 'pmtiles-lisbon',
        mapKey === 'coast' ? '海岸街图' : '市区街图'
      );
    }
    return archiveSources[mapKey];
  }

  function getMapArchive(mapKey) {
    var embedded = document.getElementById(
      mapKey === 'coast' ? 'pmtiles-coast' : 'pmtiles-lisbon'
    );
    return new pmtiles.PMTiles(
      embedded ? getArchiveSource(mapKey) : mapUrls[mapKey]
    );
  }

  async function ensureBaseLayer(mapKey, token) {
    if (baseLayers[mapKey]) return baseLayers[mapKey];
    setLoading(
      mapKey === 'coast' ? '正在打开海岸街图' : '正在打开里斯本市区街图',
      '地图已经在这个 HTML 里；首次读取需要几秒，不需要网络。',
      false
    );
    await nextPaint();
    var archive = getMapArchive(mapKey);
    await archive.getHeader();
    if (token !== mapRenderToken) return null;
    var layer = protomapsL.leafletLayer({
      url: archive,
      flavor: 'light',
      lang: 'en',
      maxDataZoom: 15,
      attribution: '离线街图 · OpenStreetMap / Protomaps'
    });
    baseLayers[mapKey] = layer;
    return layer;
  }

  function clearRouteLayers() {
    if (routeLayer) map.removeLayer(routeLayer);
    if (markerLayer) map.removeLayer(markerLayer);
    routeLayer = null;
    markerLayer = null;
    markerById = {};
  }

  function addRouteLayers(route, stops, shouldFit) {
    clearRouteLayers();
    var points = stops.map(function (stop) { return [stop.lat, stop.lon]; });
    routeLayer = L.polyline(points, {
      color: route.color,
      weight: 5,
      opacity: .9,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: route.id === 'coast' ? '10 8' : null
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    stops.forEach(function (stop, index) {
      var marker = L.marker([stop.lat, stop.lon], {
        keyboard: true,
        title: (index + 1) + '. ' + stop.name,
        icon: L.divIcon({
          className: 'leaflet-route-icon-shell',
          html: '<div class="leaflet-route-icon ' +
            (stop.status === 'closed' ? 'is-closed ' : '') +
            (index === stopIndex ? 'is-active' : '') +
            '"><span>' + (index + 1) + '</span></div>',
          iconSize: [43, 49],
          iconAnchor: [21, 44]
        })
      });
      marker.bindTooltip((index + 1) + '. ' + stop.name, {
        direction: 'top',
        offset: [0, -34]
      });
      marker.on('click', function () {
        stopIndex = index;
        render();
      });
      marker.addTo(markerLayer);
      markerById[stop.id] = marker;
    });

    if (shouldFit || !map.getBounds().isValid()) {
      map.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [45, 58],
        paddingBottomRight: [45, 58],
        maxZoom: route.mapKey === 'coast' ? 11 : 14
      });
    } else {
      map.panTo([stops[stopIndex].lat, stops[stopIndex].lon], { animate: true, duration: .3 });
    }
  }

  async function renderMap(route, stops, routeChanged) {
    var token = ++mapRenderToken;
    try {
      var mapKeyChanged = activeMapKey !== route.mapKey;
      if (mapKeyChanged) {
        var layer = await ensureBaseLayer(route.mapKey, token);
        if (!layer || token !== mapRenderToken) return;
        if (currentBaseLayer) map.removeLayer(currentBaseLayer);
        currentBaseLayer = layer;
        currentBaseLayer.addTo(map);
        activeMapKey = route.mapKey;
      }
      if (token !== mapRenderToken) return;
      addRouteLayers(route, stops, routeChanged || mapKeyChanged);
      hideLoading();
    } catch (error) {
      setLoading(
        '街图读取失败',
        (error && error.message ? error.message : '未知错误') +
          '。逐站说明仍可用；可尝试关闭后重新打开 HTML。',
        true
      );
    }
  }

  function render() {
    var previousRoute = els.app.getAttribute('data-route');
    var route = findRoute();
    var stops = routeStops(route);
    stopIndex = Math.min(stopIndex, stops.length - 1);
    var routeChanged = previousRoute !== route.id;

    els.app.setAttribute('data-route', route.id);
    els.app.style.setProperty('--route', route.color);
    renderTabs(route);
    renderStarts();
    renderIntro(route);
    renderCard(route, stops);
    renderList(stops);
    saveProgress();
    renderMap(route, stops, routeChanged);
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      minZoom: 8,
      maxZoom: 18
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.setView([38.711, -9.145], 12);
    els.fit.addEventListener('click', function () {
      var route = findRoute();
      var stops = routeStops(route);
      var points = stops.map(function (stop) { return [stop.lat, stop.lon]; });
      map.fitBounds(L.latLngBounds(points), {
        padding: [45, 45],
        maxZoom: route.mapKey === 'coast' ? 11 : 14
      });
    });
  }

  restoreProgress();
  initMap();
  render();
})();
