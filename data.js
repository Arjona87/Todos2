/* =========================================================================
   data.js — Robo de Vehículos AMG (CGES / Gobierno de Jalisco)
   -------------------------------------------------------------------------
   Responsabilidades:
   1) Conectar en vivo con el Google Sheet fuente (vía endpoint gviz/tq).
   2) Mapear columnas reales del Sheet -> variables internas del dashboard.
   3) EXCLUIR de forma dura cualquier campo sensible/personal (gobernanza
      de datos: ver sección 3 del prompt de construcción).
   4) Reproyectar la geometría (wkt_geom, en UTM 13N / EPSG:32613) a
      WGS84 (lat/long) para poder graficarla en Leaflet.
   5) Calcular todos los agregados que consumen charts.js y map.js.

   NOTA IMPORTANTE (ver data-mapping.md):
   Al inspeccionar el Google Sheet en vivo se confirmó que el tab principal
   tiene 100 columnas (A→CV) y **no** incluye columnas LATITUD/LONGITUD en
   grados decimales (a diferencia del Excel de muestra original, que sí las
   tenía). Por lo tanto la única fuente de geolocalización disponible es
   `wkt_geom` (y su duplicado Xgeo/YGeo), en un sistema proyectado que, por
   rango de valores, corresponde a UTM Zona 13N (EPSG:32613). Este módulo
   reproyecta esos valores en el cliente usando proj4js.
   ========================================================================= */

const APP_CONFIG = {
  // ID del Google Sheet fuente — "TEST TODOS LOS DELITOS 2026" (evolución del
  // Sheet exclusivo de Robo de Vehículos). Contiene actualmente datos de
  // prueba; se ampliará una vez validado el dashboard. El fetch en vivo
  // (ver fetchSheetRows()) se ejecuta en cada carga de página, así que
  // cualquier fila nueva que se agregue al Sheet se refleja automáticamente
  // sin tocar código.
  SHEET_ID: "12KZssCQOfKTnloST8tC79W1VQ1BDGoMjBYwlmWpsmtU",
  // Si el Sheet tiene varias pestañas por año, se puede fijar aquí o dejar
  // que loadAvailableSheetNames() las detecte. Por ahora v1 solo usa 2026.
  SHEET_TAB_NAME: null, // null = primera hoja / hoja por defecto
  // Años a mostrar en v1 (se filtra el resto aunque exista en el Sheet).
  V1_ONLY_YEAR: 2026,
  FETCH_TIMEOUT_MS: 15000,
};

// Los 7 delitos que puede traer la columna Delito_EST (orden fijo, usado
// para poblar el selector de Delito sin depender de qué tan poblado esté el
// Sheet en un momento dado — así el selector no "salta" según lleguen datos).
const DELITOS_CATALOGO = [
  "ROBO DE MOTOCICLETA",
  "ROBO CASA HABITACION",
  "ROBO A VEHICULOS PARTICULARES",
  "ROBO A PERSONA",
  "ROBO A NEGOCIO",
  "ROBO A CUENTAHABIENTES",
  "ROBO A CARGA PESADA",
];

// De estos 7, solo estos 3 traen datos de vehículo con sentido (marca,
// submarca, modelo, color, placa, serie). Para el resto, esos campos vienen
// vacíos o no aplican, y el dashboard debe mostrar bloques alternativos.
const DELITOS_VEHICULARES = [
  "ROBO DE MOTOCICLETA",
  "ROBO A VEHICULOS PARTICULARES",
  "ROBO A CARGA PESADA",
];

/* -------------------------------------------------------------------------
   POBLACIÓN POR MUNICIPIO (Censo de Población y Vivienda 2020, INEGI, vía
   ficha "Área Metropolitana de Guadalajara" del IIEG Jalisco). Fuente oficial
   usada para poder comparar municipios de distinto tamaño mediante tasas por
   cada 100,000 habitantes (misma metodología que INEGI/ONU-UNODC/FBI UCR),
   en vez de solo cifras absolutas que siempre favorecen a los municipios más
   grandes. Actualizar aquí si se dispone de una proyección más reciente.
   ------------------------------------------------------------------------- */
function normalizarClaveMunicipio(str) {
  return (str || "")
    .toString()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos y la tilde de la Ñ
    .trim();
}

const POBLACION_MUNICIPIOS_RAW = {
  "ZAPOPAN": 1476491,
  "GUADALAJARA": 1385629,
  "TLAJOMULCO DE ZUÑIGA": 727750,
  "SAN PEDRO TLAQUEPAQUE": 687127,
  "TONALA": 569913,
  "EL SALTO": 232852,
  "IXTLAHUACAN DE LOS MEMBRILLOS": 67969,
  "ZAPOTLANEJO": 64806,
  "JUANACATLAN": 30855,
};
const POBLACION_MUNICIPIOS = {};
Object.entries(POBLACION_MUNICIPIOS_RAW).forEach(([k, v]) => {
  POBLACION_MUNICIPIOS[normalizarClaveMunicipio(k)] = v;
});

