// MyVMK Snowball Dashboard - Frontend

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function fmt(n, decimals = 2) {
  if (n == null) return "";
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return String(n);
    const fixed = n.toFixed(decimals);
    return fixed.replace(/\.?0+$/, "") || "0";
  }
  return String(n);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Team colors for charts
const TEAM_COLORS = {
  Penguin: { bg: "rgba(59, 130, 246, 0.7)", border: "#3b82f6" },
  Reindeer: { bg: "rgba(239, 68, 68, 0.7)", border: "#ef4444" },
  Unknown: { bg: "rgba(156, 163, 175, 0.5)", border: "#9ca3af" }
};

const TREND_COLORS = {
  overall: { border: "#111827", dash: [5, 5] },
  penguin: { border: "#1d4ed8", dash: [3, 3] },
  reindeer: { border: "#b91c1c", dash: [3, 3] }
};

// Application state
const state = {
  allUsers: [],
  usersIndex: new Map(),
  viewRows: [],
  query: "",
  teamFilter: "All",
  sortKey: "attacks",
  sortDir: "desc",
  highlight: null,
  scatterChart: null,
  roomsChart: null
};

function renderTeamStats(summary) {
  const container = document.getElementById("teamStats");
  const ts = summary.teamStats || {};

  const items = [
    { team: "penguin", label: "Penguin", data: ts.Penguin || {} },
    { team: "reindeer", label: "Reindeer", data: ts.Reindeer || {} },
    { team: "unknown", label: "Unknown", data: ts.Unknown || {} }
  ];

  container.innerHTML = items.map(item => `
    <div class="team-stat ${item.team}">
      <div class="label">${item.label}</div>
      <div class="value">${item.data.users || 0}</div>
      <div class="label">${fmt(item.data.attacks || 0, 0)} atk</div>
    </div>
  `).join("");
}

function renderTopLists(summary) {
  const container = document.getElementById("topLists");

  const attackersHtml = `
    <div>
      <h4 style="margin:0 0 8px 0;font-size:0.875rem;">Top Attackers</h4>
      <table>
        <tr><th>User</th><th>Team</th><th>Attacks</th></tr>
        ${(summary.topAttackers || []).slice(0, 10).map(u => `
          <tr>
            <td>${escapeHtml(u.user)}</td>
            <td><span class="pill ${(u.team || "unknown").toLowerCase()}">${u.team || "?"}</span></td>
            <td>${u.attacks}</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;

  const victimsHtml = `
    <div>
      <h4 style="margin:0 0 8px 0;font-size:0.875rem;">Top Victims</h4>
      <table>
        <tr><th>User</th><th>Team</th><th>Hits Taken</th></tr>
        ${(summary.topVictims || []).slice(0, 10).map(u => `
          <tr>
            <td>${escapeHtml(u.user)}</td>
            <td><span class="pill ${(u.team || "unknown").toLowerCase()}">${u.team || "?"}</span></td>
            <td>${u.hitsTaken}</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;

  container.innerHTML = attackersHtml + victimsHtml;
}

function applyFilterSort() {
  const q = state.query.trim().toLowerCase();
  const teamFilter = state.teamFilter;

  let rows = state.allUsers;

  // Filter by search query (substring match)
  if (q) {
    rows = rows.filter(r => r.user.toLowerCase().includes(q));
  }

  // Filter by team
  if (teamFilter !== "All") {
    rows = rows.filter(r => r.team === teamFilter);
  }

  // Sort
  const dir = state.sortDir === "asc" ? 1 : -1;
  const key = state.sortKey;

  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  state.viewRows = rows;
}

