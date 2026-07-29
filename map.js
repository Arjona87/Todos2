/* =========================================================================
   map.js — Mapa dinámico de robos de vehículo georreferenciados
   Usa lat/lon ya reproyectados en data.js (a partir de wkt_geom, EPSG:32613).
   Nunca recibe ni muestra campos sensibles: solo fecha, colonia, sector,
   modalidad, violencia y marca/submarca (ver gobernanza de datos, data.js).
   ========================================================================= */

let LEAFLET_MAP = null;
let MARKERS_LAYER = null;
let HEAT_LAYER = null;
let MAP_VIEW = "points"; // Opción 3: "points" | "heat"

// Municipios del AMG (idéntico al listado documentado en CAPAS_MAPA_COMPLETO.md)
const MUNICIPIOS_AMG = [
  'Guadalajara', 'Zapopan', 'San Pedro Tlaquepaque',
  'Tlajomulco de Zuñiga', 'Tonala', 'El Salto',
  'Juanacatlan', 'Ixtlahuacan de los Membrillos', 'Zapotlanejo',
];

function normalizaNombre(str) {
  return (str || "").toLowerCase().replace(/ú/g, "u").replace(/á/g, "a");
}

function initMap() {
  if (LEAFLET_MAP) return LEAFLET_MAP;

  LEAFLET_MAP = L.map("map", { zoomControl: true }).setView([20.676, -103.39], 11);

  // Pane dedicado para los puntos de robos, SIEMPRE por encima de las
  // fronteras municipales (overlayPane), para que el clic en un punto
  // muestre la información del evento y no la del municipio debajo.
  LEAFLET_MAP.createPane("cgesMarkersPane");
  LEAFLET_MAP.getPane("cgesMarkersPane").style.zIndex = 650;

  // Capa base "Relieve" — EXACTAMENTE la misma que usa ETA (Esri World_Topo_Map).
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    { attribution: '© Esri, HERE, Garmin, Intermap, increment P Corp.', crossOrigin: true }
  ).addTo(LEAFLET_MAP);

  // Fronteras municipales (idénticas a ETA): Jalisco completo (punteado, fondo)
  // + AMG resaltado en verde fluorescente. Se cargan de forma asíncrona.
  fetch("jalisco_municipios.geojson")
    .then(r => r.json())
    .catch(() => window.__CGES_MUNICIPIOS_GEOJSON_INLINE__ || { type: "FeatureCollection", features: [] })
    .then(jaliscoBorders => {
      const jaliscoLayer = L.geoJSON(jaliscoBorders, {
        style: { color: "#000000", weight: 2, opacity: 0.1, fillOpacity: 0.1, dashArray: "3,3" },
        onEachFeature: (feature, layer) => {
          const nombre = feature.properties.NOMGEO || feature.properties.name || feature.properties.NOM_MUN;
          layer.bindPopup(`${nombre}`);
        },
      });

      const amgFeatures = jaliscoBorders.features.filter(f => {
        const nombre = f.properties.NOMGEO || f.properties.name || f.properties.NOM_MUN;
        return MUNICIPIOS_AMG.some(mun => normalizaNombre(nombre).includes(normalizaNombre(mun)));
      });

      const amgLayer = L.geoJSON({ type: "FeatureCollection", features: amgFeatures }, {
        style: { color: "#66FF66", weight: 2, opacity: 0.2, fillOpacity: 0.2, fillColor: "#66FF66" },
        onEachFeature: (feature, layer) => {
          const nombre = feature.properties.NOMGEO || feature.properties.name || feature.properties.NOM_MUN;
          layer.bindPopup(`<strong>Municipio AMG:</strong> ${nombre}`);
        },
      });

      L.layerGroup([jaliscoLayer, amgLayer]).addTo(LEAFLET_MAP);
    })
    .catch(err => console.warn("No se pudieron cargar las fronteras municipales:", err));

  MARKERS_LAYER = L.layerGroup();
  LEAFLET_MAP.addLayer(MARKERS_LAYER);

  wireMapViewToggle();

  return LEAFLET_MAP;
}

// Opción 3 — Mapa de calor (benchmark: Palantir Gotham, C4 Bogotá, C5 CDMX):
// alterna entre puntos individuales (útil para inspeccionar un evento) y una
// capa de intensidad por concentración (útil para un vistazo ejecutivo de 2
// segundos: "¿dónde está el problema?"). Usa las mismas coordenadas lat/lon
// ya reproyectadas — no requiere ningún cálculo de datos adicional.
function buildHeatLayer(withGeo) {
  if (typeof L.heatLayer !== "function") return null; // plugin no cargó (ver index.html)
  const points = withGeo.map(r => [r.lat, r.lon, 0.55]);
  if (HEAT_LAYER) LEAFLET_MAP.removeLayer(HEAT_LAYER);
  HEAT_LAYER = L.heatLayer(points, {
    radius: 24, blur: 20, maxZoom: 15, minOpacity: 0.35,
    gradient: { 0.2: "#1B4F91", 0.4: "#2E6DB4", 0.6: "#F5821F", 0.8: "#E8792D", 1.0: "#D64545" },
  });
  return HEAT_LAYER;
}

