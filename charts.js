/* =========================================================================
   charts.js — Inicialización y actualización de gráficas (ECharts)
   Paleta: azul marino / azul medio / naranja institucional / grises
   ========================================================================= */

const PALETTE = {
  navy: "#13294B",
  navyDark: "#0B1F3A",
  blue: "#1B4F91",
  blueLight: "#2E6DB4",
  orange: "#F5821F",
  orangeDark: "#E8792D",
  gray: "#9AA5B1",
  green: "#1FA35C",
  red: "#D64545",
};

const CHART_INSTANCES = {};

/* =========================================================================
   Efecto "PLUS +" — gráficas vivas al hacer scroll
   -------------------------------------------------------------------------
   Controlado por el checkbox #toggle-plus (marcado por default). Cada
   gráfica de ECharts guarda su última "option" calculada; cuando su
   contenedor entra en pantalla (subiendo o bajando el scroll), se vuelve a
   aplicar esa misma option, pero primero con chart.clear() — esto fuerza a
   ECharts a desechar el estado interno anterior y reconstruir desde cero, lo
   cual es necesario para que la animación de entrada se repita: si solo se
   usara setOption (incluso con notMerge:true) sobre los MISMOS valores,
   ECharts detecta que no hay cambio real en los datos y no anima nada.
   ========================================================================= */
const CHART_LAST_OPTION = {};
const CHART_LAST_REPLAY = {};
const PLUS_REPLAY_COOLDOWN_MS = 1000;

function isPlusEnabled() {
  const el = document.getElementById("toggle-plus");
  return el ? el.checked : true;
}

let chartObserver = null;
function ensureChartObserver() {
  if (chartObserver) return chartObserver;
  chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !isPlusEnabled()) return;
      const domId = entry.target.dataset.chartId;
      const opt = domId && CHART_LAST_OPTION[domId];
      const inst = domId && CHART_INSTANCES[domId];
      if (!opt || !inst) return;
      const now = Date.now();
      if (CHART_LAST_REPLAY[domId] && now - CHART_LAST_REPLAY[domId] < PLUS_REPLAY_COOLDOWN_MS) return;
      CHART_LAST_REPLAY[domId] = now;
      inst.clear();
      inst.setOption(opt);
    });
  }, { threshold: 0.2 });
  return chartObserver;
}

// Todas las funciones de render de ECharts llaman a esto en vez de
// chart.setOption(...) directamente, para quedar registradas en el
// mecanismo de repetición por scroll.
function applyChartOption(domId, chart, option) {
  CHART_LAST_OPTION[domId] = option;
  chart.clear();
  chart.setOption(option);
  const el = document.getElementById(domId);
  if (el && !el.dataset.chartObserved) {
    el.dataset.chartId = domId;
    el.dataset.chartObserved = "1";
    ensureChartObserver().observe(el);
  }
}

// Reveal genérico para elementos que NO son gráficas de ECharts (tarjetas de
// KPI, heatmap, tablas de ranking): mismo criterio (scroll, 1s de cooldown,
// respeta el toggle), pero vía una animación CSS (.cges-replay) en vez de
// reconstruir una gráfica.
const REVEAL_LAST = new WeakMap();
let revealObserver = null;
function ensureRevealObserver() {
  if (revealObserver) return revealObserver;
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting || !isPlusEnabled()) return;
      const now = Date.now();
      const last = REVEAL_LAST.get(entry.target) || 0;
      if (now - last < PLUS_REPLAY_COOLDOWN_MS) return;
      REVEAL_LAST.set(entry.target, now);
      const el = entry.target;
      el.classList.remove("cges-replay");
      void el.offsetWidth; // fuerza reflow para poder re-disparar la misma animación
      el.classList.add("cges-replay");
    });
  }, { threshold: 0.15 });
  return revealObserver;
}
function observeReveal(el) {
  if (el) ensureRevealObserver().observe(el);
}

function getOrCreateChart(domId) {
  const el = document.getElementById(domId);
  if (!el) return null;
  if (CHART_INSTANCES[domId]) return CHART_INSTANCES[domId];
  const inst = echarts.init(el, null, { renderer: "svg" });
  CHART_INSTANCES[domId] = inst;
  window.addEventListener("resize", () => inst.resize());
  return inst;
}

function baseTooltip() {
  return { trigger: "item", backgroundColor: "#13294B", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } };
}

