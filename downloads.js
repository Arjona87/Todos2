/* =========================================================================
   downloads.js — Menú de descargas por sección
   -------------------------------------------------------------------------
   Adaptado del sistema documentado en SISTEMA_DESCARGAS_COMPLETO.md (sitio
   ETA), con dos diferencias deliberadas:
   1) Este proyecto usa ECharts (no Chart.js) para las gráficas, así que la
      exportación "Gráfica en JPEG" usa el exportador nativo de ECharts
      (chart.getDataURL) en vez de leer un <canvas> de Chart.js.
   2) El ícono y el menú usan la paleta institucional CGES (azul/naranja)
      en vez del ícono gris plano del sitio de referencia.
   ========================================================================= */

const DL_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 3v10m0 0l-4-4m4 4l4-4" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* -------------------------------------------------------------------------
   Utilidades comunes
   ------------------------------------------------------------------------- */
function dlFechaSufijo() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function dlText(elId) {
  const el = document.getElementById(elId);
  return el ? el.textContent.trim() : "";
}

function dlHideMenusAndButtons() {
  document.querySelectorAll(".dl-container").forEach(el => { el.dataset.prevDisplay = el.style.display; el.style.display = "none"; });
}
function dlRestoreButtons() {
  document.querySelectorAll(".dl-container").forEach(el => { el.style.display = el.dataset.prevDisplay || ""; });
}

function dlDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function dlCapturaCustom(captureFn, filenameBase, errorMsg) {
  try {
    const pngDataUrl = await captureFn();
    if (!pngDataUrl) {
      alert(errorMsg || "No fue posible generar esta captura (restricción de seguridad del navegador).");
      return;
    }
    const blob = await dlPngDataUrlToJpegBlob(pngDataUrl);
    dlDownloadBlob(blob, `${filenameBase}_${dlFechaSufijo()}.jpg`);
  } catch (err) {
    console.error("Error generando la captura:", err);
    alert("Ocurrió un error al generar la captura.");
  }
}

/* -------------------------------------------------------------------------
   1) Captura de pantalla (JPG) — cualquier elemento del DOM
   ------------------------------------------------------------------------- */
async function dlCaptura(elementId, filenameBase) {
  const el = document.getElementById(elementId);
  if (!el) { alert("No se encontró la sección a capturar."); return; }
  dlHideMenusAndButtons();
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true, allowTaint: false });
    canvas.toBlob(blob => {
      if (!blob) { alert("No fue posible generar la captura (posible restricción del navegador)."); return; }
      dlDownloadBlob(blob, `${filenameBase}_${dlFechaSufijo()}.jpg`);
    }, "image/jpeg", 0.95);
  } catch (err) {
    console.warn("No se pudo capturar", elementId, err);
    alert("No fue posible generar la captura de esta sección (posible restricción de seguridad del navegador).");
  } finally {
    dlRestoreButtons();
  }
}

/* -------------------------------------------------------------------------
   2) Datos en XLSX — a partir de hojas ya construidas como arreglo de filas
   ------------------------------------------------------------------------- */
function dlXLSX(sheets, filenameBase) {
  if (typeof XLSX === "undefined") { alert("La librería de exportación a Excel no está disponible."); return; }
  if (!sheets || !sheets.length) { alert("No hay datos disponibles para exportar bajo el filtro actual."); return; }
  try {
    const wb = XLSX.utils.book_new();
    sheets.forEach(sheet => {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
    });
    XLSX.writeFile(wb, `${filenameBase}_${dlFechaSufijo()}.xlsx`);
  } catch (err) {
    console.error("Error exportando XLSX:", err);
    alert("Ocurrió un error al generar el archivo Excel.");
  }
}

/* -------------------------------------------------------------------------
   3) Gráfica en JPEG — exportador nativo de ECharts (no canvas de Chart.js)
   ------------------------------------------------------------------------- */
function dlPngDataUrlToJpegBlob(pngDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("toBlob falló")), "image/jpeg", 0.95);
    };
    img.onerror = reject;
    img.src = pngDataUrl;
  });
}