function applyMapView() {
  if (!LEAFLET_MAP) return;
  if (MAP_VIEW === "heat" && HEAT_LAYER) {
    if (LEAFLET_MAP.hasLayer(MARKERS_LAYER)) LEAFLET_MAP.removeLayer(MARKERS_LAYER);
    if (!LEAFLET_MAP.hasLayer(HEAT_LAYER)) HEAT_LAYER.addTo(LEAFLET_MAP);
  } else {
    if (HEAT_LAYER && LEAFLET_MAP.hasLayer(HEAT_LAYER)) LEAFLET_MAP.removeLayer(HEAT_LAYER);
    if (!LEAFLET_MAP.hasLayer(MARKERS_LAYER)) MARKERS_LAYER.addTo(LEAFLET_MAP);
  }
}

function wireMapViewToggle() {
  const toggle = document.getElementById("map-view-toggle");
  if (!toggle || toggle.dataset.wired) return;
  toggle.dataset.wired = "1";
  toggle.querySelectorAll(".pill-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".pill-toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      MAP_VIEW = btn.dataset.mapView;
      applyMapView();
    });
  });
}

function markerColor(record) {
  return record.conViolencia ? "#F5821F" : "#2E6DB4";
}

function popupHtml(record) {
  // Solo metadatos mínimos y no sensibles — nunca folio, nombre o placa.
  const fecha = record.fecha
    ? new Date(record.fecha).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })
    : "Fecha no disponible";

  // Línea "Vehículo" solo si el delito es vehicular Y hay dato real de marca/submarca
  // (evita mostrar "Vehículo: Sin Dato Sin Dato" en delitos donde no aplica).
  const hayVehiculo = record.esVehicular && record.marca !== "SIN DATO";
  const lineaVehiculo = hayVehiculo
    ? `<div><b>Vehículo:</b> ${window.CGES.toTitle(record.marca)} ${window.CGES.toTitle(record.submarca)}</div>`
    : "";

  return `
    <div style="font-family:Inter,sans-serif; font-size:12.5px; min-width:190px;">
      <div style="font-weight:700; color:#13294B; margin-bottom:4px;">${window.CGES.toTitle(record.delitoEst)}</div>
      <div style="color:#4A4F57; margin-bottom:6px;">${fecha}</div>
      <div><b>Municipio:</b> ${window.CGES.toTitle(record.municipio)}</div>
      <div><b>Colonia:</b> ${window.CGES.toTitle(record.colonia)}</div>
      <div><b>Sector:</b> ${record.sector}</div>
      <div><b>Modalidad:</b> ${window.CGES.toTitle(record.modus)}</div>
      <div><b>Violencia:</b> ${record.conViolencia ? "Sí" : "No"}</div>
      ${lineaVehiculo}
    </div>`;
}

function renderMapMarkers(records) {
  initMap();
  MARKERS_LAYER.clearLayers();

  const withGeo = records.filter(r => r.lat && r.lon);
  withGeo.forEach(r => {
    const marker = L.circleMarker([r.lat, r.lon], {
      pane: "cgesMarkersPane",
      radius: 6,
      color: "#fff",
      weight: 1,
      fillColor: markerColor(r),
      fillOpacity: 0.9,
    });
    marker.bindPopup(popupHtml(r));
    marker.addTo(MARKERS_LAYER);
  });

  const totalStat = document.getElementById("map-total-stat");
  if (totalStat) {
    totalStat.textContent = `${withGeo.length} de ${records.length} eventos georreferenciados en el mapa`;
  }

  buildHeatLayer(withGeo);
  applyMapView();

  if (withGeo.length) {
    const bounds = L.latLngBounds(withGeo.map(r => [r.lat, r.lon]));
    LEAFLET_MAP.fitBounds(bounds.pad(0.12));
  }
}

// Exporta el mapa a una imagen (dataURL PNG), para usarse tanto en el botón
// de descarga por sección como en el reporte PPTX. Usa leaflet-image en vez
// de html2canvas: html2canvas maneja mal las transformaciones CSS que usa
// Leaflet para el paneo de tiles y suele producir capturas en blanco o rotas
// en mapas Leaflet. Si aun así falla (p. ej. por una restricción real de
// CORS del servidor de tiles), resuelve null para que quien la llame pueda
// mostrar un aviso en vez de romper la descarga/reporte.
function captureMapImage() {
  return new Promise((resolve) => {
    if (typeof leafletImage === "undefined" || !LEAFLET_MAP) { resolve(null); return; }
    try {
      leafletImage(LEAFLET_MAP, (err, canvas) => {
        if (err || !canvas) { console.warn("leaflet-image no pudo exportar el mapa:", err); resolve(null); return; }
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          console.warn("Canvas del mapa contaminado (restricción CORS de los tiles):", e);
          resolve(null);
        }
      });
    } catch (e) {
      console.warn("Error inesperado exportando el mapa:", e);
      resolve(null);
    }
  });
}

window.CGES = window.CGES || {};
Object.assign(window.CGES, { initMap, renderMapMarkers, captureMapImage });