/* ---------------------- 1. Comparativo mensual por municipio (barras apiladas) ---------------------- */
function renderMonthlyTrend(monthlyByMunicipio, mesesOrden) {
  const chart = getOrCreateChart("chart-monthly");
  if (!chart) return;

  // Municipios ordenados por volumen total; los de menor volumen se agrupan en "Otros".
  const totals = {};
  Object.values(monthlyByMunicipio).forEach(byMun => {
    Object.entries(byMun).forEach(([mun, v]) => { totals[mun] = (totals[mun] || 0) + v; });
  });
  const ordered = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const TOP_N = 8;
  const topMunicipios = ordered.slice(0, TOP_N).map(([m]) => m);
  const hasOtros = ordered.length > TOP_N;

  const colors = [PALETTE.blue, PALETTE.orange, PALETTE.navy, PALETTE.green,
    PALETTE.blueLight, PALETTE.orangeDark, "#7C8B9E", "#B7C2CF"];

  const series = topMunicipios.map((mun, i) => ({
    name: toTitle(mun),
    type: "bar",
    stack: "total",
    itemStyle: { color: colors[i % colors.length] },
    data: mesesOrden.map(m => (monthlyByMunicipio[m] && monthlyByMunicipio[m][mun]) || 0),
  }));
  if (hasOtros) {
    series.push({
      name: "Otros",
      type: "bar",
      stack: "total",
      itemStyle: { color: PALETTE.gray },
      data: mesesOrden.map(m => {
        const byMun = monthlyByMunicipio[m] || {};
        return Object.entries(byMun).reduce((acc, [mun, v]) => topMunicipios.includes(mun) ? acc : acc + v, 0);
      }),
    });
  }

  applyChartOption("chart-monthly", chart, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { type: "scroll", top: 0, textStyle: { fontSize: 11 } },
    grid: { left: 40, right: 16, top: 40, bottom: 28 },
    xAxis: { type: "category", data: mesesOrden.map(m => m.slice(0,3)), axisLine: { lineStyle: { color: "#D8DCE2" } }, axisLabel: { color: "#13294B", fontWeight: 600, fontSize: 12 } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: "#EEF1F4" } } },
    series,
  });
}

/* ---------------------- 2. Dona con/sin violencia ---------------------- */
function renderViolenceDonut(conViolencia, sinViolencia) {
  const chart = getOrCreateChart("chart-violence");
  if (!chart) return;
  applyChartOption("chart-violence", chart, {
    tooltip: baseTooltip(),
    legend: { bottom: 0, textStyle: { fontSize: 12 } },
    series: [{
      type: "pie",
      radius: ["55%", "78%"],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { formatter: "{b}\n{d}%", fontSize: 12 },
      data: [
        { value: sinViolencia, name: "Sin violencia", itemStyle: { color: PALETTE.blue } },
        { value: conViolencia, name: "Con violencia", itemStyle: { color: PALETTE.orange } },
      ],
    }],
  });
}

/* ---------------------- 3. Modus operandi (dona) ---------------------- */
function renderModusDonut(topModus) {
  const chart = getOrCreateChart("chart-modus");
  if (!chart) return;
  const colors = [PALETTE.navy, PALETTE.blue, PALETTE.blueLight, PALETTE.orange, PALETTE.orangeDark, PALETTE.gray, "#7C8B9E", "#B7C2CF"];
  const data = topModus.slice(0,8).map(([name, value], i) => ({
    name: toTitle(name), value, itemStyle: { color: colors[i % colors.length] },
  }));
  const valueByName = {};
  data.forEach(d => { valueByName[d.name] = d.value; });

  applyChartOption("chart-modus", chart, {
    tooltip: baseTooltip(),
    legend: {
      orient: "vertical", right: 4, top: "middle", itemWidth: 10, itemHeight: 10,
      textStyle: { fontSize: 11 },
      formatter: name => `${name}   ${(valueByName[name] || 0).toLocaleString("es-MX")}`,
    },
    series: [{
      type: "pie",
      radius: ["45%", "72%"],
      center: ["32%", "50%"],
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data,
    }],
  });
}

/* ---------------------- 4. Barras horizontales genéricas ---------------------- */
function renderHBar(domId, entries, color) {
  const chart = getOrCreateChart(domId);
  if (!chart) return;
  const data = entries.slice().reverse();
  const labels = data.map(([name]) => toTitle(name));

  // Margen izquierdo dinámico: si es fijo (140px) los nombres largos (ej.
  // "Ixtlahuacan De Los Membrillos") se dibujan empezando fuera del lienzo y
  // se ven "cortados" por la izquierda. Se calcula en función del nombre más
  // largo de ESTE set de datos, con un piso y un techo razonables.
  const maxLabelLen = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const leftMargin = Math.min(260, Math.max(90, Math.round(maxLabelLen * 6.4) + 26));

  applyChartOption(domId, chart, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: leftMargin, right: 24, top: 10, bottom: 10 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#EEF1F4" } } },
    yAxis: { type: "category", data: labels, axisLabel: { fontSize: 11 } },
    series: [{
      type: "bar", data: data.map(([,v]) => v), barMaxWidth: 16,
      itemStyle: { color: color || PALETTE.blue, borderRadius: [0,4,4,0] },
      label: { show: true, position: "right", fontSize: 11, color: "#4A4F57" },
    }],
  });
}

