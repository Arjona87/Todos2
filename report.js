/* =========================================================================
   report.js — Generación de reporte PPTX (formato oficial CGES)
   -------------------------------------------------------------------------
   Se ejecuta enteramente en el navegador (pptxgenjs + html2canvas), sin
   backend. Reutiliza los assets reales (fondo de portada, marca de agua,
   fondo de slides de contenido) extraídos del PPTX de referencia oficial
   compartido por el usuario, para que el resultado sea fiel a ese formato.

   El reporte replica el mismo tipo de capturas (sección completa: banner +
   gráfica/tabla + insight) que el sistema de descargas por sección
   (downloads.js), en el mismo orden en que se organizó manualmente el PPTX
   de referencia con esas capturas.
   ========================================================================= */

const PPTX_LINK = "https://arjona87.github.io/Vehiculos2/";

const PPTX_COLORS = {
  title: "1F3A70",
  grayTitle: "465059",
  hlink: "0097A7",
  pageNum: "595959",
  body: "222222",
};

const PPTX_ASSET_FILES = {
  bgCover: "pptx_bg_cover.png",
  bgContent: "pptx_bg_content.png",
  watermark: "pptx_watermark.png",
};

// Si el HTML fue empaquetado como artifact autocontenido, estos globals
// vienen embebidos en base64 (ver script de empaquetado); si no existen,
// se hace fetch() de los archivos del propio proyecto.
async function loadPptxAssets() {
  const inline = window.__CGES_PPTX_ASSETS_INLINE__;
  if (inline) return inline;

  async function toDataUrl(path) {
    const res = await fetch(path);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const [bgCover, bgContent, watermark] = await Promise.all([
    toDataUrl(PPTX_ASSET_FILES.bgCover),
    toDataUrl(PPTX_ASSET_FILES.bgContent),
    toDataUrl(PPTX_ASSET_FILES.watermark),
  ]);
  return { bgCover, bgContent, watermark };
}

/* -------------------------------------------------------------------------
   Texto de periodo / fecha de generación (dinámicos según filtros activos)
   ------------------------------------------------------------------------- */
const MESES_LARGO = ["enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre"];

function formatFechaGeneracion(d) {
  const mes = MESES_LARGO[d.getMonth()];
  const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1);
  return `${d.getDate()} de ${mesCap} del ${d.getFullYear()}`;
}

function buildPeriodoTexto() {
  const f = STATE.filters;
  let periodLabel;
  if (f.mes !== "all") {
    const anio = f.anio !== "all" ? f.anio : 2026;
    periodLabel = `${window.CGES.toTitle(f.mes)} ${anio}`;
  } else if (f.anio !== "all") {
    periodLabel = `Enero – Junio ${f.anio}`;
  } else {
    periodLabel = "Enero – Junio 2026";
  }
  const extras = [];
  if (f.municipio !== "all") extras.push(window.CGES.toTitle(f.municipio));
  if (f.violencia !== "all") extras.push(f.violencia === "con" ? "Con violencia" : "Sin violencia");
  if (f.marca !== "all") extras.push(window.CGES.toTitle(f.marca));
  return extras.length ? `${periodLabel}  ·  Filtrado por: ${extras.join(" · ")}` : periodLabel;
}

/* -------------------------------------------------------------------------
   Captura de imágenes: secciones completas (html2canvas) y mapa (leaflet-image)
   ------------------------------------------------------------------------- */
async function captureElement(domId) {
  const el = document.getElementById(domId);
  if (!el || typeof html2canvas === "undefined") return null;
  try {
    const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("No se pudo capturar el elemento", domId, err);
    return null;
  }
}

function addImageContain(slide, dataUrl, opts) {
  if (!dataUrl) return false;
  slide.addImage({ data: dataUrl, ...opts, sizing: { type: "contain", w: opts.w, h: opts.h } });
  return true;
}

