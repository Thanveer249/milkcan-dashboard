const CAN_CONFIG = {
  1: { name: "Hybrid can", shortName: "Hybrid", target: 5, k: 0.03, accent: "orange" },
  2: { name: "Ordinary can", shortName: "Ordinary", target: 31, k: 0.004, accent: "navy" }
};

const state = {
  readings: [],
  alerts: [],
  batchNumber: 0,
  tick: 0,
  speed: 1,
  paused: false,
  simulatedSeconds: 0,
  aboveEightSeconds: { 1: 0, 2: 0 },
  previousStatus: { 1: null, 2: null },
  reachedEightAt: { 1: null, 2: null },
  lastTemperature: { 1: null, 2: null },
  chart: null
};

const $ = (id) => document.getElementById(id);

function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatSimulatedMinutes(seconds) {
  const minutes = seconds / 60;
  return minutes < 1 ? `${Math.round(seconds)} sec` : `${minutes.toFixed(1)} min`;
}

function getStatus(temperature, aboveSeconds) {
  if (temperature <= 8) return "SAFE";
  return aboveSeconds > 600 ? "ALERT" : "COOLING";
}

function getTemperature(canId, simulatedMinutes) {
  const config = CAN_CONFIG[canId];
  const ideal = config.target + (35 - config.target) * Math.exp(-config.k * simulatedMinutes);
  const noise = (Math.random() * 0.2) - 0.1;
  return Math.round((ideal + noise) * 10) / 10;
}

function addAlert(canId, status, recordedAt) {
  const config = CAN_CONFIG[canId];
  state.alerts.unshift({ canId, status, recordedAt, message: `${config.name} status changed to ${status}` });
  state.alerts = state.alerts.slice(0, 30);
}

function addReading(canId, recordedAt) {
  const simulatedMinutes = state.simulatedSeconds / 60;
  const temperatureC = getTemperature(canId, simulatedMinutes);
  const aboveSeconds = temperatureC > 8 ? state.aboveEightSeconds[canId] + (2 * state.speed) : 0;
  state.aboveEightSeconds[canId] = aboveSeconds;
  const status = getStatus(temperatureC, aboveSeconds);

  if (temperatureC <= 8 && state.reachedEightAt[canId] === null) state.reachedEightAt[canId] = state.simulatedSeconds;
  if (state.previousStatus[canId] !== status) addAlert(canId, status, recordedAt);
  state.previousStatus[canId] = status;
  state.lastTemperature[canId] = temperatureC;
  state.readings.push({ canId, temperatureC, recordedAt, status });
  state.readings = state.readings.slice(-120);
}

function runTick() {
  if (state.paused) return;
  state.tick += 1;
  state.simulatedSeconds += 2 * state.speed;
  const recordedAt = new Date().toISOString();
  addReading(1, recordedAt);
  addReading(2, recordedAt);
  if (state.tick >= 180) startNewBatch(false);
  else render();
}

function startNewBatch(renderNow = true) {
  state.readings = [];
  state.alerts = [];
  state.tick = 0;
  state.simulatedSeconds = 0;
  state.aboveEightSeconds = { 1: 0, 2: 0 };
  state.previousStatus = { 1: null, 2: null };
  state.reachedEightAt = { 1: null, 2: null };
  state.lastTemperature = { 1: null, 2: null };
  state.batchNumber += renderNow ? 1 : 1;
  addReading(1, new Date().toISOString());
  addReading(2, new Date().toISOString());
  if (renderNow) render();
}

function statusClass(status) { return status.toLowerCase(); }

function updateKpi(canId) {
  const canReadings = state.readings.filter((reading) => reading.canId === canId);
  const latest = canReadings[canReadings.length - 1];
  if (!latest) return;
  const previous = canReadings[canReadings.length - 2];
  const trend = previous ? (latest.temperatureC < previous.temperatureC ? "↓" : latest.temperatureC > previous.temperatureC ? "↑" : "→") : "→";
  const trendElement = $(`trend${canId}`);
  trendElement.textContent = trend;
  trendElement.className = `trend ${trend === "↓" ? "down" : trend === "↑" ? "up" : ""}`;
  $(`temp${canId}`).textContent = latest.temperatureC.toFixed(1);
  $(`status${canId}`).textContent = latest.status;
  $(`status${canId}`).className = `status-badge ${statusClass(latest.status)}`;
  $(`duration${canId}`).textContent = formatSimulatedMinutes(state.aboveEightSeconds[canId]);
  const meterWidth = Math.max(4, Math.min(100, ((latest.temperatureC - 4) / 31) * 100));
  $(`meter${canId}`).style.width = `${meterWidth}%`;
  $(`meter${canId}`).style.background = latest.status === "SAFE" ? "var(--green)" : latest.status === "ALERT" ? "var(--red)" : canId === 1 ? "var(--orange)" : "var(--navy)";
}

