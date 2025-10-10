// Main app logic: Supabase + Open-Meteo integration, comparison logic, UI wiring

// Robust Supabase client init: different UMD bundles expose different globals.
const supabase = (function() {
  if (window.supabaseJs && typeof window.supabaseJs.createClient === 'function') {
    return window.supabaseJs.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  try {
    // older bundles might export createClient directly
    if (typeof createClient === 'function') return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) { /* ignore */ }
  return null;
})();
let pollIntervalId = null;
let map, districtLayer;
let highlightedLayer = null;
let highlightColor = '#ff0000';
let suppressFilterChange = false;
let rainChart, tempChart;
let selectedDistrict = null;
let locationsIndex = null; // in-memory locations data (provinces -> districts)
let pendingFitAllAtReady = false;
// in-memory fallback storage when Supabase isn't configured
window._localUpdates = window._localUpdates || [];
window._localAlerts = window._localAlerts || [];

async function init() {
  document.getElementById('status').textContent = 'Configuring...';
  if (!supabase) {
    document.getElementById('status').textContent = 'Supabase client not found — check assets/config.js and CDN script.';
    console.warn('Supabase client not initialized. Please set CONFIG and ensure the supabase-js script is loaded.');
    // continue anyway for local/demo features
  } else {
    // Quick connectivity test: try a minimal select against a common table (may fail if table missing or anon key restricted)
    try {
      const { data: _tdata, error: _terr } = await supabase.from('district_baselines').select('id').limit(1);
      if (_terr) {
        console.warn('Supabase test query returned error (this may be expected if table is missing or anon key lacks permissions):', _terr);
        document.getElementById('status').textContent = 'Supabase connected — test query failed (see console)';
      } else {
        console.log('Supabase test query succeeded', _tdata);
        document.getElementById('status').textContent = 'Supabase connected';
      }
    } catch (e) {
      console.error('Supabase connectivity check failed', e);
      document.getElementById('status').textContent = 'Supabase connection error (see console)';
    }
  }
  setupMap();
  setupCharts();

  // load hierarchical locations and populate filter selects
  try { await loadLocations(); } catch(e){ console.warn('Failed loading locations.json', e); }

  // Attempt to get user's location to show weather on page load (non-blocking)
  try {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        console.debug('Geolocation success', lat, lon);
        document.getElementById('status').textContent = `Using your location for weather (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
        try {
          const hourly = await fetchOpenMeteoHourly(lat, lon);
          // populate charts directly from this hourly dataset
          if (hourly) {
            const labels = hourly.times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            const rain = hourly.precipitation;
            const temp = hourly.temperature;
            updateCharts(labels, rain, temp);
          }
        } catch(e) { console.warn('Failed fetching Open-Meteo for user location', e); }
      }, (err) => {
        console.debug('Geolocation denied or unavailable', err);
      }, { maximumAge: 1000*60*10, timeout: 5000 });
    }
  } catch(e) { console.warn('Geolocation call failed', e); }

  document.getElementById('refreshBtn').addEventListener('click', fetchAndProcessAll);
  document.getElementById('intervalInput').addEventListener('change', () => {
    startPolling(Number(document.getElementById('intervalInput').value));
  });

  // Sidebar nav wiring
  try {
    const navOverview = document.getElementById('nav-overview');
    const navDistricts = document.getElementById('nav-districts');
    const navAlerts = document.getElementById('nav-alerts');
    const navSettings = document.getElementById('nav-settings');
    if (navOverview) navOverview.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.cards').scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveNav(navOverview); });
    if (navAlerts) navAlerts.addEventListener('click', (e) => { e.preventDefault(); const alerts = document.querySelector('.alerts-card'); if (alerts) alerts.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveNav(navAlerts); });
    if (navDistricts) navDistricts.addEventListener('click', (e) => {
      e.preventDefault(); setActiveNav(navDistricts);
      // set filters to All provinces / All districts
      try { const provSel = document.getElementById('provinceSelect'); if (provSel) { provSel.value = ''; onProvinceChange({ target: provSel }); }
        const distSel = document.getElementById('districtSelect'); if (distSel) { distSel.value = ''; }
      } catch(e){}
  // Scroll to the map card first
  try { scrollToMap(); } catch(e) {}
  // Fit map to show all districts. If districts not loaded yet, set a pending flag so we fit when they load.
      try {
        if (districtLayer && districtLayer.getBounds && districtLayer.getBounds().isValid && districtLayer.getBounds().isValid()) {
          map.fitBounds(districtLayer.getBounds().pad(0.6));
        } else {
          pendingFitAllAtReady = true;
        }
      } catch(e) { pendingFitAllAtReady = true; }
    });
    if (navSettings) navSettings.addEventListener('click', (e) => { e.preventDefault(); openSettingsDialog(); setActiveNav(navSettings); });
  } catch(e) { /* ignore */ }

  // Defensive: delegated click handler in case direct listeners didn't attach
  try {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.addEventListener('click', (ev) => {
        const target = ev.target.closest && ev.target.closest('.nav-item');
        if (!target) return;
        // emulate clicks
        const id = target.id || '';
        if (id === 'nav-overview') { document.querySelector('.cards').scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveNav(target); }
        if (id === 'nav-alerts') { const alerts = document.querySelector('.alerts-card'); if (alerts) alerts.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveNav(target); }
        if (id === 'nav-districts') { setActiveNav(target); try { const provSel = document.getElementById('provinceSelect'); if (provSel) { provSel.value = ''; onProvinceChange({ target: provSel }); } if (districtLayer) map.fitBounds(districtLayer.getBounds().pad(0.6)); } catch(e){} }
        if (id === 'nav-settings') { openSettingsDialog(); setActiveNav(target); }
      });
    }
  } catch(e) {}

  // Poll input is now in settings; sync hidden intervalInput for compatibility
  try {
    const settingsPollInput = document.getElementById('settingsPollInput');
    const intervalInput = document.getElementById('intervalInput');
    if (settingsPollInput && intervalInput) {
      // initialize from hidden input if present
      if (intervalInput.value) settingsPollInput.value = intervalInput.value;
      settingsPollInput.addEventListener('change', () => {
        intervalInput.value = settingsPollInput.value;
        startPolling(Number(settingsPollInput.value));
      });
    }
  } catch(e) {}

  // Settings dialog controls: save/close and card visibility
  try {
    const settingsDialog = document.getElementById('settingsDialog');
    const closeBtn = document.getElementById('closeSettingsBtn');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const settingsHighlightColor = document.getElementById('settingsHighlightColor');
    if (settingsHighlightColor) settingsHighlightColor.value = highlightColor;
    if (closeBtn) closeBtn.addEventListener('click', () => closeSettingsDialog());
    if (saveBtn) saveBtn.addEventListener('click', () => {
      // sync highlight color
      const val = settingsHighlightColor && settingsHighlightColor.value;
      if (val) {
        highlightColor = val; // update variable
        const hcInput = document.getElementById('highlightColor'); if (hcInput) hcInput.value = val;
        if (highlightedLayer && highlightedLayer.feature && highlightedLayer.feature.properties) highlightLayerByFeature(highlightedLayer.feature.properties.id || highlightedLayer.feature.properties.name);
      }
      // visible cards
      document.querySelectorAll('#settingsDialog input[type="checkbox"]').forEach(cb => {
        const cardClass = cb.getAttribute('data-card');
        const el = document.querySelector('.' + cardClass);
        if (el) {
          if (cb.checked) { el.classList.remove('hidden-card'); } else { el.classList.add('hidden-card'); }
        }
      });
      // save to localStorage and sync polling
      try {
        const pollVal = Number(document.getElementById('settingsPollInput').value) || 30;
        const cfg = { highlightColor, poll: pollVal };
        localStorage.setItem('nc_settings', JSON.stringify(cfg));
        // sync hidden input and start polling
        const intervalInput = document.getElementById('intervalInput'); if (intervalInput) intervalInput.value = String(pollVal);
        startPolling(pollVal);
      } catch(e) {}
      closeSettingsDialog();
    });

    // preload checkbox states from localStorage if present
    try {
      const cfg = JSON.parse(localStorage.getItem('nc_settings') || '{}');
      if (cfg && cfg.highlightColor) {
        highlightColor = cfg.highlightColor;
        const hcInput = document.getElementById('highlightColor'); if (hcInput) hcInput.value = highlightColor;
        const settingsColor = document.getElementById('settingsHighlightColor'); if (settingsColor) settingsColor.value = highlightColor;
      }
      if (cfg && cfg.poll) {
        const sPoll = document.getElementById('settingsPollInput'); if (sPoll) sPoll.value = cfg.poll; const iPoll = document.getElementById('intervalInput'); if (iPoll) iPoll.value = cfg.poll;
      }
    } catch(e) {}

  } catch(e) { /* ignore */ }

  // chart source toggles
  const useMyLocBtn = document.getElementById('useMyLocationBtn');
  const useSelBtn = document.getElementById('useSelectedDistrictBtn');
  if (useMyLocBtn) useMyLocBtn.addEventListener('click', async () => {
    if (!navigator.geolocation) return alert('Geolocation not supported by this browser');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      document.getElementById('status').textContent = `Loading weather for your location (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
      try {
        const hourly = await fetchOpenMeteoHourly(lat, lon);
        if (hourly) {
          const labels = hourly.times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          updateCharts(labels, hourly.precipitation, hourly.temperature);
        }
      } catch(e) { console.warn('Failed Open-Meteo for my location', e); }
    }, (err)=>{ console.warn('Geolocation error', err); alert('Could not get location') });
  });

  if (useSelBtn) useSelBtn.addEventListener('click', async () => {
    if (!selectedDistrict) return alert('No district selected');
    document.getElementById('status').textContent = `Loading weather for ${selectedDistrict.name}`;
    // selectedDistrict may have latitude/longitude if geojson had centroid; otherwise try to find feature and compute center
    let lat = selectedDistrict.latitude || selectedDistrict.lat || null;
    let lon = selectedDistrict.longitude || selectedDistrict.lon || null;
    if ((!lat || !lon) && districtLayer) {
      // try finding the feature and compute center
      const feat = findDistrictFeatureByName(selectedDistrict.name);
      if (feat) {
        try {
          const layer = L.geoJSON(feat);
          const c = layer.getBounds().getCenter();
          lat = c.lat; lon = c.lng;
        } catch(e) { console.warn('Could not compute centroid for feature', e); }
      }
    }
    if (!lat || !lon) return alert('No coordinates available for selected district');
    try {
      const hourly = await fetchOpenMeteoHourly(lat, lon);
      if (hourly) {
        const labels = hourly.times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        updateCharts(labels, hourly.precipitation, hourly.temperature);
      }
    } catch(e) { console.warn('Failed Open-Meteo for selected district', e); }
  });

  await loadDistrictsSample();
  await fetchAndProcessAll();
  startPolling(Number(document.getElementById('intervalInput').value));
}

