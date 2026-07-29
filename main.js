/* =========================================================================
   main.js — Orquestación general del dashboard
   Carga datos -> puebla filtros -> calcula agregados -> pinta todo
   Los filtros son cruzados: afectan KPIs, gráficas y mapa a la vez.
   ========================================================================= */

const STATE = {
  allRecords: [],
  filtered: [],
  filters: { delito: "all", anio: "all", mes: "all", municipio: "all", violencia: "all" },
  source: "live",
};

function fmtNum(n) {
  return (n ?? 0).toLocaleString("es-MX");
}

function fmtDelta(curr, prev, label) {
  const suffix = label || "vs. periodo anterior";
  if (prev === null || prev === undefined || prev === 0) {
    return `<span class="kpi-na">Sin dato ${suffix.replace(/^vs\.?\s*/i, "de ")} para comparar</span>`;
  }
  const pct = Math.round(((curr - prev) / prev) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "■";
  return `<span class="kpi-delta ${dir}">${arrow} ${Math.abs(pct)}% ${suffix}</span>`;
}

// Predicado puro de filtrado, reutilizado tanto por applyFilters() como por
// getComparisonAgg() (que necesita aplicar los MISMOS filtros pero con
// año/mes distintos, para construir el período de comparación).
function recordMatchesFilters(r, f) {
  if (f.delito !== "all" && r.delitoEst !== f.delito) return false;
  if (f.anio !== "all" && String(r.anio) !== String(f.anio)) return false;
  if (f.mes !== "all" && r.mes !== f.mes) return false;
  if (f.municipio !== "all" && r.municipioGeo !== f.municipio) return false;
  if (f.violencia !== "all") {
    const wantViolence = f.violencia === "con";
    if (r.conViolencia !== wantViolence) return false;
  }
  return true;
}

/* ---------------------- Filtros ---------------------- */
function applyFilters() {
  STATE.filtered = STATE.allRecords.filter(r => recordMatchesFilters(r, STATE.filters));
}

// Opción 2 — Comparativo período-contra-período estilo CompStat (NYPD):
// determina automáticamente el período de comparación más relevante según lo
// que el usuario tenga filtrado (mes+año -> vs. mes anterior; solo año ->
// vs. año anterior; sin año -> vs. el año previo al más reciente disponible),
// aplicando los MISMOS demás filtros (delito, municipio, violencia).
function getComparisonAgg() {
  const f = STATE.filters;
  const all = STATE.allRecords;
  const mesesOrden = window.CGES.MESES_ORDEN;

  function subsetConOverride(overrides) {
    const merged = Object.assign({}, f, overrides);
    return all.filter(r => recordMatchesFilters(r, merged));
  }

  let cmpRecords = null, label = null;
  if (f.mes !== "all" && f.anio !== "all") {
    const anioNum = parseInt(f.anio, 10);
    const mesIdx = mesesOrden.indexOf(f.mes);
    let prevMes, prevAnio;
    if (mesIdx > 0) { prevMes = mesesOrden[mesIdx - 1]; prevAnio = anioNum; }
    else { prevMes = mesesOrden[11]; prevAnio = anioNum - 1; }
    cmpRecords = subsetConOverride({ anio: String(prevAnio), mes: prevMes });
    label = "vs. mes anterior";
  } else if (f.anio !== "all") {
    const anioNum = parseInt(f.anio, 10);
    cmpRecords = subsetConOverride({ anio: String(anioNum - 1), mes: "all" });
    label = `vs. ${anioNum - 1}`;
  } else {
    const years = [...new Set(all.map(r => r.anio))].filter(Boolean).sort((a, b) => a - b);
    if (years.length >= 2) {
      const prev = years[years.length - 2];
      cmpRecords = subsetConOverride({ anio: String(prev), mes: "all" });
      label = `vs. ${prev}`;
    }
  }

  if (!cmpRecords) return null;
  return { agg: window.CGES.computeAggregates(cmpRecords), label };
}

function populateFilterOptions() {
  const years = [...new Set(STATE.allRecords.map(r => r.anio))].sort();
  const municipios = [...new Set(STATE.allRecords.map(r => r.municipioGeo))].sort();

  // Catálogo fijo de 7 delitos (no derivado de los datos): así el selector
  // siempre muestra las mismas 7 opciones aunque el Sheet de prueba todavía
  // no tenga filas para alguno de ellos (ej. Cuentahabientes / Carga Pesada).
  fillSelect("filter-delito", window.CGES.DELITOS_CATALOGO, "Todos los delitos", window.CGES.toTitle);

  fillSelect("filter-anio", years, "Todos los años");
  fillSelect("filter-mes", window.CGES.MESES_ORDEN, "Todos los meses", window.CGES.toTitle);
  fillSelect("filter-municipio", municipios, "Todos los municipios", window.CGES.toTitle);
}

function fillSelect(id, values, placeholderLabel, labelFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="all">${placeholderLabel}</option>` +
    values.map(v => `<option value="${v}">${labelFn ? labelFn(v) : v}</option>`).join("");
}

function wireFilterEvents() {
  ["filter-delito","filter-anio","filter-mes","filter-municipio","filter-violencia"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const key = id.replace("filter-","");
      STATE.filters[key] = el.value;
      renderAll();
    });
  });

  const btnReset = document.getElementById("btn-reset-filters");
  if (btnReset) btnReset.addEventListener("click", () => {
    STATE.filters = { delito: "all", anio: "all", mes: "all", municipio: "all", violencia: "all" };
    ["filter-delito","filter-anio","filter-mes","filter-municipio","filter-violencia"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = "all"; });
    renderAll();
  });
}

/* ---------------------- Render de KPIs y narrativas ---------------------- */
function renderKPIs(agg) {
  setText("kpi-total", fmtNum(agg.total));
  setText("kpi-con-violencia", fmtNum(agg.conViolencia));
  setText("kpi-sin-violencia", fmtNum(agg.sinViolencia));
  setText("kpi-pct-violencia", `${agg.pctConViolencia}%`);

  // Opción 2 (CompStat): comparativo automático contra el período anterior
  // más relevante según el filtro activo (mes anterior / año anterior).
  const cmp = getComparisonAgg();
  if (cmp) {
    setHtml("kpi-total-delta", fmtDelta(agg.total, cmp.agg.total, cmp.label));
    setHtml("kpi-con-violencia-delta", fmtDelta(agg.conViolencia, cmp.agg.conViolencia, cmp.label));
    setHtml("kpi-sin-violencia-delta", fmtDelta(agg.sinViolencia, cmp.agg.sinViolencia, cmp.label));
    setHtml("kpi-pct-violencia-delta", fmtDelta(agg.pctConViolencia, cmp.agg.pctConViolencia, cmp.label));
  } else {
    ["kpi-total-delta","kpi-con-violencia-delta","kpi-sin-violencia-delta","kpi-pct-violencia-delta"]
      .forEach(id => setHtml(id, `<span class="kpi-na">Sin periodo previo para comparar</span>`));
  }

  document.getElementById("filter-count").textContent =
    `${fmtNum(STATE.filtered.length)} de ${fmtNum(STATE.allRecords.length)} registros bajo el filtro actual`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function renderInsights(agg) {
  const modusTop = agg.topModus[0];
  const colTop = agg.topColoniasDetalle[0];
  const secTop = agg.topSectores[0];
  const marcaTop = agg.topMarcas[0];

  setHtml("insight-violence",
    agg.total
      ? `Del total analizado bajo el filtro actual (<b>${fmtNum(agg.total)}</b> eventos), el <b>${agg.pctSinViolencia}%</b> ocurrió sin violencia y el <b>${agg.pctConViolencia}%</b> con violencia.`
      : `No hay eventos que coincidan con el filtro seleccionado.`);

  setHtml("insight-modus",
    modusTop
      ? `El modus operandi más recurrente es <b>${window.CGES.toTitle(modusTop[0])}</b>, con ${fmtNum(modusTop[1])} eventos (${Math.round(modusTop[1]/agg.total*100)}% del total filtrado).`
      : `No hay datos suficientes de modus operandi para este filtro.`);

  setHtml("insight-colonias",
    colTop
      ? `<b>${window.CGES.toTitle(colTop.colonia)}</b>, en el municipio de <b>${window.CGES.toTitle(colTop.municipio)}</b>, es la colonia con mayor incidencia bajo el filtro actual (${fmtNum(colTop.count)} eventos). El sector con mayor incidencia es <b>${secTop ? secTop[0] : "s/d"}</b> con ${secTop?fmtNum(secTop[1]):0} eventos.`
      : `No hay datos suficientes de colonias para este filtro.`);

  setHtml("insight-marcas",
    marcaTop
      ? `<b>${window.CGES.toTitle(marcaTop[0])}</b> es la marca con mayor incidencia (${fmtNum(marcaTop[1])} eventos, ${Math.round(marcaTop[1]/agg.total*100)}% del total filtrado).`
      : `No hay datos suficientes de marcas para este filtro.`);

  const notAvailable = `<span class="not-available">Este dataset (muestra cruda de Fiscalía) no trae una columna explícita de estatus de recuperación/detención. Cuando el Google Sheet incorpore ese campo (ver <code>data-mapping.md</code>), esta sección se completará automáticamente sin cambios de código.</span>`;
  setHtml("insight-detenidos", agg.situacionesDisponibles
    ? `Se identificaron registros con estatus de seguimiento en el campo "SituaciOn".`
    : notAvailable);
  setHtml("insight-recuperados", agg.situacionesDisponibles
    ? `Se identificaron registros con estatus de recuperación en el campo "SituaciOn".`
    : notAvailable);
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* ---------------------- Tablas de ranking ---------------------- */
function fmtDeltaCelda(delta) {
  if (!delta) return `<span class="kpi-na">Sin dato</span>`;
  const dir = delta.delta > 0 ? "up" : delta.delta < 0 ? "down" : "flat";
  const arrow = delta.delta > 0 ? "▲" : delta.delta < 0 ? "▼" : "■";
  const pctTxt = delta.deltaPct === null ? "" : ` (${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct}%)`;
  return `<span class="kpi-delta ${dir}">${arrow} ${delta.delta > 0 ? "+" : ""}${delta.delta}${pctTxt}</span>`;
}

function renderRankTable(tbodyId, entries, total, comparativoPorClave) {
  const el = document.getElementById(tbodyId);
  if (!el) return;
  const max = entries.length ? entries[0][1] : 1;
  el.innerHTML = entries.map(([name, value]) => {
    const delta = comparativoPorClave ? comparativoPorClave[name] : null;
    return `
    <tr>
      <td class="bar-cell"><div class="bar" style="width:${(value/max*100).toFixed(0)}%"></div><span>${window.CGES.toTitle(name)}</span></td>
      <td>${fmtNum(value)}</td>
      <td>${total ? Math.round(value/total*100) : 0}%</td>
      <td>${fmtDeltaCelda(delta)}</td>
    </tr>`;
  }).join("");
}

// Tabla de colonias con columna de Municipio en primer lugar, para
// desambiguar colonias homónimas entre municipios (ej. "Centro").
function renderColoniasTable(tbodyId, detalle, total, comparativoPorClave) {
  const el = document.getElementById(tbodyId);
  if (!el) return;
  const max = detalle.length ? detalle[0].count : 1;
  el.innerHTML = detalle.map(d => {
    const clave = `${d.municipio}|||${d.colonia}`;
    const delta = comparativoPorClave ? comparativoPorClave[clave] : null;
    return `
    <tr>
      <td>${window.CGES.toTitle(d.municipio)}</td>
      <td class="bar-cell"><div class="bar" style="width:${(d.count/max*100).toFixed(0)}%"></div><span>${window.CGES.toTitle(d.colonia)}</span></td>
      <td>${fmtNum(d.count)}</td>
      <td>${total ? Math.round(d.count/total*100) : 0}%</td>
      <td>${fmtDeltaCelda(delta)}</td>
    </tr>`;
  }).join("");
}

/* ---------------------------------------------------------------------
   Secciones dependientes del delito filtrado:
   - "all" o un delito vehicular (moto/particular/carga pesada) -> Marcas/Submarcas
   - cualquier otro delito -> bloque universal (Monto, Objetos robados, Medio
     de transporte del agresor), más un bloque específico si aplica
     (Giro comercial para Robo a Negocio, módulo dedicado para Cuentahabientes).
   - El desglose "Distribución por tipo de delito" solo aporta cuando se está
     viendo la mezcla completa ("Todos los delitos").
   --------------------------------------------------------------------- */
function fmtMoneda(n) {
  return "$" + Math.round(n || 0).toLocaleString("es-MX");
}

// Solo para la gráfica "Eventos por tipo de Robo": quita el prefijo
// "ROBO A "/"ROBO DE " de las 7 categorías de Delito_EST, dejando únicamente
// el tipo (ej. "ROBO A VEHICULOS PARTICULARES" -> "Vehículos Particulares").
// No se usa en ningún otro lugar (el dropdown de Delito conserva el nombre completo).
function shortenDelitoLabel(name) {
  const stripped = (name || "").toString().replace(/^ROBO\s+(A|DE)\s+/i, "");
  return window.CGES.toTitle(stripped);
}

function renderUniversalBlocks(agg) {
  const m = agg.montoStats;
  setHtml("universal-monto",
    m.disponible
      ? `Se identificó monto sustraído en <b>${fmtNum(m.registrosConMonto)}</b> de ${fmtNum(agg.total)} eventos filtrados. Monto total: <b>${fmtMoneda(m.montoTotal)}</b> · Promedio por evento: <b>${fmtMoneda(m.montoPromedio)}</b>.`
      : `Este subconjunto de delitos no trae monto sustraído (columna "MONTO") capturado en el Sheet bajo el filtro actual.`);

  if (agg.topObjetosRobados.length) {
    window.CGES.renderHBar("chart-objetos-robados", agg.topObjetosRobados, window.CGES.PALETTE.blue);
  }
  setHtml("universal-objetos-nota", agg.topObjetosRobados.length
    ? `Ranking construido a partir del texto libre de la columna "OBJETOS_RO", separado por comas/conjunciones.`
    : `No hay suficientes datos en la columna "OBJETOS_RO" para este filtro.`);

  if (agg.topMedioTransporte.length) {
    window.CGES.renderHBar("chart-medio-transporte", agg.topMedioTransporte, window.CGES.PALETTE.navy);
  }
  setHtml("universal-transporte-nota", agg.topMedioTransporte.length
    ? `Con dato disponible en ${fmtNum(agg.medioTransporteDisponible)} de ${fmtNum(agg.total)} eventos filtrados (columnas pres_vehic / pres_moto / pre_tierra / pre_otro).`
    : `No hay datos suficientes de medio de transporte del agresor para este filtro.`);
}

function renderCuentahabientes(stats) {
  setHtml("cuenta-resumen",
    stats.disponible
      ? `De <b>${fmtNum(stats.total)}</b> eventos de Robo a Cuentahabientes bajo el filtro actual: monto exigido <b>${fmtMoneda(stats.totalExigido)}</b>, pagado <b>${fmtMoneda(stats.totalPagado)}</b>, recuperado <b>${fmtMoneda(stats.totalRecuperado)}</b>. Tarjeta clonada en <b>${stats.pctTarjetaClonada}%</b> de los casos; extorsión telefónica en <b>${stats.pctExtorsionTelefonica}%</b>.`
      : `El Sheet aún no trae, para este filtro, valores capturados en las columnas CANT_EXIG / CANT_PAG / CANT_RECU / TARJ_CLO / EXTOR_TELE. En cuanto Fiscalía las incorpore, este módulo se completa automáticamente sin cambios de código.`);
}

function updateDelitoDependentSections(agg) {
  const delito = STATE.filters.delito;
  const esVehicular = delito === "all" || window.CGES.DELITOS_VEHICULARES.includes(delito);

  const marcasSection = document.getElementById("marcas-section");
  const universalSection = document.getElementById("universal-section");
  if (marcasSection) marcasSection.style.display = esVehicular ? "" : "none";
  if (universalSection) universalSection.style.display = esVehicular ? "none" : "";

  if (esVehicular) {
    window.CGES.renderHBar("chart-marcas", agg.topMarcas, window.CGES.PALETTE.orange);
    window.CGES.renderHBar("chart-submarcas", agg.topSubmarcas, window.CGES.PALETTE.orangeDark);
  } else {
    renderUniversalBlocks(agg);
  }

  const giroSection = document.getElementById("giro-comercial-section");
  if (giroSection) {
    const show = delito === "ROBO A NEGOCIO";
    giroSection.style.display = show ? "" : "none";
    if (show) window.CGES.renderHBar("chart-giro-comercial", agg.topGirosComerciales, window.CGES.PALETTE.blueLight);
  }

  const cuentaSection = document.getElementById("cuentahabientes-section");
  if (cuentaSection) {
    const show = delito === "ROBO A CUENTAHABIENTES";
    cuentaSection.style.display = show ? "" : "none";
    if (show) renderCuentahabientes(agg.cuentahabientesStats);
  }

  const delitoBreakdown = document.getElementById("delito-breakdown-section");
  if (delitoBreakdown) {
    const show = delito === "all";
    delitoBreakdown.style.display = show ? "" : "none";
    if (show) {
      const shortEntries = agg.topDelitos.map(([name, value]) => [shortenDelitoLabel(name), value]);
      window.CGES.renderHBar("chart-delitos", shortEntries, window.CGES.PALETTE.navy);
    }
  }

  // Las secciones que alternan entre oculto/visible pueden dejar a ECharts
  // con un contenedor de tamaño 0 si el navegador no repintó a tiempo; un
  // resize forzado (ya escuchado por cada instancia, ver getOrCreateChart en
  // charts.js) corrige el tamaño sin duplicar lógica.
  window.dispatchEvent(new Event("resize"));
}

// Registra tarjetas no-ECharts (KPIs, heatmap, rankings) en el mismo
// mecanismo de "PLUS +" para que también se sientan vivas al hacer scroll.
// Opción 1 — Top municipios: cifras absolutas vs. tasa por 100k habitantes.
// Metodología UNODC/FBI-UCR/INEGI para comparar municipios de distinto tamaño
// Combina cifra absoluta + tasa por 100k hab. en una sola gráfica (2 barras
// por municipio, doble eje). Ver renderMunicipiosCombo() en charts.js para
// el detalle de por qué se necesita doble eje (unidades muy distintas).
function renderMunicipiosChart(agg) {
  if (typeof window.CGES.renderMunicipiosCombo === "function") {
    window.CGES.renderMunicipiosCombo(agg.topMunicipios, agg.topMunicipiosPorTasa);
  } else {
    // Respaldo si charts.js todavía es una versión anterior (sin la gráfica
    // combinada) — evita que todo el dashboard truene por un solo archivo
    // desactualizado; muestra al menos la cifra absoluta.
    console.warn("window.CGES.renderMunicipiosCombo no existe — charts.js parece ser una versión anterior. Sube el charts.js más reciente.");
    if (typeof window.CGES.renderHBar === "function") {
      window.CGES.renderHBar("chart-municipios", agg.topMunicipios, window.CGES.PALETTE.navy);
    }
  }
  const sinPoblacion = agg.topMunicipios.length - agg.topMunicipiosPorTasa.length;
  setHtml("municipios-rate-nota",
    `<b style="color:var(--navy);">■</b> Cifra absoluta de eventos &nbsp;·&nbsp; <b style="color:${window.CGES.PALETTE.blueLight};">■</b> Tasa por cada 100,000 habitantes ` +
    `(población: Censo INEGI 2020, vía IIEG Jalisco) — metodología usada para comparar municipios de distinto tamaño de forma justa (mismo criterio que INEGI/ONU-UNODC).` +
    (sinPoblacion > 0 ? ` ${sinPoblacion} municipio(s) sin población catalogada no muestran barra de tasa.` : ""));
}

// Opción 4 — Alertas de zonas atípicas (gestión por excepción / control
// estadístico de procesos, ver computeAnomalias en data.js) + comparativo
// mes a mes de los 9 municipios del AMG, ordenado por orden de impacto
// (magnitud absoluta del cambio en eventos, ver computeComparativoMunicipiosMoM
// en data.js).
function updateAnomalias() {
  const result = window.CGES.computeAnomalias(STATE.allRecords, STATE.filters);
  const comparativo = window.CGES.computeComparativoMunicipiosMoM(STATE.allRecords, STATE.filters);
  let html = "";

  if (!result.disponible) {
    html += `<div style="margin-bottom:14px;"><span class="not-available">Aún no hay suficiente historial mensual por municipio (se necesitan al menos 3 meses previos de datos) para detectar zonas estadísticamente atípicas bajo este filtro — esta sección se poblará automáticamente conforme el Sheet acumule más meses.</span></div>`;
  } else {
    const periodoTxt = `${window.CGES.toTitle(result.periodoRef.mes)} ${result.periodoRef.anio}`;
    const rows = result.items.map(it => {
      const dir = it.z > 0 ? "up" : "down";
      const arrow = it.z > 0 ? "▲" : "▼";
      const pct = it.media ? Math.round(((it.actual - it.media) / it.media) * 100) : 0;
      return `<div style="margin-bottom:6px;"><b>${window.CGES.toTitle(it.municipio)}</b>: ${fmtNum(it.actual)} eventos en ${periodoTxt} — ` +
        `<span class="kpi-delta ${dir}">${arrow} ${Math.abs(pct)}% sobre su promedio histórico (${it.media})</span></div>`;
    }).join("");
    html += `<div style="margin-bottom:6px; color:var(--gray-text); font-size:12.5px;">Detección estadística — período de referencia: <b>${periodoTxt}</b>. Umbral: ±1.5 desviaciones estándar sobre el historial propio de cada municipio.</div>${rows || `<span class="not-available">Ningún municipio se desvía de forma significativa de su historial bajo este filtro.</span>`}`;
  }

  if (comparativo.disponible) {
    const refTxt = `${window.CGES.toTitle(comparativo.periodoRef.mes)} ${comparativo.periodoRef.anio}`;
    const prevTxt = `${window.CGES.toTitle(comparativo.periodoAnterior.mes)} ${comparativo.periodoAnterior.anio}`;
    const filas = comparativo.items.map(it => {
      const dir = it.delta > 0 ? "up" : it.delta < 0 ? "down" : "flat";
      const arrow = it.delta > 0 ? "▲" : it.delta < 0 ? "▼" : "■";
      const pctTxt = it.deltaPct === null ? "" : ` (${it.deltaPct > 0 ? "+" : ""}${it.deltaPct}%)`;
      return `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid var(--gray-card); font-size:13px;">
        <span><b>${window.CGES.toTitle(it.municipio)}</b></span>
        <span class="kpi-delta ${dir}">${arrow} ${it.delta > 0 ? "+" : ""}${it.delta}${pctTxt} <span style="color:var(--gray-text); font-weight:400;">(${it.actual} vs ${it.anterior})</span></span>
      </div>`;
    }).join("");
    html += `<div style="margin-top:16px; padding-top:12px; border-top:1px dashed var(--gray-line);">
      <div style="font-weight:700; color:var(--navy); margin-bottom:6px; font-size:13px;">Comparativo mes a mes por municipio — ${refTxt} vs. ${prevTxt} (orden de impacto)</div>
      ${filas}
    </div>`;
  }

  setHtml("anomalias-lista", html);
}

// Explica, debajo de "Top municipios", qué criterio se usó para la columna
// "vs. mes ant." de las tablas de colonias/sectores: mes completo o
// Month-to-Date (MTD), según lo que realmente exista capturado en el Sheet.
function renderComparativoDetalladoNota(c) {
  if (!c.disponible) { setHtml("colonias-mtd-nota", ""); return; }
  const refTxt = `${window.CGES.toTitle(c.periodoRef.mes)} ${c.periodoRef.anio}`;
  const prevTxt = `${window.CGES.toTitle(c.periodoAnterior.mes)} ${c.periodoAnterior.anio}`;
  const metodo = c.esCompleto
    ? `mes completo (${c.totalDiasRef} días) de <b>${refTxt}</b> vs. mes completo de <b>${prevTxt}</b>`
    : `primeros <b>${c.corteDia}</b> días de <b>${refTxt}</b> (aún en captura) vs. los primeros ${c.corteDia} días de <b>${prevTxt}</b> — comparación "Month-to-Date"`;
  setHtml("colonias-mtd-nota", `Columna "vs. mes ant.": ${metodo}.`);
}

function observeAliveSections() {
  document.querySelectorAll("#kpis-section .kpi-card").forEach(el => window.CGES.observeReveal(el));
  document.querySelectorAll("#temporal-grid .card").forEach(el => window.CGES.observeReveal(el));
  window.CGES.observeReveal(document.getElementById("card-ranking-colonias"));
  window.CGES.observeReveal(document.getElementById("card-ranking-sectores"));
  window.CGES.observeReveal(document.getElementById("anomalias-lista"));
}

// Ejecuta un bloque de render de forma aislada: si truena (ej. por un
// archivo desactualizado que no trae una función nueva), se registra en
// consola con nombre del bloque y el dashboard sigue renderizando el resto,
// en vez de que un solo fallo tumbe toda la página con el mensaje genérico
// de "no se pudo cargar" (que además era engañoso: no era un problema de
// datos, sino de una función faltante).
function safeCall(nombreBloque, fn) {
  try { fn(); } catch (e) { console.error(`Error renderizando "${nombreBloque}":`, e); }
}

/* ---------------------- Render general ---------------------- */
function renderAll() {
  applyFilters();
  const agg = window.CGES.computeAggregates(STATE.filtered);
  STATE.lastAgg = agg;

  safeCall("KPIs", () => renderKPIs(agg));
  safeCall("Insights narrativos", () => renderInsights(agg));
  safeCall("Alertas de zonas atípicas", () => updateAnomalias());

  safeCall("Comparativo mensual", () => window.CGES.renderMonthlyTrend(agg.monthlyByMunicipio, window.CGES.MESES_ORDEN));
  safeCall("Dona de violencia", () => window.CGES.renderViolenceDonut(agg.conViolencia, agg.sinViolencia));
  safeCall("Dona de modus operandi", () => window.CGES.renderModusDonut(agg.topModus));
  safeCall("Gráfica de municipios", () => renderMunicipiosChart(agg));

  safeCall("Secciones dependientes del delito", () => updateDelitoDependentSections(agg));

  safeCall("Heatmap con violencia", () => window.CGES.renderHeatmapTable("heatmap-violencia", agg.heatmapViolencia, window.CGES.DIAS_ORDEN, "orange"));
  safeCall("Heatmap sin violencia", () => window.CGES.renderHeatmapTable("heatmap-sin-violencia", agg.heatmapSinViolencia, window.CGES.DIAS_ORDEN, "blue"));

  safeCall("Tablas de colonias y sectores", () => {
    const comparativoDetallado = window.CGES.computeComparativoDetallado(STATE.allRecords, STATE.filters);
    renderComparativoDetalladoNota(comparativoDetallado);
    renderColoniasTable("table-colonias", agg.topColoniasDetalle, agg.total, comparativoDetallado.porColonia);
    renderRankTable("table-sectores", agg.topSectores, agg.total, comparativoDetallado.porSector);
  });

  safeCall("Mapa dinámico", () => window.CGES.renderMapMarkers(STATE.filtered));

  safeCall("Efecto PLUS+ (reveal)", () => observeAliveSections());
}

/* ---------------------- Arranque ---------------------- */
async function boot() {
  const overlay = document.getElementById("loading-overlay");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  try {
    const { records, source, fetchedAt, error } = await window.CGES.loadDataset();
    STATE.allRecords = records;
    STATE.source = source;

    if (source === "live") {
      statusDot.className = "status-dot";
      statusText.textContent = `Conectado en vivo al Google Sheet · última lectura: ${fetchedAt.toLocaleTimeString("es-MX")}`;
    } else {
      statusDot.className = "status-dot warn";
      statusText.textContent = `Modo caché: no se pudo leer el Google Sheet en vivo (${error?.message || "error de red"}). Mostrando datos de respaldo.`;
    }

    populateFilterOptions();
    wireFilterEvents();
    renderAll();
  } catch (fatal) {
    statusDot.className = "status-dot err";
    statusText.textContent =
      `Ocurrió un error al iniciar el dashboard: "${fatal && fatal.message ? fatal.message : fatal}". ` +
      `Esto casi siempre significa que uno de los archivos JS (data.js/charts.js/map.js/main.js) no es la versión más reciente — revisa la consola del navegador (F12 → Console) para ver el detalle completo.`;
    console.error("Fallo en boot():", fatal);
  } finally {
    overlay.classList.add("hide");
    setTimeout(() => overlay.remove(), 500);
  }
}

document.addEventListener("DOMContentLoaded", boot);