function updateStats(canId) {
  const values = state.readings.filter((reading) => reading.canId === canId).map((reading) => reading.temperatureC);
  if (!values.length) return;
  const min = Math.min(...values).toFixed(1);
  const max = Math.max(...values).toFixed(1);
  const average = (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  $(`minmax${canId}`).textContent = `${min} / ${max}°C`;
  $(`avg${canId}`).textContent = `${average}°C`;
  $(`reach${canId}`).textContent = state.reachedEightAt[canId] === null ? "Not reached" : formatSimulatedMinutes(state.reachedEightAt[canId]);
}

function renderTable() {
  const rows = [...state.readings].reverse().slice(0, 10);
  $("rowCount").textContent = `${state.readings.length} readings`;
  $("readingsBody").innerHTML = rows.length ? rows.map((reading) => `
    <tr><td>${new Date(reading.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</td>
    <td class="table-can">Can ${reading.canId} · ${CAN_CONFIG[reading.canId].shortName}</td>
    <td>${reading.temperatureC.toFixed(1)}°C</td>
    <td><span class="table-status ${statusClass(reading.status)}">${reading.status}</span></td></tr>`).join("") : "<tr><td colspan=\"4\" class=\"empty-state\">No readings in this batch.</td></tr>";
}

function renderAlerts() {
  $("alertCount").textContent = `${state.alerts.length} events`;
  $("alertsList").innerHTML = state.alerts.length ? state.alerts.map((alert) => `
    <div class="alert-item ${statusClass(alert.status)}"><i></i><p class="alert-message">${alert.message}</p><time class="alert-time">${new Date(alert.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</time></div>`).join("") : "<div class=\"empty-state\">Status changes will appear here.</div>";
}

function renderChart() {
  const labels = [...new Set(state.readings.map((reading) => reading.recordedAt))].map((timestamp) => new Date(timestamp).toLocaleTimeString([], { minute: "2-digit", second: "2-digit", hour12: false }));
  const getValues = (canId) => state.readings.filter((reading) => reading.canId === canId).map((reading) => reading.temperatureC);
  state.chart.data.labels = labels;
  state.chart.data.datasets[0].data = getValues(1);
  state.chart.data.datasets[1].data = getValues(2);
  state.chart.data.datasets[2].data = labels.map(() => 8);
  state.chart.update("none");
}

function render() {
  $("batchNumber").textContent = String(state.batchNumber).padStart(3, "0");
  $("tickCount").textContent = String(state.tick).padStart(3, "0");
  [1, 2].forEach((canId) => { updateKpi(canId); updateStats(canId); });
  renderTable();
  renderAlerts();
  renderChart();
}

function createChart() {
  const bandPlugin = {
    id: "safeBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const top = scales.y.getPixelForValue(8);
      const bottom = scales.y.getPixelForValue(4);
      ctx.save(); ctx.fillStyle = "rgba(46, 139, 87, .10)"; ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top); ctx.restore();
    }
  };
  state.chart = new Chart($("temperatureChart"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Hybrid can", data: [], borderColor: "#E76F00", backgroundColor: "#E76F00", borderWidth: 2.5, pointRadius: 0, tension: .25 },
      { label: "Ordinary can", data: [], borderColor: "#2F6DB5", backgroundColor: "#2F6DB5", borderWidth: 2.5, pointRadius: 0, tension: .25 },
      { label: "Safe threshold (8°C)", data: [], borderColor: "#C0392B", borderWidth: 1.5, borderDash: [6, 5], pointRadius: 0, fill: false }
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { font: { family: "Times New Roman" }, usePointStyle: true, padding: 18 } }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${Number(context.raw).toFixed(1)}°C` } } }, scales: { x: { title: { display: true, text: "Time", font: { family: "Times New Roman", weight: "bold" } }, grid: { display: false } }, y: { min: 0, max: 38, title: { display: true, text: "Milk temperature (C)", font: { family: "Times New Roman", weight: "bold" } }, ticks: { callback: (value) => `${value}°` } } } },
    plugins: [bandPlugin]
  });
}

function clearDashboard() {
  state.readings = [];
  state.alerts = [];
  state.previousStatus = { 1: null, 2: null };
  state.lastTemperature = { 1: null, 2: null };
  [1, 2].forEach((canId) => {
    $(`temp${canId}`).textContent = "--.-";
    $(`status${canId}`).textContent = "WAITING";
    $(`status${canId}`).className = "status-badge";
    $(`duration${canId}`).textContent = "0 sec";
    $(`trend${canId}`).textContent = "→";
    $(`trend${canId}`).className = "trend";
    $(`meter${canId}`).style.width = "4%";
    $(`meter${canId}`).style.background = "var(--muted)";
    $(`minmax${canId}`).textContent = "--.- / --.-°C";
    $(`avg${canId}`).textContent = "--.-°C";
    $(`reach${canId}`).textContent = "Calculating";
  });
  state.chart.data.labels = [];
  state.chart.data.datasets.forEach((dataset) => { dataset.data = []; });
  state.chart.update("none");
  renderTable(); renderAlerts();
}

function exportCsv() {
  const header = "recordedAt,canId,canName,temperatureC,status";
  const rows = state.readings.map((reading) => [reading.recordedAt, reading.canId, CAN_CONFIG[reading.canId].name, reading.temperatureC.toFixed(1), reading.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `milkcan-batch-${String(state.batchNumber).padStart(3, "0")}.csv`; link.click(); URL.revokeObjectURL(url);
}

$("speedSelect").addEventListener("change", (event) => { state.speed = Number(event.target.value); });
$("pauseBtn").addEventListener("click", () => { state.paused = !state.paused; $("pauseBtn").innerHTML = state.paused ? "<span>▶</span> Resume" : "<span>Ⅱ</span> Pause"; });
$("newBatchBtn").addEventListener("click", () => startNewBatch(true));
$("clearBtn").addEventListener("click", clearDashboard);
$("exportBtn").addEventListener("click", exportCsv);
$("themeToggle").addEventListener("click", () => document.body.classList.toggle("dark"));
setInterval(() => { $("liveClock").textContent = formatClock(); }, 1000);

createChart();
startNewBatch(false);
setInterval(runTick, 2000);