async function loadLocations() {
  try {
    const res = await fetch('data/locations.json');
    if (!res.ok) throw new Error('locations.json fetch failed');
    const js = await res.json();

    // Support two shapes:
    // 1) { provinces: [ { name, districts: [...] } ] }  -- current small index
    // 2) Rwanda-master style: { "East": { "District": { "Sector": { "Cell": ["Village", ...] } } }, ... }
    console.debug('loadLocations: locations.json shape preview', Object.keys(js || {}).slice(0,10));

    if (js && Array.isArray(js.provinces)) {
      console.debug('loadLocations: detected small-index shape with provinces array, count=', js.provinces.length);
      locationsIndex = js;
    } else if (js && typeof js === 'object') {
      console.debug('loadLocations: detected top-level map shape - normalizing to provinces[]');
      // convert top-level map -> provinces array
      const provinces = Object.keys(js).map(provName => {
        const provObj = js[provName] || {};
        const districts = Object.keys(provObj).map(dName => {
          const districtObj = provObj[dName] || {};
          const sectors = Object.keys(districtObj).map(sName => {
            const sectorObj = districtObj[sName] || {};
            const cells = Object.keys(sectorObj).map(cName => {
              const villageArr = sectorObj[cName] || [];
              const villages = Array.isArray(villageArr) ? villageArr.map(v => ({ name: v })) : [];
              return { name: cName, villages };
            });
            return { name: sName, cells };
          });
          return { name: dName, sectors };
        });
        return { name: provName, districts };
      });
      locationsIndex = { provinces };
    } else {
      locationsIndex = { provinces: [] };
    }

    // populate the selects after normalization
    populateProvinceSelect();
  } catch (err) {
    console.warn('Could not load locations.json', err);
  }
}