async function dlChartJPEG(chartId, filenameBase) {
  const chart = CHART_INSTANCES[chartId];
  if (!chart) { alert("No se encontró la gráfica a exportar."); return; }
  try {
    const pngDataUrl = chart.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" });
    const blob = await dlPngDataUrlToJpegBlob(pngDataUrl);
    dlDownloadBlob(blob, `${filenameBase}_${dlFechaSufijo()}.jpg`);
  } catch (err) {
    console.error("Error exportando gráfica:", err);
    alert("Ocurrió un error al generar la imagen de la gráfica.");
  }
}

/* -------------------------------------------------------------------------
   Configuración por sección (todas las funciones se evalúan al momento del
   clic, para reflejar siempre los filtros activos en ese instante)
   ------------------------------------------------------------------------- */
function dlBuildConfigs() {
  return {
    kpis: {
      filenameBase: "KPIs_Robo_Vehiculos",
      captureId: "kpis-section",
      xlsxSheets: () => [{
        name: "KPIs",
        rows: [
          ["Indicador", "Valor"],
          ["Robos totales", dlText("kpi-total")],
          ["Con violencia", dlText("kpi-con-violencia")],
          ["Sin violencia", dlText("kpi-sin-violencia")],
          ["% con violencia", dlText("kpi-pct-violencia")],
        ],
      }],
      charts: [],
    },

    monthly: {
      filenameBase: "Comparativo_Mensual_Municipio",
      captureId: "monthly-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const municipios = [...new Set(Object.values(agg.monthlyByMunicipio).flatMap(o => Object.keys(o)))];
        const rows = [["Mes", ...municipios.map(m => window.CGES.toTitle(m))]];
        window.CGES.MESES_ORDEN.forEach(mes => {
          const row = [window.CGES.toTitle(mes)];
          municipios.forEach(m => row.push((agg.monthlyByMunicipio[mes] && agg.monthlyByMunicipio[mes][m]) || 0));
          rows.push(row);
        });
        return [{ name: "Mensual por municipio", rows }];
      },
      charts: [{ chartId: "chart-monthly", label: "Gráfica en JPEG" }],
    },

    violence: {
      filenameBase: "Con_Sin_Violencia",
      captureId: "violence-column",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        return [{
          name: "Violencia",
          rows: [
            ["Modalidad", "Eventos", "%"],
            ["Con violencia", agg.conViolencia, agg.pctConViolencia + "%"],
            ["Sin violencia", agg.sinViolencia, agg.pctSinViolencia + "%"],
          ],
        }];
      },
      charts: [{ chartId: "chart-violence", label: "Gráfica en JPEG" }],
    },

    modus: {
      filenameBase: "Modus_Operandi",
      captureId: "modus-column",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const rows = [["Modus operandi", "Eventos", "%"]];
        agg.topModus.forEach(([name, val]) => {
          rows.push([window.CGES.toTitle(name), val, agg.total ? Math.round(val/agg.total*100)+"%" : "0%"]);
        });
        return [{ name: "Modus operandi", rows }];
      },
      charts: [{ chartId: "chart-modus", label: "Gráfica en JPEG" }],
    },

    temporal: {
      filenameBase: "Analisis_Temporal",
      captureId: "temporal-grid",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const franjas = ["MADRUGADA","MAÑANA","TARDE","NOCHE"];
        function sheetFor(heat, name) {
          const rows = [["Franja", ...window.CGES.DIAS_ORDEN, "Total"]];
          franjas.forEach(f => {
            let total = 0;
            const row = [window.CGES.toTitle(f)];
            window.CGES.DIAS_ORDEN.forEach(d => { const v = (heat[f] && heat[f][d]) || 0; total += v; row.push(v); });
            row.push(total);
            rows.push(row);
          });
          return { name, rows };
        }
        return [sheetFor(agg.heatmapViolencia, "Con violencia"), sheetFor(agg.heatmapSinViolencia, "Sin violencia")];
      },
      charts: [],
    },

    colonias: {
      filenameBase: "Municipios_Colonias_Sectores",
      captureId: "colonias-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const sheetMun = { name: "Municipios", rows: [["Municipio","Eventos"], ...agg.topMunicipios.map(([n,v]) => [window.CGES.toTitle(n), v])] };
        const sheetCol = { name: "Colonias", rows: [["Municipio","Colonia","Eventos","%"], ...agg.topColoniasDetalle.map(d => [window.CGES.toTitle(d.municipio), window.CGES.toTitle(d.colonia), d.count, agg.total ? Math.round(d.count/agg.total*100)+"%" : "0%"])] };
        const sheetSec = { name: "Sectores", rows: [["Sector","Eventos","%"], ...agg.topSectores.map(([n,v]) => [n, v, agg.total ? Math.round(v/agg.total*100)+"%" : "0%"])] };
        return [sheetMun, sheetCol, sheetSec];
      },
      charts: [{ chartId: "chart-municipios", label: "Gráfica de municipios (JPEG)" }],
    },

    marcas: {
      filenameBase: "Marcas_Submarcas",
      captureId: "marcas-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const sheetM = { name: "Marcas", rows: [["Marca","Eventos"], ...agg.topMarcas.map(([n,v]) => [window.CGES.toTitle(n), v])] };
        const sheetS = { name: "Submarcas", rows: [["Submarca","Eventos"], ...agg.topSubmarcas.map(([n,v]) => [window.CGES.toTitle(n), v])] };
        return [sheetM, sheetS];
      },
      charts: [
        { chartId: "chart-marcas", label: "Gráfica de marcas (JPEG)" },
        { chartId: "chart-submarcas", label: "Gráfica de submarcas (JPEG)" },
      ],
    },

    anomalias: {
      filenameBase: "Alertas_Zonas_Atipicas",
      captureId: "anomalias-section",
      xlsxSheets: () => {
        const result = window.CGES.computeAnomalias(STATE.allRecords, STATE.filters);
        const rows = [["Municipio", "Eventos periodo de referencia", "Promedio histórico", "Desviación estándar", "Z-score"]];
        result.items.forEach(it => rows.push([window.CGES.toTitle(it.municipio), it.actual, it.media, it.std, it.z]));
        return [{ name: "Anomalías", rows }];
      },
      charts: [],
    },

    delitos: {
      filenameBase: "Distribucion_Por_Delito",
      captureId: "delito-breakdown-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const rows = [["Delito", "Eventos", "%"]];
        agg.topDelitos.forEach(([n, v]) => rows.push([window.CGES.toTitle(n), v, agg.total ? Math.round(v/agg.total*100)+"%" : "0%"]));
        return [{ name: "Por delito", rows }];
      },
      charts: [{ chartId: "chart-delitos", label: "Gráfica en JPEG" }],
    },

    universal: {
      filenameBase: "Monto_Objetos_Transporte",
      captureId: "universal-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const sheetMonto = { name: "Monto", rows: [
          ["Indicador", "Valor"],
          ["Registros con monto", agg.montoStats.registrosConMonto],
          ["Monto total", agg.montoStats.montoTotal],
          ["Monto promedio", agg.montoStats.montoPromedio],
        ]};
        const sheetObjetos = { name: "Objetos robados", rows: [["Objeto","Eventos"], ...agg.topObjetosRobados.map(([n,v]) => [n, v])] };
        const sheetTransporte = { name: "Medio transporte agresor", rows: [["Medio","Eventos"], ...agg.topMedioTransporte.map(([n,v]) => [n, v])] };
        return [sheetMonto, sheetObjetos, sheetTransporte];
      },
      charts: [
        { chartId: "chart-objetos-robados", label: "Gráfica de objetos robados (JPEG)" },
        { chartId: "chart-medio-transporte", label: "Gráfica de medio de transporte (JPEG)" },
      ],
    },

    "giro-comercial": {
      filenameBase: "Giro_Comercial",
      captureId: "giro-comercial-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        return [{ name: "Giro comercial", rows: [["Giro","Eventos"], ...agg.topGirosComerciales.map(([n,v]) => [window.CGES.toTitle(n), v])] }];
      },
      charts: [{ chartId: "chart-giro-comercial", label: "Gráfica en JPEG" }],
    },

    cuentahabientes: {
      filenameBase: "Robo_Cuentahabientes",
      captureId: "cuentahabientes-section",
      xlsxSheets: () => {
        const agg = STATE.lastAgg; if (!agg) return [];
        const s = agg.cuentahabientesStats;
        return [{ name: "Cuentahabientes", rows: [
          ["Indicador", "Valor"],
          ["Eventos", s.total],
          ["Monto exigido", s.totalExigido],
          ["Monto pagado", s.totalPagado],
          ["Monto recuperado", s.totalRecuperado],
          ["% Tarjeta clonada", s.pctTarjetaClonada + "%"],
          ["% Extorsión telefónica", s.pctExtorsionTelefonica + "%"],
        ]}];
      },
      charts: [],
    },

    detenidos: {
      filenameBase: "Detenidos_Aseguramientos",
      captureId: "detenidos-section",
      xlsxSheets: null,
      charts: [],
    },

    recuperados: {
      filenameBase: "Vehiculos_Recuperados",
      captureId: "recuperados-section",
      xlsxSheets: null,
      charts: [],
    },

    map: {
      filenameBase: "Mapa_Robos_Georreferenciados",
      captureId: "map",
      customCapture: () => window.CGES.captureMapImage(),
      customCaptureErrorMsg: "No fue posible generar la captura del mapa (restricción de seguridad del navegador con los tiles del mapa base). Intenta con una captura manual del sistema operativo.",
      xlsxSheets: () => {
        const rows = [["Fecha","Municipio","Colonia","Sector","Modus operandi","Violencia","Marca","Submarca","Latitud","Longitud"]];
        (STATE.filtered || []).filter(r => r.lat && r.lon).forEach(r => {
          rows.push([
            r.fecha ? new Date(r.fecha).toLocaleDateString("es-MX") : "",
            window.CGES.toTitle(r.municipio), window.CGES.toTitle(r.colonia), r.sector,
            window.CGES.toTitle(r.modus), r.conViolencia ? "Con violencia" : "Sin violencia",
            window.CGES.toTitle(r.marca), window.CGES.toTitle(r.submarca), r.lat, r.lon,
          ]);
        });
        return [{ name: "Robos georreferenciados", rows }];
      },
      charts: [],
    },
  };
}