function buildUsersTable() {
  const el = document.getElementById("usersTable");
  const { viewRows, sortKey, sortDir } = state;

  const headers = [
    { key: "user", label: "User" },
    { key: "team", label: "Team" },
    { key: "attacks", label: "Attacks" },
    { key: "hitsTaken", label: "Hits Taken" },
    { key: "ratio", label: "Ratio" },
    { key: "teamConfidence", label: "Confidence" }
  ];

  const head = `<tr>${headers.map(h => {
    const arrow = (h.key === sortKey) ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${h.key}">${h.label}${arrow}</th>`;
  }).join("")}</tr>`;

  const body = viewRows.map(r => {
    const teamClass = (r.team || "unknown").toLowerCase();
    const confPct = Math.round((r.teamConfidence || 0) * 100);
    const confBar = `<span class="confidence-bar"><span class="fill" style="width:${confPct}%"></span></span>${confPct}%`;

    return `
      <tr data-user="${escapeHtml(r.user)}" class="${state.highlight === r.user ? 'highlight' : ''}">
        <td>${escapeHtml(r.user)}</td>
        <td><span class="pill ${teamClass}">${r.team || "Unknown"}</span></td>
        <td>${r.attacks}</td>
        <td>${r.hitsTaken}</td>
        <td>${fmt(r.ratio)}</td>
        <td>${confBar}</td>
      </tr>
    `;
  }).join("");

  el.innerHTML = head + body;

  // Update count
  document.getElementById("userCount").textContent = `(${viewRows.length} shown)`;

  // Sort click handlers
  el.querySelectorAll("th[data-key]").forEach(th => {
    th.onclick = () => {
      const key = th.getAttribute("data-key");
      if (state.sortKey === key) {
        state.sortDir = (state.sortDir === "asc" ? "desc" : "asc");
      } else {
        state.sortKey = key;
        state.sortDir = "desc";
      }
      // Update dropdown
      document.getElementById("sortSelect").value = `${state.sortKey}-${state.sortDir}`;
      applyFilterSort();
      buildUsersTable();
    };
  });

  // Row click to highlight
  el.querySelectorAll("tr[data-user]").forEach(tr => {
    tr.onclick = () => {
      const user = tr.getAttribute("data-user");
      if (state.highlight === user) {
        state.highlight = null;
      } else {
        state.highlight = user;
      }
      updateHighlight();
      if (state.scatterChart) state.scatterChart.update();
    };
  });
}

function updateHighlight() {
  const panel = document.getElementById("statsPanel");
  const nameEl = document.getElementById("statsPanelUser");
  const gridEl = document.getElementById("statsPanelGrid");

  // Update table row highlights
  document.querySelectorAll("tr.highlight").forEach(tr => tr.classList.remove("highlight"));

  if (!state.highlight) {
    panel.classList.remove("visible");
    return;
  }

  const u = state.usersIndex.get(state.highlight);
  if (!u) {
    panel.classList.remove("visible");
    return;
  }

  // Show stats panel
  panel.classList.add("visible");
  const teamClass = (u.team || "unknown").toLowerCase();
  nameEl.innerHTML = `${escapeHtml(u.user)} <span class="pill ${teamClass}">${u.team || "Unknown"}</span>`;

  gridEl.innerHTML = `
    <div class="stat-item">
      <div class="stat-label">Attacks</div>
      <div class="stat-value">${u.attacks}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Hits Taken</div>
      <div class="stat-value">${u.hitsTaken}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Ratio</div>
      <div class="stat-value">${fmt(u.ratio)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Team Confidence</div>
      <div class="stat-value">${Math.round((u.teamConfidence || 0) * 100)}%</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Team Source</div>
      <div class="stat-value">${u.teamSource || "unknown"}</div>
    </div>
  `;

  // Highlight row in table
  const row = document.querySelector(`tr[data-user="${CSS.escape(u.user)}"]`);
  if (row) row.classList.add("highlight");
}

function computeLineDataset(regLine, color, dash) {
  if (!regLine) return null;
  const { xMin, xMax, y1, y2, label } = regLine;
  return {
    type: "line",
    label: `Trend (${label || "All"})`,
    data: [{ x: xMin, y: Math.max(0, y1) }, { x: xMax, y: Math.max(0, y2) }],
    parsing: false,
    pointRadius: 0,
    borderWidth: 2,
    borderColor: color.border,
    borderDash: color.dash || [],
    tension: 0
  };
}

function createScatter(ctx, summary) {
  const pts = summary.scatterPoints || [];

  const byTeam = {
    Penguin: pts.filter(p => p.team === "Penguin"),
    Reindeer: pts.filter(p => p.team === "Reindeer"),
    Unknown: pts.filter(p => p.team === "Unknown")
  };

  const datasets = [
    {
      label: "Penguin",
      data: byTeam.Penguin.map(p => ({ x: p.attacks, y: p.hitsTaken, user: p.user })),
      parsing: false,
      backgroundColor: TEAM_COLORS.Penguin.bg,
      borderColor: TEAM_COLORS.Penguin.border,
      pointRadius: (ctx) => state.highlight && ctx.raw?.user === state.highlight ? 10 : 5,
      pointHoverRadius: 8
    },
    {
      label: "Reindeer",
      data: byTeam.Reindeer.map(p => ({ x: p.attacks, y: p.hitsTaken, user: p.user })),
      parsing: false,
      backgroundColor: TEAM_COLORS.Reindeer.bg,
      borderColor: TEAM_COLORS.Reindeer.border,
      pointRadius: (ctx) => state.highlight && ctx.raw?.user === state.highlight ? 10 : 5,
      pointHoverRadius: 8
    },
    {
      label: "Unknown",
      data: byTeam.Unknown.map(p => ({ x: p.attacks, y: p.hitsTaken, user: p.user })),
      parsing: false,
      backgroundColor: TEAM_COLORS.Unknown.bg,
      borderColor: TEAM_COLORS.Unknown.border,
      pointRadius: (ctx) => state.highlight && ctx.raw?.user === state.highlight ? 10 : 4,
      pointHoverRadius: 7
    }
  ];

  // Add trend lines
  const reg = summary.regression || {};
  const overallLine = computeLineDataset(reg.overall, TREND_COLORS.overall);
  const pengLine = computeLineDataset(reg.penguin, TREND_COLORS.penguin);
  const reinLine = computeLineDataset(reg.reindeer, TREND_COLORS.reindeer);

  if (overallLine) datasets.push(overallLine);
  if (pengLine) datasets.push(pengLine);
  if (reinLine) datasets.push(reinLine);

  state.scatterChart = new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (item) => {
              const raw = item.raw;
              if (!raw?.user) return item.dataset.label || "";
              const u = state.usersIndex.get(raw.user);
              if (!u) return raw.user;
              return `${u.user} (${u.team}) — attacks=${u.attacks}, taken=${u.hitsTaken}, ratio=${fmt(u.ratio)}`;
            }
          }
        },
        legend: { position: "bottom" }
      },
      scales: {
        x: {
          title: { display: true, text: "Attacks Made" },
          beginAtZero: true
        },
        y: {
          title: { display: true, text: "Hits Taken" },
          beginAtZero: true
        }
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const el = elements[0];
          const datasetIndex = el.datasetIndex;
          const index = el.index;
          const point = state.scatterChart.data.datasets[datasetIndex].data[index];
          if (point?.user) {
            if (state.highlight === point.user) {
              state.highlight = null;
            } else {
              state.highlight = point.user;
            }
            updateHighlight();
            buildUsersTable();
            state.scatterChart.update();
          }
        }
      }
    }
  });

  return state.scatterChart;
}

function createRoomsChart(ctx, roomsSummary) {
  const top = (roomsSummary || []).slice(0, 20);

  state.roomsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map(r => r.roomName),
      datasets: [
        {
          label: "Total Hits",
          data: top.map(r => r.hitCount),
          backgroundColor: "rgba(59, 130, 246, 0.7)",
          borderColor: "#3b82f6",
          borderWidth: 1,
          yAxisID: "y",
          order: 2
        },
        {
          label: "Avg User Ratio",
          data: top.map(r => r.avgUserRatio),
          type: "line",
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.2)",
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#f59e0b",
          yAxisID: "y1",
          order: 1,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === "Avg User Ratio") {
                return `Avg User Ratio: ${fmt(ctx.raw)}`;
              }
              return `Total Hits: ${ctx.raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 60,
            minRotation: 45,
            font: { size: 10 }
          }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: { display: true, text: "Total Hits" },
          beginAtZero: true
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          title: { display: true, text: "Avg User Ratio" },
          beginAtZero: true,
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  return state.roomsChart;
}