function populateProvinceSelect() {
  const sel = document.getElementById('provinceSelect');
  if (!sel || !locationsIndex || !locationsIndex.provinces) return;
  // Ensure idempotent population: clear listeners and options then reattach
  sel.innerHTML = '<option value="">All provinces</option>' + locationsIndex.provinces.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');

  // Remove previous listeners if any by cloning
  const selClone = sel.cloneNode(true);
  sel.parentNode.replaceChild(selClone, sel);
  selClone.addEventListener('change', onProvinceChange);

  const dsel = document.getElementById('districtSelect');
  // ensure district select exists
  if (dsel) {
    const dselClone = dsel.cloneNode(true);
    dsel.parentNode.replaceChild(dselClone, dsel);
    dselClone.addEventListener('change', onDistrictChange);
    // initialize district select for current province selection (default: All provinces)
    try { onProvinceChange({ target: selClone }); } catch(e) { /* ignore */ }
  }
}

function onProvinceChange(e) {
  const raw = e.target.value;
  const dsel = document.getElementById('districtSelect');
  if (!dsel) return;

  // If user selected the empty option (All provinces), aggregate districts from all provinces
  if (raw === '') {
    const opts = [];
    locationsIndex.provinces.forEach((p, pIdx) => {
      const districts = p.districts || [];
      districts.forEach((d, dIdx) => {
        // include province in label to disambiguate duplicate district names
        opts.push({ value: `${pIdx}::${dIdx}`, label: `${d.name} (${p.name})` });
      });
    });
    dsel.innerHTML = '<option value="">All districts</option>' + opts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');
    return;
  }

  const idx = Number(raw);
  if (Number.isNaN(idx) || !locationsIndex.provinces[idx]) {
    dsel.innerHTML = '<option value="">All districts</option>';
    return;
  }

  const districts = (locationsIndex.provinces[idx] && locationsIndex.provinces[idx].districts) || [];
  dsel.innerHTML = '<option value="">Select district</option>' + districts.map((d,i)=>`<option value="${idx}::${i}">${d.name}</option>`).join('');
}

