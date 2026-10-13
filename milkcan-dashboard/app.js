const CANS = {
  1: { name: 'Hybrid can (PCM + evaporative sleeve)', start: 35, target: 5, k: 0.03 },
  2: { name: 'Ordinary can', start: 35, target: 31, k: 0.004 }
};

const TICK_MS_REAL = 2000;
const MAX_READINGS = 120;
const BATCH_TICKS = 180;

const state = {
  speed: 1,
  tick: 0,
  paused: false,
  darkMode: false,
  timerId: null,
  readings: [],
  chartLabels: [],
  chartData: { 1: [], 2: [] },
  batchStartMs: Date.now(),
  simulatedMs: Date.now(),
  aboveSinceMs: { 1: null, 2: null },
  status: { 1: 'COOLING', 2: 'COOLING' },
  prevTemp: { 1: null, 2: null },
  firstSafeAtMs: { 1: null, 2: null },
  alerts: []
};

const el = {
  liveClock: document.getElementById('liveClock'),
  speedSelect: document.getElementById('speedSelect'),
  themeToggle: document.getElementById('themeToggle'),
  pauseBtn: document.getElementById('pauseBtn'),
  newBatchBtn: document.getElementById('newBatchBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearBtn: document.getElementById('clearBtn'),
  readingsBody: document.getElementById('readingsBody'),
  alertsList: document.getElementById('alertsList'),
  statsGrid: document.getElementById('statsGrid')
};

const chartBandPlugin = {
  id: 'chartBandPlugin',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const y1 = scales.y.getPixelForValue(8);
    const y2 = scales.y.getPixelForValue(4);
    ctx.save();
    ctx.fillStyle = 'rgba(46, 139, 87, 0.12)';
    ctx.fillRect(chartArea.left, y1, chartArea.right - chartArea.left, y2 - y1);
    ctx.restore();
  }
};

let tempChart;

function randomNoise() {
  return (Math.random() * 0.2) - 0.1;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function readingFor(canId) {
  const can = CANS[canId];
  const base = can.target + (can.start - can.target) * Math.exp(-can.k * state.tick);
  return round1(base + randomNoise());
}

function formatClock() {
  return new Date().toLocaleTimeString();
}

function formatShortTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function statusFor(canId, temp) {
  if (temp <= 8) {
    state.aboveSinceMs[canId] = null;
    return 'SAFE';
  }

  if (state.aboveSinceMs[canId] === null) {
    state.aboveSinceMs[canId] = state.simulatedMs;
  }

  const aboveMs = state.simulatedMs - state.aboveSinceMs[canId];
  return aboveMs > 10 * 60 * 1000 ? 'ALERT' : 'COOLING';
}

function statusClass(status) {
  if (status === 'SAFE') return 'safe';
  if (status === 'ALERT') return 'alert';
  return 'cooling';
}

function trendArrow(canId, temp) {
  const prev = state.prevTemp[canId];
  state.prevTemp[canId] = temp;
  if (prev === null) return '→';
  if (temp < prev) return '↓';
  if (temp > prev) return '↑';
  return '→';
}

function pushAlert(message) {
  state.alerts.unshift(message);
  state.alerts = state.alerts.slice(0, 50);
}

function updateCanUI(canId, temp, status, aboveMs, trend) {
  document.getElementById(`can${canId}Temp`).textContent = `${temp.toFixed(1)} °C`;
  const badge = document.getElementById(`can${canId}Status`);
  badge.textContent = status;
  badge.className = `badge ${statusClass(status)}`;
  document.getElementById(`can${canId}Above`).textContent = `Above 8°C: ${formatDuration(aboveMs)}`;
  document.getElementById(`can${canId}Trend`).textContent = trend;
}

function updateStats() {
  el.statsGrid.innerHTML = '';
  [1, 2].forEach((canId) => {
    const values = state.readings.filter((r) => r.canId === canId).map((r) => r.temperatureC);
    const min = values.length ? Math.min(...values).toFixed(1) : '--';
    const max = values.length ? Math.max(...values).toFixed(1) : '--';
    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '--';
    const safeAt = state.firstSafeAtMs[canId];
    const minToSafe = safeAt ? (((safeAt - state.batchStartMs) / 60000).toFixed(1)) : 'Not reached';

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h2>${CANS[canId].name}</h2>
      <div class="stat-list">
        <div>Minimum: <strong>${min} °C</strong></div>
        <div>Maximum: <strong>${max} °C</strong></div>
        <div>Average: <strong>${avg} °C</strong></div>
        <div>Minutes to reach 8 °C: <strong>${minToSafe}</strong></div>
      </div>
    `;
    el.statsGrid.appendChild(card);
  });
}

function updateTable() {
  const last10 = state.readings.slice(-10).reverse();
  el.readingsBody.innerHTML = '';
  last10.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(row.recordedAt).toLocaleTimeString()}</td>
      <td>${CANS[row.canId].name}</td>
      <td>${row.temperatureC.toFixed(1)}</td>
      <td><span class="badge ${statusClass(row.status)}">${row.status}</span></td>
    `;
    el.readingsBody.appendChild(tr);
  });
}

function updateAlerts() {
  el.alertsList.innerHTML = '';
  state.alerts.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = entry;
    el.alertsList.appendChild(li);
  });
}