/* ---------------------- 4b. Top municipios combinado (cifra absoluta + tasa por 100k hab.) ----------------------
   Doble eje de valores: las dos métricas viven en escalas muy distintas (una
   cifra absoluta puede ser >100, una tasa normalizada suele ser un número de
   una o dos cifras) — compartir un solo eje aplastaría visualmente la barra
   de tasa exactamente para los municipios chicos, que es lo que la tasa
   busca evitar. Eje inferior = cifra absoluta, eje superior = tasa.
   ------------------------------------------------------------------------- */
function renderMunicipiosCombo(topMunicipios, topMunicipiosPorTasa) {
  const chart = getOrCreateChart("chart-municipios");
  if (!chart) return;

  const tasaPorNombre = {};
  topMunicipiosPorTasa.forEach(d => { tasaPorNombre[d.nombre] = d.tasa; });

  // Orden: de mayor a menor por cifra absoluta (criterio confirmado para
  // esta gráfica), invertido para que el mayor quede arriba en el eje Y.
  const data = topMunicipios.slice(0, 10).slice().reverse();
  const labels = data.map(([name]) => toTitle(name));
  const counts = data.map(([, v]) => v);
  const tasas = data.map(([name]) => tasaPorNombre[name] ?? null);

  const maxLabelLen = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const leftMargin = Math.min(260, Math.max(90, Math.round(maxLabelLen * 6.4) + 26));

  applyChartOption("chart-municipios", chart, {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: {
      bottom: 0, textStyle: { fontSize: 11.5 },
      data: ["Eventos (cifra absoluta)", "Tasa por 100k hab."],
    },
    grid: { left: leftMargin, right: 24, top: 50, bottom: 40 },
    xAxis: [
      { type: "value", position: "bottom", name: "Eventos", nameLocation: "middle", nameGap: 22, nameTextStyle: { fontSize: 10, color: PALETTE.navy }, splitLine: { lineStyle: { color: "#EEF1F4" } } },
      { type: "value", position: "top", name: "Tasa /100k hab.", nameLocation: "middle", nameGap: 22, nameTextStyle: { fontSize: 10, color: PALETTE.blueLight }, splitLine: { show: false } },
    ],
    yAxis: { type: "category", data: labels, axisLabel: { fontSize: 11 } },
    series: [
      {
        name: "Eventos (cifra absoluta)", type: "bar", xAxisIndex: 0, data: counts,
        barMaxWidth: 11, itemStyle: { color: PALETTE.navy, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", fontSize: 10, color: "#4A4F57" },
      },
      {
        name: "Tasa por 100k hab.", type: "bar", xAxisIndex: 1, data: tasas,
        barMaxWidth: 11, itemStyle: { color: PALETTE.blueLight, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: "right", fontSize: 10, color: "#4A4F57", formatter: p => (p.value === null || p.value === undefined) ? "" : p.value },
      },
    ],
  });
}

/* ---------------------- 5. Heatmap día x franja ---------------------- */
function renderHeatmapTable(containerId, heatmapData, diasOrden, colorClass) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const franjas = ["MADRUGADA","MAÑANA","TARDE","NOCHE"];
  let max = 1;
  franjas.forEach(f => diasOrden.forEach(d => { max = Math.max(max, heatmapData[f][d] || 0); }));

  let html = `<div class="heatmap-wrap"><table class="heatmap"><thead><tr><th></th>`;
  diasOrden.forEach(d => html += `<th>${d}</th>`);
  html += `<th>Total</th></tr></thead><tbody>`;

  const rowTotals = {}; diasOrden.forEach(d => rowTotals[d]=0);
  franjas.forEach(f => {
    let rowTotal = 0;
    html += `<tr><td class="label">${toTitle(f)}</td>`;
    diasOrden.forEach(d => {
      const v = heatmapData[f][d] || 0;
      rowTotal += v; rowTotals[d]+=v;
      const intensity = v / max;
      const bg = colorClass === "orange"
        ? `rgba(245,130,31,${0.12 + intensity*0.75})`
        : `rgba(27,79,145,${0.12 + intensity*0.75})`;
      const textColor = intensity > 0.55 ? "#fff" : "#1B1F27";
      html += `<td style="background:${bg}; color:${textColor}; font-weight:${v?600:400}">${v||"·"}</td>`;
    });
    html += `<td class="total">${rowTotal}</td></tr>`;
  });
  html += `<tr><td class="label">Total</td>`;
  diasOrden.forEach(d => html += `<td class="total">${rowTotals[d]}</td>`);
  const grand = Object.values(rowTotals).reduce((a,b)=>a+b,0);
  html += `<td class="total">${grand}</td></tr>`;
  html += `</tbody></table></div>`;
  el.innerHTML = html;
}

/* ---------------------- Utilidades ---------------------- */
function toTitle(str){
  if (!str) return "Sin dato";
  return str.toString().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

window.CGES = window.CGES || {};
Object.assign(window.CGES, {
  renderMonthlyTrend, renderViolenceDonut, renderModusDonut,
  renderHBar, renderMunicipiosCombo, renderHeatmapTable, toTitle, PALETTE,
  observeReveal,
});