function onDistrictChange(e) {
  if (suppressFilterChange) return;
  const v = e.target.value;
  if (!v) return;
  // value format is provinceIdx::districtIdx
  const [pIdx, dIdx] = v.split('::').map(x=>Number(x));
  const districtObj = locationsIndex.provinces[pIdx].districts[dIdx];
  if (!districtObj) return;
  // try to find the corresponding geojson feature by name and center map
  const feat = findDistrictFeatureByName(districtObj.name);
  if (feat && feat.geometry) {
    try {
      const layer = L.geoJSON(feat);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.6));
    } catch(e) { console.warn('Could not center on feature', e); }
    // prepare minimal props for selectDistrict
    const props = Object.assign({}, feat.properties || {}, { name: districtObj.name, id: feat.properties && (feat.properties.id || feat.properties.ID || feat.properties.code) });
    selectDistrict(props);
  } else {
    // feature not found; still call selectDistrict with minimal props so UI updates
    selectDistrict({ name: districtObj.name, id: districtObj.name });
  }
}

// Find province/district indexes in locationsIndex by district name
function findProvinceDistrictIndexByName(name) {
  if (!locationsIndex || !Array.isArray(locationsIndex.provinces)) return null;
  for (let p = 0; p < locationsIndex.provinces.length; p++) {
    const prov = locationsIndex.provinces[p];
    const districts = prov.districts || [];
    for (let d = 0; d < districts.length; d++) {
      if (districts[d].name && districts[d].name.toLowerCase() === String(name).toLowerCase()) return { pIdx: p, dIdx: d };
    }
  }
  return null;
}

// Programmatically set province/district selects without triggering change handlers
function setFiltersToProvinceDistrict(pIdx, dIdx) {
  try {
    const provSel = document.getElementById('provinceSelect');
    const distSel = document.getElementById('districtSelect');
    if (!provSel || !distSel) return;
    suppressFilterChange = true;
    // set province
    provSel.value = (typeof pIdx === 'number') ? String(pIdx) : '';
    // manually invoke onProvinceChange to populate district options
    try { onProvinceChange({ target: provSel }); } catch(e) {}
    // set district
    if (typeof pIdx === 'number' && typeof dIdx === 'number') {
      const val = `${pIdx}::${dIdx}`;
      // find option and set
      for (const opt of Array.from(distSel.options)) {
        if (opt.value === val) { distSel.value = val; break; }
      }
    } else {
      // if pIdx not provided, leave district list as aggregated and try to select matching option by name (if possible)
    }
  } catch(e) { /* ignore */ } finally { suppressFilterChange = false; }
}

function findDistrictFeatureByName(name) {
  if (!districtLayer) return null;
  let found = null;
  districtLayer.eachLayer(layer => {
    const p = layer.feature && layer.feature.properties;
    if (!p) return;
    if (p.name && p.name.toLowerCase() === name.toLowerCase()) found = layer.feature;
    // some geojsons store district under different keys
    if (!found && (p.District || p.NAME || p.NAME_EN) && (String(p.District || p.NAME || p.NAME_EN).toLowerCase() === name.toLowerCase())) found = layer.feature;
  });
  return found;
}