function restartBatch() {
  state.tick = 0;
  state.readings = [];
  state.chartLabels = [];
  state.chartData = { 1: [], 2: [] };
  state.batchStartMs = Date.now();
  state.simulatedMs = state.batchStartMs;
  state.aboveSinceMs = { 1: null, 2: null };
  state.firstSafeAtMs = { 1: null, 2: null };
  state.prevTemp = { 1: null, 2: null };
  tempChart.data.labels = [];
  tempChart.data.datasets[0].data = [];
  tempChart.data.datasets[1].data = [];
  tempChart.data.datasets[2].data = [];
  tempChart.update();
  updateTable();
  updateStats();
}

function addTick() {
  state.tick += 1;
  state.simulatedMs += TICK_MS_REAL * state.speed;

  [1, 2].forEach((canId) => {
    const temp = readingFor(canId);
    const status = statusFor(canId, temp);

    if (temp <= 8 && !state.firstSafeAtMs[canId]) {
      state.firstSafeAtMs[canId] = state.simulatedMs;
    }

    const aboveMs = temp > 8 && state.aboveSinceMs[canId] ? state.simulatedMs - state.aboveSinceMs[canId] : 0;
    const trend = trendArrow(canId, temp);

    if (state.status[canId] !== status) {
      pushAlert(`${formatShortTime(state.simulatedMs)} - ${CANS[canId].name} changed from ${state.status[canId]} to ${status}`);
      state.status[canId] = status;
    }

    const reading = {
      canId,
      temperatureC: temp,
      status,
      recordedAt: new Date(state.simulatedMs).toISOString()
    };

    state.readings.push(reading);
    state.chartData[canId].push(temp);
    updateCanUI(canId, temp, status, aboveMs, trend);
  });

  while (state.readings.length > MAX_READINGS) {
    state.readings.shift();
  }

  const label = new Date(state.simulatedMs).toLocaleTimeString();
  state.chartLabels.push(label);
  if (state.chartLabels.length > 120) {
    state.chartLabels.shift();
  }
  [1, 2].forEach((canId) => {
    while (state.chartData[canId].length > 120) {
      state.chartData[canId].shift();
    }
  });

  tempChart.data.labels = state.chartLabels;
  tempChart.data.datasets[0].data = state.chartData[1];
  tempChart.data.datasets[1].data = state.chartData[2];
  tempChart.data.datasets[2].data = new Array(state.chartLabels.length).fill(8);
  tempChart.update();

  updateStats();
  updateTable();
  updateAlerts();

  if (state.tick >= BATCH_TICKS) {
    restartBatch();
  }
}

function setupChart() {
  const ctx = document.getElementById('tempChart');
  tempChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: CANS[1].name,
          data: [],
          borderColor: '#2F6DB5',
          backgroundColor: 'rgba(47,109,181,0.2)',
          borderWidth: 2,
          tension: 0.25
        },
        {
          label: CANS[2].name,
          data: [],
          borderColor: '#E76F00',
          backgroundColor: 'rgba(231,111,0,0.2)',
          borderWidth: 2,
          tension: 0.25
        },
        {
          label: 'Safety limit (8°C)',
          data: [],
          borderColor: '#C0392B',
          borderDash: [7, 5],
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          title: { display: true, text: 'Time' }
        },
        y: {
          title: { display: true, text: 'Milk temperature (C)' },
          suggestedMin: 0,
          suggestedMax: 40
        }
      }
    },
    plugins: [chartBandPlugin]
  });
}

function togglePause() {
  state.paused = !state.paused;
  el.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
}

function exportCsv() {
  const header = 'recordedAt,canId,canName,temperatureC,status\n';
  const rows = state.readings.map((r) => `${r.recordedAt},${r.canId},"${CANS[r.canId].name}",${r.temperatureC.toFixed(1)},${r.status}`).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'milkcan-readings.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function clearAll() {
  state.alerts = [];
  updateAlerts();
  restartBatch();
}

function bindEvents() {
  el.speedSelect.addEventListener('change', (event) => {
    state.speed = Number(event.target.value);
  });

  el.pauseBtn.addEventListener('click', togglePause);
  el.newBatchBtn.addEventListener('click', restartBatch);
  el.exportBtn.addEventListener('click', exportCsv);
  el.clearBtn.addEventListener('click', clearAll);

  el.themeToggle.addEventListener('click', () => {
    state.darkMode = !state.darkMode;
    document.body.classList.toggle('dark', state.darkMode);
    el.themeToggle.textContent = state.darkMode ? 'Light mode' : 'Dark mode';
  });
}

function start() {
  setupChart();
  bindEvents();
  updateStats();
  state.timerId = setInterval(() => {
    if (!state.paused) {
      addTick();
    }
  }, TICK_MS_REAL);

  setInterval(() => {
    el.liveClock.textContent = formatClock();
  }, 1000);
  el.liveClock.textContent = formatClock();

  addTick();
}

start();