// Título del reporte: refleja el delito filtrado, o "Incidencia Delictiva"
// cuando se ve la mezcla completa — consistente con el renombrado que ya se
// aplicó en el dashboard (index.html) para dejar de asumir "solo vehículos".
function tituloReporte() {
  const d = STATE.filters.delito;
  return d === "all" ? "Incidencia Delictiva" : window.CGES.toTitle(d);
}

// Opción 5 — Resumen Ejecutivo de una página (benchmark: "one-pager" de
// McKinsey/BCG/Bain, brief tipo Bloomberg CityLab): 3-5 bullets en lenguaje
// llano, reutilizando los mismos agregados que ya calcula el dashboard (no
// requiere datos nuevos ni recalcular nada desde cero).
function buildResumenEjecutivoBullets() {
  const agg = STATE.lastAgg;
  if (!agg || !agg.total) return ["No hay datos suficientes bajo el filtro actual para generar un resumen ejecutivo."];

  const bullets = [];

  const cmp = (typeof getComparisonAgg === "function") ? getComparisonAgg() : null;
  if (cmp && cmp.agg.total) {
    const pct = Math.round(((agg.total - cmp.agg.total) / cmp.agg.total) * 100);
    const dirTxt = pct > 0 ? `un incremento del ${Math.abs(pct)}%` : pct < 0 ? `una reducción del ${Math.abs(pct)}%` : "sin variación";
    bullets.push(`Se registraron ${agg.total.toLocaleString("es-MX")} eventos en el período analizado, lo que representa ${dirTxt} ${cmp.label}.`);
  } else {
    bullets.push(`Se registraron ${agg.total.toLocaleString("es-MX")} eventos en el período analizado.`);
  }

  if (agg.topMunicipios && agg.topMunicipios.length) {
    const top3 = agg.topMunicipios.slice(0, 3).map(([m, v]) => `${window.CGES.toTitle(m)} (${v})`).join(", ");
    bullets.push(`Las zonas de mayor incidencia son: ${top3}.`);
  }

  bullets.push(`El ${agg.pctConViolencia}% de los eventos registrados presentó violencia.`);

  if (agg.topDelitos && agg.topDelitos.length > 1) {
    const top = agg.topDelitos[0];
    bullets.push(`El delito de mayor incidencia es ${window.CGES.toTitle(top[0])}, con ${top[1].toLocaleString("es-MX")} eventos (${agg.total ? Math.round(top[1]/agg.total*100) : 0}% del total).`);
  }

  if (typeof window.CGES.computeAnomalias === "function") {
    const anomalias = window.CGES.computeAnomalias(STATE.allRecords, STATE.filters);
    if (anomalias.disponible && anomalias.items.length) {
      const it = anomalias.items[0];
      const dirTxt = it.z > 0 ? "por encima" : "por debajo";
      bullets.push(`Alerta: ${window.CGES.toTitle(it.municipio)} se ubica significativamente ${dirTxt} de su promedio histórico en el período de referencia.`);
    }
  }

  return bullets.slice(0, 5);
}
async function generarReportePPTX() {
  const btn = document.getElementById("btn-generar-reporte");
  const originalLabel = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Generando reporte…"; }

  try {
    const assets = await loadPptxAssets();
    const periodoCompleto = buildPeriodoTexto();
    const fechaGeneracion = formatFechaGeneracion(new Date());

    // Captura todas las imágenes ANTES de tocar el DOM del pptx (async).
    // Mismo tipo de captura (sección completa) que usa downloads.js, y en
    // el mismo orden en que se armó manualmente el PPTX de referencia.
    const [
      imgKPI, imgMensual, imgViolencia, imgModus, imgHeatmap,
      imgMunicipios, imgColoniasTabla, imgMarcasSeccion, imgMapa,
      imgRecuperados, imgDetenidos,
    ] = await Promise.all([
      captureElement("kpis-section"),
      captureElement("monthly-section"),
      captureElement("violence-column"),
      captureElement("modus-column"),
      captureElement("temporal-grid"),
      captureElement("card-top-municipios"),
      captureElement("card-ranking-colonias"),
      captureElement("marcas-section"),
      window.CGES.captureMapImage(),
      captureElement("recuperados-section"),
      captureElement("detenidos-section"),
    ]);

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "CGES_10x5625", width: 10, height: 5.625 });
    pptx.layout = "CGES_10x5625";
    pptx.author = "Alejandro Arjona";
    pptx.title = `${tituloReporte()} — AMG`;

    // ---------- Slide 1: Portada ----------
    const s1 = pptx.addSlide();
    s1.background = { data: assets.bgCover };
    s1.addText("Coordinación General Estratégica de Seguridad", {
      x: 0.7045, y: 1.6122, w: 8.7364, h: 0.6058, align: "center",
      fontFace: "Poppins ExtraBold", fontSize: 24, color: PPTX_COLORS.grayTitle,
    });
    s1.addImage({
      data: assets.watermark, x: 3.6821, y: 2.4397, w: 2.7813, h: 0.2156,
      rotate: 180, transparency: 52,
    });
    s1.addText(
      [
        { text: tituloReporte(), options: { breakLine: true, fontSize: 18 } },
        { text: "*Cifras preliminares", options: { fontSize: 12 } },
      ],
      { x: 1.1447, y: 2.5521, w: 7.5132, h: 0.9424, align: "center", fontFace: "Poppins ExtraBold", color: PPTX_COLORS.title, valign: "middle", margin: 0 }
    );
    s1.addText(
      [
        { text: "Periodo analizado: ", options: {} },
        { text: periodoCompleto, options: { bold: true } },
      ],
      { x: 0.7, w: 8.6, y: 3.75, h: 0.45, align: "center", fontSize: 13, color: PPTX_COLORS.body }
    );
    s1.addText(fechaGeneracion, {
      x: 1.9927, y: 4.2068, w: 6.1601, h: 0.4375, align: "center", fontSize: 14, color: PPTX_COLORS.body,
    });
    s1.addText(PPTX_LINK, {
      x: 0.1343, y: 5.3619, w: 5.0, h: 0.35, fontSize: 10, color: PPTX_COLORS.hlink,
      hyperlink: { url: PPTX_LINK }, margin: 0,
    });
    s1.addText("1", { x: 9.264, y: 5.099, w: 0.6, h: 0.35, align: "right", fontSize: 10, color: PPTX_COLORS.pageNum });

    // ---------- Encabezado/pie común de las slides de contenido ----------
    let slideCounter = 1;
    function addContentHeader(slide) {
      slideCounter++;
      slide.background = { data: assets.bgContent };
      slide.addText(tituloReporte(), {
        x: 0.2237, y: 0.2717, w: 4.6579, h: 0.4039, fontFace: "Poppins ExtraBold", fontSize: 18, color: PPTX_COLORS.title, margin: 0,
      });
      slide.addText(
        [
          { text: "Periodo analizado: ", options: {} },
          { text: periodoCompleto, options: { bold: true } },
        ],
        { x: 0.2237, y: 0.5073, w: 7.2, h: 0.45, fontSize: 11.5, color: PPTX_COLORS.body, margin: 0 }
      );
      slide.addText(PPTX_LINK, {
        x: 0.1343, y: 5.3619, w: 5.0, h: 0.35, fontSize: 10, color: PPTX_COLORS.hlink,
        hyperlink: { url: PPTX_LINK }, margin: 0,
      });
      slide.addText(String(slideCounter), { x: 9.264, y: 5.099, w: 0.6, h: 0.35, align: "right", fontSize: 10, color: PPTX_COLORS.pageNum });
      return slide;
    }

    // ---------- Slide 2: Resumen Ejecutivo (Opción 5 — one-pager estilo McKinsey/BCG) ----------
    const sResumen = pptx.addSlide();
    addContentHeader(sResumen);
    sResumen.addText("Resumen Ejecutivo", {
      x: 0.2237, y: 0.85, w: 8.0, h: 0.45, fontFace: "Poppins ExtraBold", fontSize: 16, color: PPTX_COLORS.title, margin: 0,
    });
    const bulletsResumen = buildResumenEjecutivoBullets();
    sResumen.addText(
      bulletsResumen.map(b => ({ text: b, options: { bullet: { code: "25CF" }, breakLine: true, paraSpaceAfter: 12 } })),
      { x: 0.4, y: 1.45, w: 9.2, h: 3.5, fontSize: 14, color: PPTX_COLORS.body, valign: "top", lineSpacing: 22 }
    );

    // ---------- Slide 3: KPIs + Comparativo mensual ----------
    const s2 = pptx.addSlide();
    addContentHeader(s2);
    addImageContain(s2, imgKPI, { x: 2.0945, y: 0.98, w: 6.1102, h: 1.369 });
    addImageContain(s2, imgMensual, { x: 2.0945, y: 2.35, w: 6.1102, h: 3.0 });

    // ---------- Slide 4: Violencia + Modus operandi + análisis temporal ----------
    const s3 = pptx.addSlide();
    addContentHeader(s3);
    addImageContain(s3, imgViolencia, { x: 2.5498, y: 0.9258, w: 2.4502, h: 2.276 });
    addImageContain(s3, imgModus, { x: 5.0, y: 0.9258, w: 2.2894, h: 2.2981 });
    addImageContain(s3, imgHeatmap, { x: 1.2913, y: 3.2239, w: 7.4173, h: 1.95 });

    // ---------- Slide 5: Top municipios + Ranking de colonias ----------
    const s4 = pptx.addSlide();
    addContentHeader(s4);
    addImageContain(s4, imgMunicipios, { x: 0.2237, y: 0.95, w: 5.5, h: 3.0 });
    addImageContain(s4, imgColoniasTabla, { x: 5.9, y: 0.95, w: 3.85, h: 3.85 });

    // ---------- Slide 6: Marcas y submarcas ----------
    const s5 = pptx.addSlide();
    addContentHeader(s5);
    addImageContain(s5, imgMarcasSeccion, { x: 0.6772, y: 0.9258, w: 8.6457, h: 4.15 });

    // ---------- Slide 7: Mapa dinámico ----------
    const s6 = pptx.addSlide();
    addContentHeader(s6);
    if (!addImageContain(s6, imgMapa, { x: 0.6772, y: 0.9658, w: 8.6457, h: 4.15 })) {
      s6.addText(
        "No fue posible generar la vista del mapa para este reporte (restricción de seguridad del navegador al exportar el mapa base). Consulta el mapa interactivo directamente en el dashboard.",
        { x: 1.0, y: 2.3, w: 8.0, h: 1.0, align: "center", fontSize: 14, color: PPTX_COLORS.body, italic: true }
      );
    }

    // ---------- Slide 8: Vehículos recuperados + Detenidos y aseguramientos ----------
    const s7 = pptx.addSlide();
    addContentHeader(s7);
    addImageContain(s7, imgRecuperados, { x: 0.35, y: 0.95, w: 9.3, h: 1.9 });
    addImageContain(s7, imgDetenidos, { x: 0.35, y: 2.95, w: 9.3, h: 1.9 });

    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,"0")}${String(ts.getDate()).padStart(2,"0")}_${String(ts.getHours()).padStart(2,"0")}${String(ts.getMinutes()).padStart(2,"0")}`;
    await pptx.writeFile({ fileName: `Reporte_Robo_Vehiculos_AMG_${stamp}.pptx` });
  } catch (err) {
    console.error("Error generando el reporte PPTX:", err);
    alert("Ocurrió un error al generar el reporte. Por favor intenta de nuevo.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-generar-reporte");
  if (btn) btn.addEventListener("click", generarReportePPTX);
});