async function loadDistrictsSample() {
  // load districts: prefer `data/districts.geojson`, fall back to sample
  try {
    let data;
    // Preferred: try user-provided geoBoundaries ADM2 first (avoids 404 noise for data/districts.geojson)
    try {
      const res2 = await fetch('geoBoundaries-RWA-ADM2.geojson');
      if (res2.ok) data = await res2.json();
    } catch(e) { data = null; }
    // then try canonical data/districts.geojson
    if (!data) {
      try {
        const res = await fetch('data/districts.geojson');
        if (res.ok) data = await res.json();
      } catch(e) { data = null; }
    }
    if (!data) {
      const res = await fetch('data/districts_sample.json');
      data = await res.json();
    }

  // normalize properties: ensure id and name
    data.features.forEach((f, idx) => {
      // support multiple possible property keys from various GeoJSON sources
      f.properties.id = f.properties.id || f.properties.ID || f.properties.code || f.properties.CODE || f.properties.shapeID || f.properties.SHAPEID || idx+1;
      f.properties.name = f.properties.name || f.properties.NAME || f.properties.District || f.properties.NAME_EN || f.properties.shapeName || f.properties.SHAPENAME || (`D${f.properties.id}`);
      // store centroid-like coords for details panel
      if (f.geometry && f.geometry.type === 'Point') {
        f.properties.longitude = f.geometry.coordinates[0];
        f.properties.latitude = f.geometry.coordinates[1];
      } else if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
        // approximate centroid using Leaflet
        try {
          const layer = L.geoJSON(f);
          const latlng = layer.getBounds().getCenter();
          f.properties.latitude = latlng.lat;
          f.properties.longitude = latlng.lng;
        } catch(e) { /* ignore */ }
      }
    });

    // create the geojson layer
    districtLayer = L.geoJSON(data, {
      interactive: true,
      style: function(feature) { return { color: '#0077aa', weight: 1, fillOpacity: 0.12 }; },
      onEachFeature: (feature, layer) => {
        // ensure the layer is interactive
        // ensure the layer is interactive
        try { layer.options.interactive = true; } catch(e) {}

        layer.on('click', (ev) => {
          try {
            const bounds = layer.getBounds();
            if (bounds && bounds.isValid && bounds.isValid()) map.fitBounds(bounds.pad(0.6));
          } catch(e) { console.warn('fitBounds failed on click', e); }
          selectDistrict(feature.properties);
          // sync filters to this district (map -> filters)
          try {
            const idx = findProvinceDistrictIndexByName(feature.properties && (feature.properties.name || feature.properties.District || feature.properties.NAME));
            if (idx) setFiltersToProvinceDistrict(idx.pIdx, idx.dIdx);
          } catch(e) { /* ignore */ }
          try { layer.bindPopup(`<strong>${feature.properties.name || feature.properties.NAME || 'District'}</strong>`).openPopup(); } catch(e) {}
        });

        layer.on('mouseover', (ev) => {
          try {
            layer.setStyle({ color: '#ff9900', weight: 2, fillOpacity: 0.25 });
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) layer.bringToFront();
          } catch(e) { console.warn('mouseover style error', e); }
        });

        layer.on('mouseout', (ev) => {
          try {
            // don't reset style if this layer is the currently highlighted (selected) one
            if (highlightedLayer && highlightedLayer === layer) return;
            districtLayer.resetStyle(layer);
          } catch(e) { /* ignore */ }
        });
      }
    }).addTo(map);
    map.fitBounds(districtLayer.getBounds());
    // If a 'fit all' was requested before the geojson finished loading, perform it now
    try {
        if (pendingFitAllAtReady) {
        pendingFitAllAtReady = false;
        if (districtLayer && districtLayer.getBounds && districtLayer.getBounds().isValid && districtLayer.getBounds().isValid()) {
          map.fitBounds(districtLayer.getBounds().pad(0.6));
        }
      }
    } catch(e) { /* ignore */ }

    // Fallback: if polygon layers are not receiving click events in some browsers
    // or due to layout, listen for map-level clicks and test which district contains
    // the clicked point. This ensures districts can be selected even when layer
    // events are blocked.
    try {
      map.on('click', function(e) {
        if (!districtLayer) return;
        const latlng = e.latlng;
        let hitLayer = null;
        districtLayer.eachLayer(function(layer) {
          try {
            if (!layer.feature || !layer.feature.geometry) return;
            const g = layer.feature.geometry;
            if (g.type === 'Point') {
              // marker/point: check proximity (in meters)
              if (layer.getLatLng && layer.getLatLng().distanceTo && layer.getLatLng().distanceTo(latlng) < 5000) {
                hitLayer = layer;
              }
            } else {
              // polygon/multipolygon: use bounds containment as a quick test
              if (layer.getBounds && layer.getBounds().contains(latlng)) {
                hitLayer = layer;
              }
            }
          } catch(err) { /* ignore per-layer errors */ }
        });
        if (hitLayer) {
          try {
            selectDistrict(hitLayer.feature.properties);
            const idx = findProvinceDistrictIndexByName(hitLayer.feature.properties && (hitLayer.feature.properties.name || hitLayer.feature.properties.District || hitLayer.feature.properties.NAME));
            if (idx) setFiltersToProvinceDistrict(idx.pIdx, idx.dIdx);
          } catch(e) { /* ignore */ }
          try { hitLayer.bindPopup(`<strong>${hitLayer.feature.properties.name}</strong>`).openPopup(); } catch(e) {}
        }
      });
    } catch(e) { console.warn('Failed to install map click fallback', e); }
  } catch (err) {
    console.error('Failed loading districts sample or geojson', err);
  }
}

function setupMap() {
  map = L.map('map').setView([-1.94, 29.88], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18
  }).addTo(map);
}