function poblacionDeMunicipio(nombreMunicipio) {
  return POBLACION_MUNICIPIOS[normalizarClaveMunicipio(nombreMunicipio)] || null;
}

/* -------------------------------------------------------------------------
   1) MAPEO DE COLUMNAS (confirmado contra el Sheet real — ver data-mapping.md)
   ------------------------------------------------------------------------- */
const COLUMN_MAP = {
  wkt_geom: "wkt_geom",
  nuc: "NUC",                 // uso interno solamente para deduplicar; NUNCA se muestra
  fechaHechos: "FECHA_DE_H",
  horaHechos: "HORA_HECHO",
  fechaDenuncia: "FECHA_DE_D",
  mes: "MES",
  anio: "AÑO",
  numOfendidos: "NUM_OFENDI",
  numVehiculos: "NUM_VEHICU",
  delito: "Delito",
  especialidad: "Especialid",
  modalidad: "Modalidad",
  violencia: "Violencia",
  medioComision: "Medio_de_c",
  modusOperandi: "Modus_oper",
  municipio: "MUNICIPIO",
  municipioGeo: "MunicipioG", // ver data-mapping.md: puede no existir aún en el Sheet conectado
  estado: "ESTADO",
  colonia: "COLONIA",
  violenciaEst: "Violencia_",
  modusEst: "MODUS_EST",
  marca: "Marca",
  submarca: "Submarca",
  modeloAnio: "Modelo",
  color: "Color",
  situacion: "SituaciOn",     // posible estatus (recuperado/detenido) — no siempre presente
  estatusCi: "ESTATUS_CI",
  zonaGeo: "ZonaGeo",         // usado como "sector" (ej. GU07, ZP04, TL01…)
  xgeo: "Xgeo",
  ygeo: "YGeo",
  codigoPostal: "CODIGO_POS",

  // --- Campos nuevos para generalizar a "todos los delitos" ---
  delitoEst: "Delito_EST",     // catálogo de 7 delitos (ver DELITOS_CATALOGO)
  objetosRobados: "OBJETOS_RO", // texto libre: objetos sustraídos
  empresa: "EMPRESA",           // nombre comercial (ej. "OXXO") si aplica
  monto: "MONTO",               // monto sustraído (moneda, como texto "2,000.00")
  bienJuridico: "BIEN_JURID",
  giroComercial: "GIR_COMER",    // exclusivo de Robo a Negocio
  servicio: "SERVICIO",          // exclusivo de Robo a Cuentahabientes
  tipoTransporte: "TIP_TRANSP",  // exclusivo de Robo a Carga Pesada / Cuentahabientes
  rsTransporte: "RS_TRANSPO",
  ruta: "RUTA",
  extorsionTelefonica: "EXTOR_TELE",
  cantExigida: "CANT_EXIG",
  cantPagada: "CANT_PAG",
  cantRecuperada: "CANT_RECU",
  tarjetaClonada: "TARJ_CLO",
  nomTransportista: "nom_trnspr", // exclusivo de Robo a Carga Pesada
  // Medio de transporte del/los agresores (columnas tipo bandera/marcador)
  presVehic: "pres_vehic",
  presMoto: "pres_moto",
  preTierra: "pre_tierra",
  preOtro: "pre_otro",
};

// Campos que EXISTEN en el Sheet pero que jamás deben usarse para mostrar,
// exportar, o incluir en tooltips/popups/tablas, por ser datos sensibles o
// personales (gobernanza de datos — obligatorio, ver sección 3 del prompt).
const SENSITIVE_COLUMNS = [
  "Usu_CREO_E", "Serie", "Placa", "NUC", "NUMnuC", "OBS_EST", "Observac",
  "REV_EST", "CALLE", "NUM_INTE", "NUM_EXT", "ENTRE_1", "ENTRE_2",
  "LUGAR_REFE", "OBJETOS_RO", "EMPRESA", "CantMascul", "CantFemeni",
  "CantDescon", "TotalVicti", "IdGeo", "CalleGeo", "CruceGeo",
];

/* -------------------------------------------------------------------------
   2) REPROYECCIÓN GEOESPACIAL (UTM 13N / EPSG:32613 -> WGS84)
   ------------------------------------------------------------------------- */
// Definición usada por proj4js. Ajustar aquí si al validar contra puntos de
// control reales se confirma un EPSG distinto (ver nota en data-mapping.md).
if (typeof proj4 !== "undefined") {
  proj4.defs("EPSG:32613", "+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs");
}

function parseWktPoint(wkt) {
  if (!wkt || typeof wkt !== "string") return null;
  const m = wkt.match(/Point\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y };
}