function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById("userSearch");
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value || "";
    applyFilterSort();
    buildUsersTable();

    // Exact match highlighting
    const exact = state.query.trim();
    if (state.usersIndex.has(exact)) {
      state.highlight = exact;
    } else {
      state.highlight = null;
    }
    updateHighlight();
    if (state.scatterChart) state.scatterChart.update();
  });

  // Team filter
  const teamFilter = document.getElementById("teamFilter");
  teamFilter.addEventListener("change", () => {
    state.teamFilter = teamFilter.value;
    applyFilterSort();
    buildUsersTable();
  });

  // Sort dropdown
  const sortSelect = document.getElementById("sortSelect");
  sortSelect.addEventListener("change", () => {
    const [key, dir] = sortSelect.value.split("-");
    state.sortKey = key;
    state.sortDir = dir;
    applyFilterSort();
    buildUsersTable();
  });
}

(async function main() {
  try {
    const [summary, users, roomsSummary] = await Promise.all([
      loadJSON("./data/summary.json"),
      loadJSON("./data/users.json"),
      loadJSON("./data/rooms_summary.json")
    ]);

    // Update metadata
    document.getElementById("meta").textContent =
      `Last updated: ${new Date(summary.generatedAt).toLocaleString()} | ` +
      `${summary.totalRows?.toLocaleString() || 0} events | ` +
      `${summary.totalUsers?.toLocaleString() || 0} users | ` +
      `${summary.conflictCount || 0} conflicts`;

    // Initialize state
    state.allUsers = users;
    state.usersIndex = new Map(users.map(u => [u.user, u]));

    // Render components
    renderTeamStats(summary);
    renderTopLists(summary);

    // Apply initial filter/sort
    applyFilterSort();
    buildUsersTable();

    // Create charts
    createScatter(document.getElementById("scatter"), summary);
    createRoomsChart(document.getElementById("roomsChart"), roomsSummary);

    // Setup event listeners
    setupEventListeners();

  } catch (err) {
    console.error(err);
    document.getElementById("meta").textContent = `Error: ${err.message}`;
  }
})();