/* -------------------------------------------------------------------------
   Construcción del botón + menú desplegable, e inyección en el DOM
   ------------------------------------------------------------------------- */
function dlAttachMenu(anchorEl, key, config) {
  const container = document.createElement("div");
  container.className = "dl-container";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dl-btn";
  btn.title = "Opciones de descarga";
  btn.innerHTML = DL_ICON_SVG;

  const menu = document.createElement("div");
  menu.className = "dl-menu";
  menu.style.display = "none";

  const options = [];
  options.push({
    icon: "📸", label: "Captura de pantalla (JPG)",
    action: () => config.customCapture
      ? dlCapturaCustom(config.customCapture, config.filenameBase, config.customCaptureErrorMsg)
      : dlCaptura(config.captureId, config.filenameBase),
  });
  if (config.xlsxSheets) {
    options.push({ icon: "📋", label: "Datos en Excel (XLSX)", action: () => dlXLSX(config.xlsxSheets(), config.filenameBase) });
  }
  (config.charts || []).forEach(c => {
    options.push({ icon: "📊", label: c.label, action: () => dlChartJPEG(c.chartId, `${config.filenameBase}_${c.chartId}`) });
  });

  options.forEach(opt => {
    const optBtn = document.createElement("button");
    optBtn.type = "button";
    optBtn.className = "dl-option";
    optBtn.innerHTML = `<span class="dl-icon">${opt.icon}</span><span>${opt.label}</span>`;
    optBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.style.display = "none";
      await opt.action();
    });
    menu.appendChild(optBtn);
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".dl-menu").forEach(m => { if (m !== menu) m.style.display = "none"; });
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  container.appendChild(btn);
  container.appendChild(menu);
  anchorEl.appendChild(container);
}

function initDownloadMenus() {
  const configs = dlBuildConfigs();
  document.querySelectorAll("[data-dl]").forEach(el => {
    const key = el.getAttribute("data-dl");
    const config = configs[key];
    if (!config) return;
    dlAttachMenu(el, key, config);
  });

  // Cerrar cualquier menú abierto al hacer clic fuera de él.
  document.addEventListener("click", () => {
    document.querySelectorAll(".dl-menu").forEach(m => { m.style.display = "none"; });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Espera un momento a que main.js haya renderizado la primera vez,
  // para que los menús ya encuentren CHART_INSTANCES poblado si el usuario
  // hace clic de inmediato (no es estrictamente necesario, pero es más robusto).
  initDownloadMenus();
});