function reprojectToWGS84(x, y) {
  // Validación de rango: descarta geometrías nulas / (0,0) / fuera de AMG.
  if (!x || !y) return null;
  if (x < 400000 || x > 900000) return null;   // fuera de rango plausible UTM13N para Jalisco
  if (y < 2000000 || y > 2500000) return null; // fuera de rango plausible para AMG
  try {
    if (typeof proj4 !== "undefined") {
      const [lon, lat] = proj4("EPSG:32613", "EPSG:4326", [x, y]);
      // Segunda validación: el resultado debe caer cerca del AMG.
      if (lat < 20.2 || lat > 21.2 || lon < -103.9 || lon > -103.0) return null;
      return { lat, lon };
    }
  } catch (e) {
    console.warn("Error reproyectando punto:", e);
  }
  return null;
}

/* -------------------------------------------------------------------------
   3) FETCH DEL GOOGLE SHEET (formato gviz/tq -> JSON)
   ------------------------------------------------------------------------- */
function buildGvizUrl() {
  const base = `https://docs.google.com/spreadsheets/d/${APP_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json`;
  return APP_CONFIG.SHEET_TAB_NAME
    ? `${base}&sheet=${encodeURIComponent(APP_CONFIG.SHEET_TAB_NAME)}`
    : base;
}

function parseGvizResponse(text) {
  // La respuesta viene envuelta como: google.visualization.Query.setResponse({...});
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  const jsonStr = text.substring(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonStr);
  const cols = parsed.table.cols.map(c => (c.label || c.id || "").trim());
  const rows = parsed.table.rows.map(r => {
    const obj = {};
    r.c.forEach((cell, i) => {
      const key = cols[i];
      if (!key) return;
      obj[key] = cell ? (cell.f !== undefined && cell.f !== null ? cell.f : cell.v) : null;
    });
    return obj;
  });
  return rows;
}