function setupCharts() {
  const rCtx = document.getElementById('rainChart').getContext('2d');
  rainChart = new Chart(rCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{ label: 'Rainfall (mm)', data: [], backgroundColor: 'rgba(0,102,204,0.7)', borderColor: '#0066cc', borderWidth: 1 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { size: 13 } } }
      },
      scales: {
        x: { ticks: { font: { size: 11 }, autoSkip: false, maxRotation: 90, minRotation: 45 } },
        y: { ticks: { font: { size: 11 } }, beginAtZero: true }
      }
    }
  });

  const tCtx = document.getElementById('tempChart').getContext('2d');
  tempChart = new Chart(tCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{ label: 'Temperature (°C)', data: [], backgroundColor: 'rgba(204,51,0,0.7)', borderColor: '#cc3300', borderWidth: 1 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { size: 13 } } }
      },
      scales: {
        x: { ticks: { font: { size: 11 }, autoSkip: false, maxRotation: 90, minRotation: 45 } },
        y: { ticks: { font: { size: 11 } }, beginAtZero: false }
      }
    }
  });
}

function selectDistrict(props) {
  selectedDistrict = props;
  document.getElementById('status').textContent = `Selected ${props.name}`;
  document.getElementById('districtDetails').innerHTML = `<h3>${props.name}</h3><p>District ID: ${props.id}</p><p>Coordinates: ${props.latitude || props.lat || 'N/A'}, ${props.longitude || props.lon || 'N/A'}</p>`;
  // show recent data from Supabase if available
  loadRecentForDistrict(props.id);
  try { highlightLayerByFeature(props.id || props.name); } catch(e) { /* ignore */ }
  // Fetch Open-Meteo hourly for the district (try props coords, then feature centroid)
  (async () => {
    try {
      let lat = props.latitude || props.lat || props.latitude || props.latitude;
      let lon = props.longitude || props.lon || props.longitude || props.longitude;
      if ((!lat || !lon) && districtLayer) {
        const feat = findDistrictFeatureByName(props.name || props.id);
        if (feat) {
          try {
            const tmpLayer = L.geoJSON(feat);
            const c = tmpLayer.getBounds().getCenter();
            lat = lat || c.lat; lon = lon || c.lng;
          } catch(e) { /* ignore */ }
        }
      }
      if (!lat || !lon) return;
      const hourly = await fetchOpenMeteoHourly(lat, lon);
      if (hourly) {
        const labels = hourly.times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        updateCharts(labels, hourly.precipitation, hourly.temperature);
        // Scroll charts into view for better UX when district is selected
        try { scrollToWeather(); } catch(e) { /* ignore */ }
      }
    } catch(e) { console.warn('Failed fetching Open-Meteo for selected district', e); }
  })();
}

// Smooth-scroll the weather charts into view
function scrollToWeather() {
  try {
    const rainEl = document.getElementById('rainChart');
    if (!rainEl) return;
    const card = rainEl.closest ? rainEl.closest('.chart-card') : rainEl.parentElement;
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch(e) { /* ignore */ }
}

// Highlight helpers: keep selected district visually persistent on the map
function clearHighlight() {
  if (!districtLayer) return;
  try {
    districtLayer.eachLayer(l => districtLayer.resetStyle(l));
    highlightedLayer = null;
  } catch(e) { /* ignore */ }
}

function highlightLayerByFeature(featureIdOrName) {
  if (!districtLayer) return;
  clearHighlight();
  districtLayer.eachLayer(l => {
    try {
      const p = l.feature && l.feature.properties;
      if (!p) return;
      if (String(p.id) === String(featureIdOrName) || (p.name && p.name.toLowerCase() === String(featureIdOrName).toLowerCase())) {
        l.setStyle({ color: highlightColor, weight: 2, fillOpacity: 0.32 });
        highlightedLayer = l;
        if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) l.bringToFront();
      }
    } catch(e) { /* ignore per-layer */ }
  });
}

// wire highlight color input (if present)
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('highlightColor');
  if (!input) return;
  try {
    highlightColor = input.value || highlightColor;
    input.addEventListener('input', (e) => {
      highlightColor = e.target.value || highlightColor;
      // refresh current highlight
      if (highlightedLayer && highlightedLayer.feature && highlightedLayer.feature.properties) {
        highlightLayerByFeature(highlightedLayer.feature.properties.id || highlightedLayer.feature.properties.name);
      }
    });
  } catch(e) { /* ignore */ }
});

async function loadRecentForDistrict(districtId) {
  // query latest updates for district
  const { data, error } = await supabase.from('district_updates').select('*').eq('district_id', districtId).order('timestamp', { ascending: false }).limit(24);
  if (error) { console.error(error); return; }
  // populate charts
  const labels = data.map(r => new Date(r.timestamp).toLocaleString()).reverse();
  const rain = data.map(r => r.rainfall).reverse();
  const temp = data.map(r => r.temperature).reverse();
  updateCharts(labels, rain, temp);
}

function updateCharts(labels, rain, temp) {
  rainChart.data.labels = labels;
  rainChart.data.datasets[0].data = rain;
  rainChart.update();

  tempChart.data.labels = labels;
  tempChart.data.datasets[0].data = temp;
  tempChart.update();
}

async function fetchAndProcessAll() {
  document.getElementById('status').textContent = 'Fetching latest data...';
  // fetch baselines from Supabase (or fallback to local sample)
  let baselines = [];
  if (supabase) {
    const { data, error: bErr } = await supabase.from('district_baselines').select('*');
    if (bErr) { console.error('Baseline query failed', bErr); document.getElementById('status').textContent = 'Baseline query failed'; return; }
    baselines = data;
  } else {
    // load sample districts and create simple baseline objects
    try {
      const res = await fetch('data/districts_sample.json');
      const js = await res.json();
      baselines = js.features.map((f, idx) => ({ id: f.properties.id || idx+1, name: f.properties.name || ('D'+(idx+1)), latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0], avg_rainfall: 10 + Math.random()*30, avg_temperature: 20 + Math.random()*6 }));
    } catch (e) { console.error('Failed to load local baselines', e); }
  }

  // For each baseline, fetch Open-Meteo data for its coordinates
  for (const b of baselines) {
    try {
      const update = await fetchOpenMeteoFor(b);
      if (update) {
        await storeUpdate(b.id, update);
        const alert = detectRisks(b, update);
        if (alert) await storeAlert(b.id, alert);
      }
    } catch (err) { console.error('Error processing district', b.id, err); }
  }

  document.getElementById('status').textContent = `Last updated ${new Date().toLocaleTimeString()}`;
  await refreshAlertsList();
}