async function fetchSheetRows() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(buildGvizUrl(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseGvizResponse(text);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/* -------------------------------------------------------------------------
   4) NORMALIZACIÓN DE REGISTROS (solo campos permitidos + geolocalización)
   ------------------------------------------------------------------------- */
const DIAS_ORDEN = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"];
const DIAS_JS = ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"]; // getDay(): 0=domingo

function parseFechaDDMMYYYY(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
}

function franjaHoraria(horaStr) {
  if (!horaStr) return null;
  let h = null;
  if (typeof horaStr === "string") {
    const m = horaStr.match(/^(\d{1,2}):(\d{2})/);
    if (m) h = parseInt(m[1]);
  } else if (typeof horaStr === "number") {
    h = Math.floor(horaStr * 24) % 24; // si viene como fracción de día (formato hora de Sheets)
  }
  if (h === null || isNaN(h)) return null;
  if (h >= 0 && h < 6) return "MADRUGADA";
  if (h >= 6 && h < 12) return "MAÑANA";
  if (h >= 12 && h < 19) return "TARDE";
  return "NOCHE";
}

// Convierte un monto tipo "2,000.00" o "111,476.00" (texto, como lo entrega
// el Sheet) a número. Devuelve null si no hay monto (no "0", para no
// confundir "sin dato" con "se llevaron $0").
function parseMonto(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  const cleaned = raw.toString().replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Interpreta las columnas "presencia de medio de transporte del agresor"
// (pres_vehic / pres_moto / pre_tierra / pre_otro). En el Sheet aparecen
// como texto libre (ej. "MOTOCICLETA") solo en la columna correspondiente
// cuando aplica, y vacías en las demás — por eso basta con checar si cada
// celda tiene contenido, sin depender de un valor exacto tipo booleano.
function tieneValor(raw) {
  return raw !== null && raw !== undefined && raw.toString().trim() !== "";
}

function normalizeRecord(raw) {
  const g = key => raw[COLUMN_MAP[key]] ?? null;

  const wkt = g("wkt_geom");
  const point = parseWktPoint(wkt);
  const geo = point ? reprojectToWGS84(point.x, point.y) : null;

  const fecha = parseFechaDDMMYYYY(g("fechaHechos"));
  const anio = parseInt(g("anio")) || (fecha ? fecha.getFullYear() : null);
  const mes = (g("mes") || "").toString().trim().toUpperCase();

  const violenciaRaw = (g("violencia") || g("violenciaEst") || "").toString().trim().toUpperCase();
  const conViolencia = violenciaRaw === "SI" || violenciaRaw.includes("CON VIOLENCIA");

  const modus = (g("modusEst") || g("modusOperandi") || "SIN ESPECIFICAR").toString().trim().toUpperCase();

  const diaSemana = fecha ? DIAS_JS[fecha.getDay()] : null;
  const franja = franjaHoraria(g("horaHechos"));

  // Delito_EST es la columna de generalización — si aún viene vacía en algún
  // registro (Sheet en transición), se cae a "Delito"/"Especialid" como
  // mejor esfuerzo, para no perder el registro de los filtros.
  const delitoEst = (g("delitoEst") || g("especialidad") || g("delito") || "SIN CLASIFICAR").toString().trim().toUpperCase();
  const esVehicular = DELITOS_VEHICULARES.includes(delitoEst);

  const monto = parseMonto(g("monto"));

  const medioTransporteAgresor =
    tieneValor(g("presMoto")) ? "MOTOCICLETA" :
    tieneValor(g("presVehic")) ? "VEHICULO" :
    tieneValor(g("preTierra")) ? "A PIE / TIERRA" :
    tieneValor(g("preOtro")) ? "OTRO" : null;

  return {
    anio,
    mes,
    fecha,
    diaSemana,
    franja,
    municipio: (g("municipio") || "SIN DATO").toString().trim().toUpperCase(),
    // MunicipioG (geocodificado) con fallback a MUNICIPIO si el Sheet aún no trae esa columna.
    municipioGeo: (g("municipioGeo") || g("municipio") || "SIN DATO").toString().trim().toUpperCase(),
    colonia: (g("colonia") || "SIN DATO").toString().trim().toUpperCase(),
    sector: (g("zonaGeo") || "SIN DATO").toString().trim().toUpperCase(),
    conViolencia,
    modus,
    delitoEst,
    esVehicular,
    // Campos vehiculares: solo tienen sentido si esVehicular es true, pero se
    // leen siempre tal cual venga el dato (vendrán vacíos/"SIN DATO" en los
    // demás delitos, y la UI decide si los muestra o no).
    marca: (g("marca") || "SIN DATO").toString().trim().toUpperCase(),
    submarca: (g("submarca") || "SIN DATO").toString().trim().toUpperCase(),
    situacion: (g("situacion") || "").toString().trim().toUpperCase(),
    // Campos universales / no vehiculares
    monto,
    objetosRobados: (g("objetosRobados") || "").toString().trim(),
    giroComercial: (g("giroComercial") || "").toString().trim().toUpperCase(),
    empresa: (g("empresa") || "").toString().trim(),
    medioTransporteAgresor,
    // Campos exclusivos de Robo a Cuentahabientes
    servicio: (g("servicio") || "").toString().trim().toUpperCase(),
    extorsionTelefonica: tieneValor(g("extorsionTelefonica")),
    tarjetaClonada: tieneValor(g("tarjetaClonada")),
    cantExigida: parseMonto(g("cantExigida")),
    cantPagada: parseMonto(g("cantPagada")),
    cantRecuperada: parseMonto(g("cantRecuperada")),
    // Campos exclusivos de Robo a Carga Pesada
    nomTransportista: (g("nomTransportista") || "").toString().trim(),
    ruta: (g("ruta") || "").toString().trim(),
    lat: geo ? geo.lat : null,
    lon: geo ? geo.lon : null,
  };
}

/* -------------------------------------------------------------------------
   5) CARGA PRINCIPAL (con fallback local si falla el fetch en vivo)
   ------------------------------------------------------------------------- */
async function loadDataset() {
  try {
    const rows = await fetchSheetRows();
    const normalized = rows.map(normalizeRecord).filter(r => r.anio);
    if (!normalized.length) throw new Error("El Sheet respondió vacío");
    return { records: normalized, source: "live", fetchedAt: new Date() };
  } catch (err) {
    console.warn("No se pudo leer el Google Sheet en vivo, usando datos de respaldo:", err);
    const fallback = await fetch("fallback.json").then(r => r.json()).catch(() => []);
    // Nota: fallback.json es un respaldo heredado del proyecto de "Robo de
    // Vehículos" y aún no trae Delito_EST ni los campos nuevos (monto,
    // objetos robados, etc.). Se le asigna un delito por defecto para que no
    // desaparezca del todo al usar el nuevo selector de Delito, pero lo
    // correcto es regenerar este archivo desde el Sheet nuevo cuando se
    // confirme el diseño final (pendiente, ver nota en el chat).
    const normalized = fallback.map(r => ({
      ...r,
      fecha: r.fecha ? new Date(r.fecha) : null,
      delitoEst: r.delitoEst || "ROBO A VEHICULOS PARTICULARES",
      esVehicular: r.esVehicular !== undefined ? r.esVehicular : true,
    }));
    return { records: normalized, source: "fallback", fetchedAt: null, error: err };
  }
}

/* -------------------------------------------------------------------------
   6) AGREGADOS (alimentan KPIs, gráficas y mapa)
   ------------------------------------------------------------------------- */
const MESES_ORDEN = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
  "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];

function computeAggregates(records) {
  const total = records.length;
  const conViolencia = records.filter(r => r.conViolencia).length;
  const sinViolencia = total - conViolencia;

  // Mensual (multi-año, listo para escalar)
  const monthlyByYear = {};
  records.forEach(r => {
    if (!r.anio || !r.mes) return;
    monthlyByYear[r.anio] = monthlyByYear[r.anio] || {};
    monthlyByYear[r.anio][r.mes] = (monthlyByYear[r.anio][r.mes] || 0) + 1;
  });

  // Municipios (columna MunicipioG, geocodificada; con fallback a MUNICIPIO)
  const municipios = {};
  records.forEach(r => { municipios[r.municipioGeo] = (municipios[r.municipioGeo] || 0) + 1; });
  const topMunicipios = Object.entries(municipios).sort((a,b)=>b[1]-a[1]).slice(0,10);

  // --- Top municipios normalizado por tasa (delitos por cada 100k hab.) ---
  // Evita que Guadalajara/Zapopan "ganen" el ranking solo por ser más grandes.
  const topMunicipiosPorTasa = Object.entries(municipios)
    .map(([nombre, count]) => {
      const poblacion = poblacionDeMunicipio(nombre);
      return {
        nombre, count, poblacion,
        tasa: poblacion ? Math.round((count / poblacion) * 100000 * 10) / 10 : null,
      };
    })
    .filter(d => d.tasa !== null)
    .sort((a, b) => b.tasa - a.tasa);

  // Mensual por municipio (para la gráfica de barras apiladas)
  const monthlyByMunicipio = {};
  records.forEach(r => {
    if (!r.mes) return;
    monthlyByMunicipio[r.mes] = monthlyByMunicipio[r.mes] || {};
    const mun = r.municipioGeo || "SIN DATO";
    monthlyByMunicipio[r.mes][mun] = (monthlyByMunicipio[r.mes][mun] || 0) + 1;
  });

  // Colonias — se agregan junto con su municipio para desambiguar colonias
  // homónimas (ej. "Centro") que existen en más de un municipio del AMG.
  const coloniasDetalle = {};
  records.forEach(r => {
    const key = `${r.municipio}|||${r.colonia}`;
    if (!coloniasDetalle[key]) coloniasDetalle[key] = { municipio: r.municipio, colonia: r.colonia, count: 0 };
    coloniasDetalle[key].count++;
  });
  const topColoniasDetalle = Object.values(coloniasDetalle).sort((a,b)=>b.count-a.count).slice(0,15);
  // Formato [nombre, valor] para reutilizar la gráfica de barras genérica.
  const topColonias = topColoniasDetalle.map(d => [`${d.colonia} — ${d.municipio}`, d.count]);

  // Sectores
  const sectores = {};
  records.forEach(r => { sectores[r.sector] = (sectores[r.sector] || 0) + 1; });
  const topSectores = Object.entries(sectores).sort((a,b)=>b[1]-a[1]).slice(0,15);

  // Marcas / submarcas
  const marcas = {};
  const submarcas = {};
  records.forEach(r => {
    marcas[r.marca] = (marcas[r.marca] || 0) + 1;
    const key = `${r.marca} ${r.submarca}`;
    submarcas[key] = (submarcas[key] || 0) + 1;
  });
  const topMarcas = Object.entries(marcas).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const topSubmarcas = Object.entries(submarcas).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Modus operandi
  const modus = {};
  records.forEach(r => { modus[r.modus] = (modus[r.modus] || 0) + 1; });
  const topModus = Object.entries(modus).sort((a,b)=>b[1]-a[1]);

  // Heatmap día x franja (separado con/sin violencia)
  const franjas = ["MADRUGADA","MAÑANA","TARDE","NOCHE"];
  function buildHeatmap(filterFn){
    const h = {};
    franjas.forEach(f => { h[f] = {}; DIAS_ORDEN.forEach(d => h[f][d] = 0); });
    records.filter(filterFn).forEach(r => {
      if (!r.franja || !r.diaSemana) return;
      if (h[r.franja] && h[r.franja][r.diaSemana] !== undefined) h[r.franja][r.diaSemana]++;
    });
    return h;
  }
  const heatmapViolencia = buildHeatmap(r => r.conViolencia);
  const heatmapSinViolencia = buildHeatmap(r => !r.conViolencia);

  // Recuperados / detenidos: no siempre disponibles en el dataset crudo.
  const situacionesDisponibles = records.some(r => r.situacion && r.situacion.length > 0);

  // Desglose por tipo de delito (relevante sobre todo en la vista "Todos los
  // delitos", donde es la numeralia más básica para entender la mezcla).
  const porDelito = {};
  records.forEach(r => { porDelito[r.delitoEst] = (porDelito[r.delitoEst] || 0) + 1; });
  const topDelitos = Object.entries(porDelito).sort((a,b) => b[1]-a[1]);

  // --- Monto sustraído (universal, aplica a cualquier delito con MONTO) ---
  const conMonto = records.filter(r => r.monto !== null && r.monto > 0);
  const montoTotal = conMonto.reduce((acc, r) => acc + r.monto, 0);
  const montoStats = {
    registrosConMonto: conMonto.length,
    montoTotal,
    montoPromedio: conMonto.length ? Math.round(montoTotal / conMonto.length) : 0,
    disponible: conMonto.length > 0,
  };

  // --- Objetos robados (universal): tokeniza el texto libre de OBJETOS_RO ---
  const objetosCount = {};
  records.forEach(r => {
    if (!r.objetosRobados) return;
    r.objetosRobados
      .split(/[,;/]| Y |\n/i)
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 2)
      .forEach(t => { objetosCount[t] = (objetosCount[t] || 0) + 1; });
  });
  const topObjetosRobados = Object.entries(objetosCount).sort((a,b) => b[1]-a[1]).slice(0, 10);

  // --- Medio de transporte del agresor (universal) ---
  const medioTransporteCount = {};
  let medioTransporteDisponible = 0;
  records.forEach(r => {
    if (!r.medioTransporteAgresor) return;
    medioTransporteDisponible++;
    medioTransporteCount[r.medioTransporteAgresor] = (medioTransporteCount[r.medioTransporteAgresor] || 0) + 1;
  });
  const topMedioTransporte = Object.entries(medioTransporteCount).sort((a,b) => b[1]-a[1]);

  // --- Giro comercial (exclusivo de Robo a Negocio) ---
  const girosCount = {};
  records.forEach(r => { if (r.giroComercial) girosCount[r.giroComercial] = (girosCount[r.giroComercial] || 0) + 1; });
  const topGirosComerciales = Object.entries(girosCount).sort((a,b) => b[1]-a[1]).slice(0, 10);

  // --- Módulo Robo a Cuentahabientes ---
  const cuentahabientesRecords = records.filter(r => r.delitoEst === "ROBO A CUENTAHABIENTES");
  const conExigida = cuentahabientesRecords.filter(r => r.cantExigida !== null);
  const conPagada = cuentahabientesRecords.filter(r => r.cantPagada !== null);
  const conRecuperada = cuentahabientesRecords.filter(r => r.cantRecuperada !== null);
  const cuentahabientesStats = {
    total: cuentahabientesRecords.length,
    totalExigido: conExigida.reduce((a,r) => a + r.cantExigida, 0),
    totalPagado: conPagada.reduce((a,r) => a + r.cantPagada, 0),
    totalRecuperado: conRecuperada.reduce((a,r) => a + r.cantRecuperada, 0),
    pctTarjetaClonada: cuentahabientesRecords.length ? Math.round(cuentahabientesRecords.filter(r => r.tarjetaClonada).length / cuentahabientesRecords.length * 100) : 0,
    pctExtorsionTelefonica: cuentahabientesRecords.length ? Math.round(cuentahabientesRecords.filter(r => r.extorsionTelefonica).length / cuentahabientesRecords.length * 100) : 0,
    disponible: conExigida.length > 0 || conPagada.length > 0 || conRecuperada.length > 0,
  };

  return {
    total, conViolencia, sinViolencia,
    pctConViolencia: total ? Math.round((conViolencia/total)*100) : 0,
    pctSinViolencia: total ? Math.round((sinViolencia/total)*100) : 0,
    monthlyByYear, monthlyByMunicipio,
    topMunicipios, topMunicipiosPorTasa, topColonias, topColoniasDetalle, topSectores, topMarcas, topSubmarcas, topModus,
    heatmapViolencia, heatmapSinViolencia,
    situacionesDisponibles,
    topDelitos,
    montoStats, topObjetosRobados,
    topMedioTransporte, medioTransporteDisponible,
    topGirosComerciales,
    cuentahabientesStats,
    years: Object.keys(monthlyByYear).map(Number).sort(),
  };
}

/* -------------------------------------------------------------------------
   7) ALERTAS DE ZONAS ATÍPICAS (gestión por excepción)
   -------------------------------------------------------------------------
   Metodología de control estadístico de procesos (la misma familia que Six
   Sigma o los dashboards de monitoreo tipo SRE/SOC): en vez de comparar un
   municipio contra otros, se compara contra SU PROPIO historial mensual — se
   marca como atípico cuando el valor del período de referencia se desvía más
   de 1.5 desviaciones estándar de su propia media histórica. Es una forma
   más justa de detectar "algo raro está pasando aquí" que un ranking simple.

   Respeta los filtros de Delito y Violencia (tiene sentido comparar "Robo a
   Negocio con violencia" contra su propio historial), pero IGNORA los
   filtros de Año/Mes para construir el historial (necesita todos los
   períodos disponibles) y usa como "período de referencia" el mes+año que el
   usuario tenga filtrado — o, si no filtró un mes específico, el mes más
   reciente disponible en los datos.
   ------------------------------------------------------------------------- */
function diasEnMes(anio, mesNombre) {
  const idx = MESES_ORDEN.indexOf(mesNombre);
  if (idx === -1) return 31;
  return new Date(anio, idx + 1, 0).getDate();
}

// Determina el "período de referencia" (mes+año) y el mes inmediato anterior,
// con el mismo criterio en todas las comparativas mes-a-mes del dashboard:
// el mes+año que el usuario tenga filtrado, o el más reciente disponible en
// los datos (respetando filtros base como delito/violencia) si no filtró uno.
function determinarPeriodoReferencia(allRecords, filters, pasaFiltroBase) {
  let refAnio = filters.anio, refMes = filters.mes;
  if (refMes === "all" || refAnio === "all") {
    let latest = null;
    allRecords.forEach(r => {
      if (!pasaFiltroBase(r) || !r.anio || !r.mes) return;
      const idx = MESES_ORDEN.indexOf(r.mes);
      if (!latest || r.anio > latest.anio || (r.anio === latest.anio && idx > latest.idx)) {
        latest = { anio: r.anio, mes: r.mes, idx };
      }
    });
    if (!latest) return null;
    refAnio = latest.anio; refMes = latest.mes;
  } else {
    refAnio = parseInt(refAnio, 10);
  }
  const refIdx = MESES_ORDEN.indexOf(refMes);
  let prevMes, prevAnio;
  if (refIdx > 0) { prevMes = MESES_ORDEN[refIdx - 1]; prevAnio = refAnio; }
  else { prevMes = MESES_ORDEN[11]; prevAnio = refAnio - 1; }
  return { refAnio, refMes, prevAnio, prevMes };
}

function computeAnomalias(allRecords, filters) {
  const pasaFiltroBase = r => {
    if (filters.delito !== "all" && r.delitoEst !== filters.delito) return false;
    if (filters.violencia !== "all") {
      const wantViolence = filters.violencia === "con";
      if (r.conViolencia !== wantViolence) return false;
    }
    return true;
  };

  // Serie histórica mensual por municipio.
  const seriePorMunicipio = {};
  allRecords.forEach(r => {
    if (!pasaFiltroBase(r) || !r.anio || !r.mes) return;
    const key = r.municipioGeo || "SIN DATO";
    const periodo = `${r.anio}-${r.mes}`;
    seriePorMunicipio[key] = seriePorMunicipio[key] || {};
    seriePorMunicipio[key][periodo] = (seriePorMunicipio[key][periodo] || 0) + 1;
  });

  const periodo = determinarPeriodoReferencia(allRecords, filters, pasaFiltroBase);
  if (!periodo) return { disponible: false, items: [], periodoRef: null };
  const { refAnio, refMes } = periodo;

  const refKey = `${refAnio}-${refMes}`;
  const items = [];
  Object.entries(seriePorMunicipio).forEach(([municipio, serie]) => {
    const periodosPrevios = Object.keys(serie).filter(k => k !== refKey);
    if (periodosPrevios.length < 3) return; // no hay suficiente historial todavía
    const valores = periodosPrevios.map(k => serie[k]);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    const varianza = valores.reduce((a, b) => a + Math.pow(b - media, 2), 0) / valores.length;
    const std = Math.sqrt(varianza);
    if (std === 0) return;
    const actual = serie[refKey] || 0;
    const z = (actual - media) / std;
    if (Math.abs(z) >= 1.5) {
      items.push({ municipio, actual, media: Math.round(media * 10) / 10, std: Math.round(std * 10) / 10, z: Math.round(z * 100) / 100 });
    }
  });
  items.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  return { disponible: items.length > 0, items: items.slice(0, 5), periodoRef: { anio: refAnio, mes: refMes } };
}

/* -------------------------------------------------------------------------
   Comparativo mes a mes por municipio (los 9 del AMG), ordenado por orden de
   impacto — complementa computeAnomalias(): mientras esa función compara
   cada municipio contra SU PROPIO historial (detección estadística), esta
   función da la lectura más literal y directa que pidió el usuario: "qué
   pasó este mes vs. el mes pasado, en cada uno de los 9 municipios".

   "Orden de impacto" = magnitud absoluta del cambio en número de eventos
   (no en %), porque un incremento de 40 eventos importa operativamente más
   que uno de 200% que parte de una base de 2 eventos.
   ------------------------------------------------------------------------- */
const MUNICIPIOS_AMG_CATALOGO = Object.keys(POBLACION_MUNICIPIOS_RAW);

function computeComparativoMunicipiosMoM(allRecords, filters) {
  const pasaFiltroBase = r => {
    if (filters.delito !== "all" && r.delitoEst !== filters.delito) return false;
    if (filters.violencia !== "all") {
      const wantViolence = filters.violencia === "con";
      if (r.conViolencia !== wantViolence) return false;
    }
    return true;
  };

  const periodo = determinarPeriodoReferencia(allRecords, filters, pasaFiltroBase);
  if (!periodo) return { disponible: false, items: [], periodoRef: null, periodoAnterior: null };
  const { refAnio, refMes, prevAnio, prevMes } = periodo;

  const items = MUNICIPIOS_AMG_CATALOGO.map(nombreCanonico => {
    const claveCanon = normalizarClaveMunicipio(nombreCanonico);
    let actual = 0, anterior = 0;
    allRecords.forEach(r => {
      if (!pasaFiltroBase(r) || !r.anio || !r.mes || !r.municipioGeo) return;
      if (normalizarClaveMunicipio(r.municipioGeo) !== claveCanon) return;
      if (r.anio === refAnio && r.mes === refMes) actual++;
      else if (r.anio === prevAnio && r.mes === prevMes) anterior++;
    });
    const delta = actual - anterior;
    const deltaPct = anterior > 0 ? Math.round((delta / anterior) * 100) : (actual > 0 ? null : 0);
    return { municipio: nombreCanonico, actual, anterior, delta, deltaPct };
  });

  // Orden de impacto: magnitud absoluta del cambio, no porcentaje.
  items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    disponible: true,
    items,
    periodoRef: { anio: refAnio, mes: refMes },
    periodoAnterior: { anio: prevAnio, mes: prevMes },
  };
}

/* -------------------------------------------------------------------------
   Comparativo mes a mes por COLONIA y por SECTOR (usado en las tablas de
   ranking de la sección "Colonias y sectores"), con metodología adaptativa:

   - Si el mes de referencia ya está completo (el día más tardío capturado en
     los datos coincide con el total de días de ese mes), compara mes
     completo contra mes completo.
   - Si el mes de referencia sigue en curso (aún no se han capturado todos
     sus días), compara "Month-to-Date" (MTD): los mismos primeros N días del
     mes de referencia contra los primeros N días del mes anterior — evita
     que un mes a medias parezca (falsamente) una mejora frente a un mes ya
     completo. N se limita también a los días que realmente tenga el mes
     anterior (ej. Febrero vs Marzo).

   Esta detección es automática (no requiere configurarse a mano) y se
   recalcula cada vez que el Sheet tenga más días capturados.
   ------------------------------------------------------------------------- */
function computeComparativoDetallado(allRecords, filters) {
  const pasaFiltroBase = r => {
    if (filters.delito !== "all" && r.delitoEst !== filters.delito) return false;
    if (filters.violencia !== "all") {
      const wantViolence = filters.violencia === "con";
      if (r.conViolencia !== wantViolence) return false;
    }
    return true;
  };

  const periodo = determinarPeriodoReferencia(allRecords, filters, pasaFiltroBase);
  if (!periodo) return { disponible: false, porColonia: {}, porSector: {} };
  const { refAnio, refMes, prevAnio, prevMes } = periodo;

  // Detección de mes completo vs. en curso, a partir del día más tardío
  // realmente capturado en el mes de referencia.
  const totalDiasRef = diasEnMes(refAnio, refMes);
  let corteDia = 0;
  allRecords.forEach(r => {
    if (!pasaFiltroBase(r) || r.anio !== refAnio || r.mes !== refMes || !r.fecha) return;
    const dia = r.fecha.getDate();
    if (dia > corteDia) corteDia = dia;
  });
  const esCompleto = corteDia >= totalDiasRef;
  const corteEfectivo = esCompleto ? null : Math.min(corteDia, diasEnMes(prevAnio, prevMes));

  function dentroDelCorte(r) {
    if (esCompleto) return true;
    if (!r.fecha) return false;
    return r.fecha.getDate() <= corteEfectivo;
  }

  const porColonia = {};
  const porSector = {};
  allRecords.forEach(r => {
    if (!pasaFiltroBase(r)) return;
    const esRef = r.anio === refAnio && r.mes === refMes;
    const esPrev = r.anio === prevAnio && r.mes === prevMes;
    if (!esRef && !esPrev) return;
    if (!dentroDelCorte(r)) return;

    const keyColonia = `${r.municipio}|||${r.colonia}`;
    porColonia[keyColonia] = porColonia[keyColonia] || { actual: 0, anterior: 0 };
    if (esRef) porColonia[keyColonia].actual++; else porColonia[keyColonia].anterior++;

    const keySector = r.sector || "SIN DATO";
    porSector[keySector] = porSector[keySector] || { actual: 0, anterior: 0 };
    if (esRef) porSector[keySector].actual++; else porSector[keySector].anterior++;
  });

  function finalizar(obj) {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
      const delta = v.actual - v.anterior;
      const deltaPct = v.anterior > 0 ? Math.round((delta / v.anterior) * 100) : (v.actual > 0 ? null : 0);
      out[k] = { actual: v.actual, anterior: v.anterior, delta, deltaPct };
    });
    return out;
  }

  return {
    disponible: true,
    porColonia: finalizar(porColonia),
    porSector: finalizar(porSector),
    periodoRef: { anio: refAnio, mes: refMes },
    periodoAnterior: { anio: prevAnio, mes: prevMes },
    esCompleto,
    corteDia: esCompleto ? totalDiasRef : corteDia,
    totalDiasRef,
  };
}
window.CGES.APP_CONFIG = APP_CONFIG;
window.CGES.SENSITIVE_COLUMNS = SENSITIVE_COLUMNS;
window.CGES.loadDataset = loadDataset;
window.CGES.computeAggregates = computeAggregates;
window.CGES.computeAnomalias = computeAnomalias;
window.CGES.computeComparativoMunicipiosMoM = computeComparativoMunicipiosMoM;
window.CGES.computeComparativoDetallado = computeComparativoDetallado;
window.CGES.poblacionDeMunicipio = poblacionDeMunicipio;
window.CGES.MESES_ORDEN = MESES_ORDEN;
window.CGES.DIAS_ORDEN = DIAS_ORDEN;
window.CGES.DELITOS_CATALOGO = DELITOS_CATALOGO;
window.CGES.DELITOS_VEHICULARES = DELITOS_VEHICULARES;