async function fetchOpenMeteoFor(baseline) {
  const lat = baseline.latitude;
  const lon = baseline.longitude;
  const url = new URL(CONFIG.OPEN_METEO_BASE);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('hourly', CONFIG.OPEN_METEO_PARAMS.hourly);
  url.searchParams.set('timezone', CONFIG.OPEN_METEO_PARAMS.timezone);
  // fetch last 24 hours hourly
  url.searchParams.set('start', new Date(Date.now() - 24*3600*1000).toISOString());
  url.searchParams.set('end', new Date().toISOString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Open-Meteo fetch failed');
  const json = await res.json();
  // naive aggregation: sum precipitation, mean temperature for last 24h
  const hours = json.hourly || {};
  const precip = hours.precipitation || [];
  const temp = hours.temperature_2m || [];
  const humidity = hours.relativehumidity_2m || [];
  const wind = hours.windspeed_10m || [];
  const totalRain = precip.reduce((a,v)=>a+(v||0),0);
  const avgTemp = temp.reduce((a,v)=>a+(v||0),0)/Math.max(1,temp.length);

  return { timestamp: new Date().toISOString(), rainfall: totalRain, temperature: Number(avgTemp.toFixed(2)), humidity: humidity.length? (humidity.reduce((a,v)=>a+v,0)/humidity.length):null, windspeed: wind.length? (wind.reduce((a,v)=>a+v,0)/wind.length):null };
}

// Fetch hourly timeseries from Open-Meteo for given coords. Returns { times:[], precipitation:[], temperature:[] }
async function fetchOpenMeteoHourly(lat, lon) {
  const url = new URL(CONFIG.OPEN_METEO_BASE);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  // request hourly fields used by charts
  url.searchParams.set('hourly', 'temperature_2m,precipitation');
  url.searchParams.set('timezone', CONFIG.OPEN_METEO_PARAMS.timezone || 'UTC');
  // last 24 hours
  url.searchParams.set('start', new Date(Date.now() - 24*3600*1000).toISOString());
  url.searchParams.set('end', new Date().toISOString());

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Open-Meteo hourly fetch failed');
  const json = await res.json();
  const hours = json.hourly || {};
  const times = hours.time || [];
  const precipitation = hours.precipitation || [];
  const temperature = hours.temperature_2m || [];
  // ensure we only return the most recent 24 points (avoid repeating hourly labels across days)
  if (times.length > 24) {
    const startIdx = times.length - 24;
    return {
      times: times.slice(startIdx),
      precipitation: precipitation.slice(startIdx),
      temperature: temperature.slice(startIdx)
    };
  }
  return { times, precipitation, temperature };
}

async function storeUpdate(districtId, update) {
  const payload = { district_id: districtId, timestamp: update.timestamp, rainfall: update.rainfall, temperature: update.temperature, humidity: update.humidity, windspeed: update.windspeed };
  if (supabase) {
    const { data, error } = await supabase.from('district_updates').insert([payload]);
    if (error) console.error('Insert update failed', error);
    return data;
  } else {
    // fallback: push to in-memory list
    window._localUpdates.push(Object.assign({ id: window._localUpdates.length+1 }, payload));
    return payload;
  }
}

function detectRisks(baseline, update) {
  // simple threshold logic
  const alerts = [];
  if (baseline.avg_rainfall != null) {
    if (update.rainfall > baseline.avg_rainfall * CONFIG.THRESHOLDS.RAINFALL_FLOOD_MULTIPLIER) {
      alerts.push({ level: 'high', type: 'flood', message: `Rainfall ${update.rainfall.toFixed(1)}mm > ${CONFIG.THRESHOLDS.RAINFALL_FLOOD_MULTIPLIER}x baseline (${baseline.avg_rainfall}mm)` });
    } else if (update.rainfall > baseline.avg_rainfall * CONFIG.THRESHOLDS.RAINFALL_WARNING_MULTIPLIER) {
      alerts.push({ level: 'medium', type: 'flood', message: `Rainfall elevated: ${update.rainfall.toFixed(1)}mm vs baseline ${baseline.avg_rainfall}mm` });
    }
  }

  if (update.temperature != null && update.temperature >= CONFIG.THRESHOLDS.TEMPERATURE_HEAT_THRESHOLD) {
    alerts.push({ level: 'high', type: 'heat', message: `High temperature ${update.temperature}°C` });
  }

  if (alerts.length === 0) return null;
  // pick highest severity
  const severity = alerts.some(a=>a.level==='high') ? 'high' : (alerts.some(a=>a.level==='medium')?'medium':'low');
  return { district_id: baseline.id, timestamp: update.timestamp, severity, details: JSON.stringify(alerts) };
}

async function storeAlert(districtId, alert) {
  if (supabase) {
    const { data, error } = await supabase.from('district_alerts').insert([alert]);
    if (error) console.error('Insert alert failed', error);
    return data;
  } else {
    window._localAlerts.push(Object.assign({ id: window._localAlerts.length+1 }, alert));
    return alert;
  }
}

async function refreshAlertsList() {
  let data = [];
  if (supabase) {
    const resp = await supabase.from('district_alerts').select('id,district_id,severity,timestamp,details').order('timestamp', { ascending: false }).limit(50);
    if (resp.error) { console.error(resp.error); return; }
    data = resp.data;
  } else {
    data = window._localAlerts.slice().reverse().slice(0,50);
  }
  const ul = document.getElementById('alertsList');
  ul.innerHTML = '';
  for (const a of data) {
    const li = document.createElement('li');
    li.className = a.severity==='high' ? 'alert-high' : a.severity==='medium' ? 'alert-medium' : 'alert-low';
    let details = a.details;
    try { details = typeof a.details === 'string' ? JSON.parse(a.details) : a.details; } catch(e){}
    const detailsHtml = Array.isArray(details) ? details.map(d=>`<div style="font-size:13px;color:#374151">${d.type.toUpperCase()}: ${d.message}</div>`).join('') : `<div>${details}</div>`;
    li.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="text-transform:capitalize">${a.severity}</strong> · District ${a.district_id}</div><small style="color:#64748b">${new Date(a.timestamp).toLocaleString()}</small></div>${detailsHtml}`;
    ul.appendChild(li);
  }
  // update overall risk summary
  const highest = data.find(d=>d.severity==='high') ? 'High' : data.find(d=>d.severity==='medium') ? 'Medium' : data.length? 'Low' : 'None';
  document.getElementById('overallRisk').textContent = highest;
}

function startPolling(minutes) {
  // clear existing
  if (pollIntervalId) clearInterval(pollIntervalId);
  const ms = Math.max(1, minutes) * 60 * 1000;
  pollIntervalId = setInterval(fetchAndProcessAll, ms);
}

// start
init().catch(err=>console.error(err));

// UI helpers
function setActiveNav(el) {
  try {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (el && el.classList) el.classList.add('active');
  } catch(e) {}
}

function openSettingsDialog() {
  try {
    const dlg = document.getElementById('settingsDialog');
    if (!dlg) return;
    dlg.classList.remove('hidden');
    dlg.setAttribute('aria-hidden', 'false');
  } catch(e) {}
}

function closeSettingsDialog() {
  try {
    const dlg = document.getElementById('settingsDialog');
    if (!dlg) return;
    dlg.classList.add('hidden');
    dlg.setAttribute('aria-hidden', 'true');
  } catch(e) {}
}

function scrollToMap() {
  try {
    const mapCard = document.querySelector('.map-card');
    if (!mapCard) return;
    if (typeof mapCard.scrollIntoView === 'function') mapCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch(e) {}
}
