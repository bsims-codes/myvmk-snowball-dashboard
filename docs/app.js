// MyVMK Snowball Dashboard - Frontend

// Dark mode initialization (runs immediately)
(function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved === "dark" || (!saved && prefersDark)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  if (isDark) {
    html.removeAttribute("data-theme");
    localStorage.setItem("theme", "light");
  } else {
    html.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");
  }
  updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
  const btn = document.getElementById("themeToggle");
  if (btn) {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    btn.textContent = isDark ? "☀️" : "🌙";
  }
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/**
 * Fetch total team member counts from the snow teams API
 * Returns { Penguin: number, Reindeer: number }
 */
async function fetchTeamTotals() {
  try {
    const res = await fetch("https://www.myvmk.com/api/getsnowteams", { cache: "no-store" });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.trim().split("\n").slice(1); // Skip header row

    let penguin = 0;
    let reindeer = 0;

    for (const line of lines) {
      const [, team] = line.split(",");
      if (team === "1") penguin++;
      else if (team === "0") reindeer++;
    }

    return { Penguin: penguin, Reindeer: reindeer };
  } catch (err) {
    console.warn("Failed to fetch team totals:", err);
    return null;
  }
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

function parseSearchNames(input) {
  if (!input) return [];
  return input.split(",").map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase());
}

/**
 * Initialize a combo box with autocomplete for user search
 * @param {string} inputId - The input element ID
 * @param {string} dropdownId - The dropdown element ID
 * @param {object} options - Configuration options
 *   - onSelect: callback when a user is selected (receives user object)
 *   - onInput: callback on input change (receives raw input value)
 *   - multiSelect: if true, supports comma-separated users
 */
function initComboBox(inputId, dropdownId, options = {}) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let highlightedIndex = -1;
  let currentResults = [];

  function getSearchTerm() {
    const value = input.value;
    if (options.multiSelect) {
      // Get the last term after the last comma
      const parts = value.split(",");
      return parts[parts.length - 1].trim().toLowerCase();
    }
    return value.trim().toLowerCase();
  }

  function filterUsers(term) {
    if (!term) return [];
    return state.allUsers
      .filter(u => u.user.toLowerCase().includes(term))
      .slice(0, 10); // Limit to 10 results
  }

  function renderDropdown(results, searchTerm) {
    currentResults = results;
    highlightedIndex = -1;

    if (!searchTerm) {
      dropdown.classList.remove("visible");
      dropdown.innerHTML = "";
      return;
    }

    if (results.length === 0) {
      dropdown.innerHTML = `<div class="combo-no-results">No user matching "${escapeHtml(searchTerm)}"</div>`;
      dropdown.classList.add("visible");
      return;
    }

    dropdown.innerHTML = results.map((user, idx) => {
      const teamClass = user.team.toLowerCase();
      return `<div class="combo-option" data-index="${idx}" data-user="${escapeHtml(user.user)}">
        <span>${escapeHtml(user.user)}</span>
        <span class="pill ${teamClass}">${user.team}</span>
      </div>`;
    }).join("");

    dropdown.classList.add("visible");
  }

  function selectUser(user) {
    if (options.multiSelect) {
      // Replace the last term with the selected user
      const parts = input.value.split(",");
      parts[parts.length - 1] = " " + user.user;
      input.value = parts.join(",").replace(/^,\s*/, "").trim();
    } else {
      input.value = user.user;
    }

    dropdown.classList.remove("visible");
    dropdown.innerHTML = "";

    if (options.onSelect) {
      options.onSelect(user);
    }

    // Trigger input event for existing handlers
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function updateHighlight() {
    dropdown.querySelectorAll(".combo-option").forEach((opt, idx) => {
      opt.classList.toggle("highlighted", idx === highlightedIndex);
    });

    // Scroll highlighted item into view
    const highlighted = dropdown.querySelector(".combo-option.highlighted");
    if (highlighted) {
      highlighted.scrollIntoView({ block: "nearest" });
    }
  }

  // Input event - filter and show dropdown
  input.addEventListener("input", () => {
    const term = getSearchTerm();
    const results = filterUsers(term);
    renderDropdown(results, term);

    if (options.onInput) {
      options.onInput(input.value);
    }
  });

  // Focus event - show dropdown if there's text
  input.addEventListener("focus", () => {
    const term = getSearchTerm();
    if (term) {
      const results = filterUsers(term);
      renderDropdown(results, term);
    }
  });

  // Keyboard navigation
  input.addEventListener("keydown", (e) => {
    if (!dropdown.classList.contains("visible")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, currentResults.length - 1);
      updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, -1);
      updateHighlight();
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < currentResults.length) {
        e.preventDefault();
        selectUser(currentResults[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      dropdown.classList.remove("visible");
      highlightedIndex = -1;
    }
  });

  // Click on dropdown option
  dropdown.addEventListener("click", (e) => {
    const option = e.target.closest(".combo-option");
    if (option) {
      const idx = parseInt(option.dataset.index, 10);
      if (currentResults[idx]) {
        selectUser(currentResults[idx]);
      }
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove("visible");
      highlightedIndex = -1;
    }
  });
}

// Team colors for charts
const TEAM_COLORS = {
  Penguin: { bg: "rgba(59, 130, 246, 0.7)", border: "#3b82f6" },
  Reindeer: { bg: "rgba(239, 68, 68, 0.7)", border: "#ef4444" }
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
  searchNames: [],
  filterExpr: "",
  teamFilter: "All",
  sortKey: "attacks",
  sortDir: "desc",
  selectedUsers: new Set(),
  scatterChart: null,
  scatterBasePoints: [],
  roomsChart: null,
  dailyChart: null,
  // Events table state
  allEvents: [],
  filteredEvents: [],
  eventsSearch: "",
  eventsTeamFilter: "All",
  eventsRoomFilter: "All",
  eventsDateFrom: "",
  eventsDateTo: "",
  eventsSort: "time-desc",
  allRooms: [],
  // Victim breakdown state
  victimBreakdown: [],
  victimSearch: "",
  victimTeamFilter: "All",
  // Data mode: "live" or "pre-reset"
  dataMode: "live"
};

/**
 * Get the data path based on current data mode
 */
function getDataPath() {
  return state.dataMode === "pre-reset" ? "./data/archive/pre-reset" : "./data";
}

/**
 * Update data mode toggle UI
 */
function updateDataModeUI() {
  const liveBtn = document.getElementById("dataModeLive");
  const preResetBtn = document.getElementById("dataModePreReset");

  if (liveBtn && preResetBtn) {
    liveBtn.classList.toggle("active", state.dataMode === "live");
    preResetBtn.classList.toggle("active", state.dataMode === "pre-reset");
  }
}

/**
 * Load all data and refresh the entire dashboard
 */
async function loadAndRefreshData() {
  const basePath = getDataPath();

  try {
    document.getElementById("meta").textContent = "Loading data...";

    // Load data files and fetch team totals in parallel
    const [summary, users, roomsSummary, events, teamTotals] = await Promise.all([
      loadJSON(`${basePath}/summary.json`),
      loadJSON(`${basePath}/users.json`),
      loadJSON(`${basePath}/rooms_summary.json`),
      loadJSON(`${basePath}/events.json`),
      // Only fetch live team totals for live mode (pre-reset teams no longer exist in API)
      state.dataMode === "live" ? fetchTeamTotals() : Promise.resolve(null)
    ]);

    // Update metadata with data mode indicator
    const modeLabel = state.dataMode === "pre-reset" ? " [PRE-RESET]" : "";
    document.getElementById("meta").textContent =
      `Last updated: ${new Date(summary.generatedAt).toLocaleString()}${modeLabel} | ` +
      `${summary.totalRows?.toLocaleString() || 0} events | ` +
      `${summary.totalUsers?.toLocaleString() || 0} users`;

    // Update state
    state.allUsers = users;
    state.usersIndex = new Map(users.map(u => [u.user, u]));
    state.allEvents = events;
    state.victimBreakdown = buildVictimBreakdown(events);

    // Render components (pass team totals for accurate member counts)
    renderTeamStats(summary, teamTotals);
    renderTopLists(summary);

    // Apply initial filter/sort
    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();

    // Destroy existing charts before recreating
    if (state.scatterChart) {
      state.scatterChart.destroy();
      state.scatterChart = null;
    }
    if (state.roomsChart) {
      state.roomsChart.destroy();
      state.roomsChart = null;
    }
    if (state.dailyChart) {
      state.dailyChart.destroy();
      state.dailyChart = null;
    }

    // Create charts
    createScatter(document.getElementById("scatter"), summary);
    createRoomsChart(document.getElementById("roomsChart"), roomsSummary);
    createDailyChart(document.getElementById("dailyChart"), events);

    // Render tables
    renderVictimBreakdownTable();
    populateRoomFilter();
    renderEventsTable();

    // Render heatmap
    renderHeatmap();

  } catch (err) {
    console.error(err);
    document.getElementById("meta").textContent = `Error loading data: ${err.message}`;
  }
}

/**
 * Switch data mode and reload
 */
async function switchDataMode(mode) {
  if (state.dataMode === mode) return;

  state.dataMode = mode;
  localStorage.setItem("dataMode", mode);
  updateDataModeUI();
  await loadAndRefreshData();
}

/**
 * Parse and evaluate filter expressions like "attacks > 100, ratio >= 2"
 * Supports: =, !=, <, <=, >, >=
 * Fields: attacks, hitsTaken, ratio, user, team
 */
function parseFilterExpr(expr) {
  if (!expr || !expr.trim()) return null;

  const conditions = expr.split(',').map(c => c.trim()).filter(c => c);
  const parsed = [];

  for (const cond of conditions) {
    // Match: field operator value
    const match = cond.match(/^(\w+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/);
    if (!match) continue;

    const [, field, op, rawValue] = match;
    const fieldLower = field.toLowerCase();

    // Map common field names
    const fieldMap = {
      'attacks': 'attacks',
      'attack': 'attacks',
      'hitstaken': 'hitsTaken',
      'hits': 'hitsTaken',
      'taken': 'hitsTaken',
      'ratio': 'ratio',
      'user': 'user',
      'username': 'user',
      'team': 'team'
    };

    const mappedField = fieldMap[fieldLower];
    if (!mappedField) continue;

    // Parse value
    let value = rawValue.trim();
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Try to parse as number
    const numValue = parseFloat(value);
    const isNumeric = !isNaN(numValue);

    parsed.push({ field: mappedField, op, value: isNumeric ? numValue : value, isNumeric });
  }

  return parsed.length > 0 ? parsed : null;
}

function evaluateFilter(row, conditions) {
  if (!conditions) return true;

  for (const { field, op, value, isNumeric } of conditions) {
    const rowValue = row[field];

    let result = false;

    if (isNumeric && typeof rowValue === 'number') {
      switch (op) {
        case '=': result = rowValue === value; break;
        case '!=': result = rowValue !== value; break;
        case '>': result = rowValue > value; break;
        case '>=': result = rowValue >= value; break;
        case '<': result = rowValue < value; break;
        case '<=': result = rowValue <= value; break;
      }
    } else {
      // String comparison (case-insensitive)
      const strRow = String(rowValue).toLowerCase();
      const strVal = String(value).toLowerCase();
      switch (op) {
        case '=': result = strRow === strVal; break;
        case '!=': result = strRow !== strVal; break;
        case '>': result = strRow > strVal; break;
        case '>=': result = strRow >= strVal; break;
        case '<': result = strRow < strVal; break;
        case '<=': result = strRow <= strVal; break;
      }
    }

    if (!result) return false; // AND logic - all conditions must pass
  }

  return true;
}

function renderTeamStats(summary, teamTotals) {
  const container = document.getElementById("teamStats");
  const ts = summary.teamStats || {};

  const items = [
    { team: "penguin", label: "Penguin", data: ts.Penguin || {} },
    { team: "reindeer", label: "Reindeer", data: ts.Reindeer || {} }
  ];

  const logoMap = {
    penguin: 'penguin.png',
    reindeer: 'reindeer.png'
  };

  container.innerHTML = items.map(item => {
    // Use API total if available, otherwise fall back to participant count
    const totalMembers = teamTotals?.[item.label] ?? item.data.users ?? 0;
    const participants = item.data.users || 0;

    return `
      <div class="team-stat ${item.team}">
        ${logoMap[item.team] ? `<img src="${logoMap[item.team]}" alt="${item.label}" class="team-logo">` : ''}
        <div class="label">${item.label}</div>
        <div class="value">${totalMembers}</div>
        <div class="label">${participants} active · ${fmt(item.data.attacks || 0, 0)} atk</div>
      </div>
    `;
  }).join("");
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
            <td><span class="pill ${u.team.toLowerCase()}">${u.team}</span></td>
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
            <td><span class="pill ${u.team.toLowerCase()}">${u.team}</span></td>
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
  const filterConditions = parseFilterExpr(state.filterExpr);
  const searchSet = state.searchNames.length ? new Set(state.searchNames.map(n => n.toLowerCase())) : null;

  let rows = state.allUsers;

  // Filter by search names (exact match, case-insensitive) if provided
  if (searchSet && searchSet.size > 0) {
    rows = rows.filter(r => searchSet.has(r.user.toLowerCase()));
  } else if (q) {
    // Fallback substring match when no explicit names
    rows = rows.filter(r => r.user.toLowerCase().includes(q));
  }

  // Filter by team dropdown
  if (teamFilter !== "All") {
    rows = rows.filter(r => r.team === teamFilter);
  }

  // Filter by expression
  if (filterConditions) {
    rows = rows.filter(r => evaluateFilter(r, filterConditions));
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
    { key: "ratio", label: "Ratio" }
  ];

  const head = `<tr>${headers.map(h => {
    const arrow = (h.key === sortKey) ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-key="${h.key}">${h.label}${arrow}</th>`;
  }).join("")}</tr>`;

  const body = viewRows.map(r => {
    const teamClass = r.team.toLowerCase();

    return `
      <tr data-user="${escapeHtml(r.user)}" class="${state.selectedUsers.has(r.user) ? 'highlight' : ''}">
        <td>${escapeHtml(r.user)}</td>
        <td><span class="pill ${teamClass}">${r.team}</span></td>
        <td>${r.attacks}</td>
        <td>${r.hitsTaken}</td>
        <td>${fmt(r.ratio)}</td>
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
      if (state.selectedUsers.has(user)) {
        state.selectedUsers.delete(user);
      } else {
        state.selectedUsers.add(user);
      }
      updateSelectionUI();
      buildUsersTable();
      updateScatterHighlights();
    };
  });
}

function updateSelectionUI() {
  const panel = document.getElementById("statsPanel");
  const nameEl = document.getElementById("statsPanelUser");
  const gridEl = document.getElementById("statsPanelGrid");

  // Update table row highlights
  document.querySelectorAll("tr.highlight").forEach(tr => tr.classList.remove("highlight"));
  state.selectedUsers.forEach(user => {
    const row = document.querySelector(`tr[data-user="${CSS.escape(user)}"]`);
    if (row) row.classList.add("highlight");
  });

  const users = Array.from(state.selectedUsers)
    .map(u => state.usersIndex.get(u))
    .filter(Boolean);

  if (!users.length) {
    panel.classList.remove("visible");
    return;
  }

  panel.classList.add("visible");
  nameEl.textContent = `Selected Users (${users.length})`;
  gridEl.innerHTML = users.map(u => {
    const teamClass = u.team.toLowerCase();
    return `
      <div class="stat-item">
        <div class="stat-label">${escapeHtml(u.user)} <span class="pill ${teamClass}">${u.team}</span></div>
        <div class="stat-value">Atk ${u.attacks} | Taken ${u.hitsTaken} | Ratio ${fmt(u.ratio)}</div>
      </div>
    `;
  }).join("");
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
  state.scatterBasePoints = pts;

  const byTeam = {
    Penguin: pts.filter(p => p.team === "Penguin"),
    Reindeer: pts.filter(p => p.team === "Reindeer")
  };

  const datasets = [
    {
      label: "Penguin",
      data: byTeam.Penguin.map(p => ({ x: p.attacks, y: p.hitsTaken, user: p.user })),
      backgroundColor: TEAM_COLORS.Penguin.bg,
      borderColor: TEAM_COLORS.Penguin.border,
      pointRadius: 5,
      pointHoverRadius: 8
    },
    {
      label: "Reindeer",
      data: byTeam.Reindeer.map(p => ({ x: p.attacks, y: p.hitsTaken, user: p.user })),
      backgroundColor: TEAM_COLORS.Reindeer.bg,
      borderColor: TEAM_COLORS.Reindeer.border,
      pointRadius: 5,
      pointHoverRadius: 8
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
        legend: { position: "bottom" },
        zoom: {
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: true },
            mode: "xy"
          },
          pan: {
            enabled: true,
            mode: "xy"
          }
        }
      },
      scales: {
        x: {
          type: "linear",
          position: "bottom",
          title: { display: true, text: "Attacks Made" },
          beginAtZero: true
        },
        y: {
          type: "linear",
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
            if (state.selectedUsers.has(point.user)) {
              state.selectedUsers.delete(point.user);
            } else {
              state.selectedUsers.add(point.user);
            }
            updateSelectionUI();
            buildUsersTable();
            updateScatterHighlights();
          }
        }
      }
    }
  });

  wireScatterControls();
  wireScatterDblClick();

  return state.scatterChart;
}

function updateScatterHighlights() {
  const chart = state.scatterChart;
  if (!chart) return;

  const datasets = chart.data.datasets;

  // Update point sizes based on selection
  for (let i = 0; i < 2 && i < datasets.length; i++) {
    const data = datasets[i].data;
    const radii = data.map(p => state.selectedUsers.has(p.user) ? 10 : 5);
    datasets[i].pointRadius = radii;
  }

  chart.update("none");
}

function wireScatterDblClick() {
  const chart = state.scatterChart;
  if (!chart?.canvas) return;

  chart.canvas.addEventListener("dblclick", (evt) => {
    const factor = evt.shiftKey ? 0.7 : 1.4;
    const point = { x: evt.offsetX, y: evt.offsetY };
    chart.zoom({ x: factor, y: factor }, point);
  });
}

function wireScatterControls() {
  const resetBtn = document.getElementById("resetScatterZoom");
  if (resetBtn) {
    resetBtn.onclick = () => {
      state.scatterChart?.resetZoom();
    };
  }
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

function createDailyChart(ctx, events) {
  if (!ctx || !events?.length) return;

  // Process events by day and team
  const dailyData = {};

  events.forEach(e => {
    const date = e.time.split(" ")[0]; // "2025-12-10"
    const team = e.attackerTeam;
    if (!team || team === "Unknown") return;

    if (!dailyData[date]) {
      dailyData[date] = {
        Penguin: { total: 0, attackers: {} },
        Reindeer: { total: 0, attackers: {} }
      };
    }

    dailyData[date][team].total++;
    const attacker = e.attacker;
    dailyData[date][team].attackers[attacker] = (dailyData[date][team].attackers[attacker] || 0) + 1;
  });

  // Sort dates and take last 7 days
  const sortedDates = Object.keys(dailyData).sort();
  const last7 = sortedDates.slice(-7);

  // Prepare chart data
  const labels = last7.map(d => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  const penguinData = last7.map(d => dailyData[d]?.Penguin?.total || 0);
  const reindeerData = last7.map(d => dailyData[d]?.Reindeer?.total || 0);

  // Store top attackers for tooltips
  const topAttackersPerDay = last7.map(d => {
    const day = dailyData[d];
    const getTop10 = (teamData) => {
      if (!teamData?.attackers) return [];
      return Object.entries(teamData.attackers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));
    };
    return {
      Penguin: getTop10(day?.Penguin),
      Reindeer: getTop10(day?.Reindeer)
    };
  });

  state.dailyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Penguin",
          data: penguinData,
          backgroundColor: TEAM_COLORS.Penguin.bg,
          borderColor: TEAM_COLORS.Penguin.border,
          borderWidth: 1
        },
        {
          label: "Reindeer",
          data: reindeerData,
          backgroundColor: TEAM_COLORS.Reindeer.bg,
          borderColor: TEAM_COLORS.Reindeer.border,
          borderWidth: 1
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
            afterBody: (tooltipItems) => {
              const item = tooltipItems[0];
              if (!item) return "";
              const dayIndex = item.dataIndex;
              const team = item.dataset.label;
              const topList = topAttackersPerDay[dayIndex]?.[team] || [];
              if (!topList.length) return "";

              const lines = ["\nTop 10 Attackers:"];
              topList.forEach((a, i) => {
                lines.push(`${i + 1}. ${a.name}: ${a.count}`);
              });
              return lines.join("\n");
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Attacks" }
        }
      }
    }
  });

  return state.dailyChart;
}

function buildVictimBreakdown(events) {
  // Build attacker -> victim -> count mapping
  const breakdown = {};

  events.forEach(e => {
    const attacker = e.attacker;
    const victim = e.victim;
    const team = e.attackerTeam;
    if (!attacker || !victim) return;

    if (!breakdown[attacker]) {
      breakdown[attacker] = { team, victims: {}, total: 0 };
    }
    breakdown[attacker].victims[victim] = (breakdown[attacker].victims[victim] || 0) + 1;
    breakdown[attacker].total++;
  });

  // Convert to array and sort by total attacks
  return Object.entries(breakdown)
    .map(([attacker, data]) => ({
      attacker,
      team: data.team,
      total: data.total,
      victims: Object.entries(data.victims)
        .map(([victim, count]) => ({ victim, count }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.total - a.total);
}

function renderVictimBreakdownTable() {
  const table = document.getElementById("victimBreakdownTable");
  const search = state.victimSearch.toLowerCase();
  const teamFilter = state.victimTeamFilter;

  let filtered = state.victimBreakdown;

  if (search) {
    filtered = filtered.filter(u => u.attacker.toLowerCase().includes(search));
  }
  if (teamFilter !== "All") {
    filtered = filtered.filter(u => u.team === teamFilter);
  }

  const head = `<tr><th>Attacker</th><th>Team</th><th>Victims</th><th>Total Attacks</th></tr>`;

  const body = filtered.map((u, idx) => {
    const teamClass = u.team?.toLowerCase() || "";
    const totalVictims = u.victims.length;
    const top10Victims = u.victims.slice(0, 10);

    const parentRow = `
      <tr class="parent-row" data-idx="${idx}">
        <td>${escapeHtml(u.attacker)}</td>
        <td><span class="pill ${teamClass}">${u.team || ""}</span></td>
        <td>${totalVictims}</td>
        <td>${u.total}</td>
      </tr>
    `;

    const childRows = top10Victims.map(v => `
      <tr class="child-row" data-parent="${idx}">
        <td>${escapeHtml(v.victim)}</td>
        <td></td>
        <td></td>
        <td>${v.count}</td>
      </tr>
    `).join("");

    const summaryRow = `
      <tr class="child-row total-row" data-parent="${idx}">
        <td colspan="3">Total: ${totalVictims} victims, ${u.total} attacks</td>
        <td></td>
      </tr>
    `;

    return parentRow + childRows + summaryRow;
  }).join("");

  table.innerHTML = head + body;

  // Wire up collapse/expand
  table.querySelectorAll(".parent-row").forEach(row => {
    row.onclick = () => {
      const idx = row.dataset.idx;
      const isExpanded = row.classList.toggle("expanded");
      table.querySelectorAll(`.child-row[data-parent="${idx}"]`).forEach(child => {
        child.classList.toggle("visible", isExpanded);
      });
    };
  });
}

function renderEventsTable() {
  const table = document.getElementById("eventsTable");
  const search = state.eventsSearch.toLowerCase();
  const teamFilter = state.eventsTeamFilter;
  const roomFilter = state.eventsRoomFilter;
  const dateFrom = state.eventsDateFrom;
  const dateTo = state.eventsDateTo;
  const [sortKey, sortDir] = state.eventsSort.split("-");

  let filtered = state.allEvents;

  if (search) {
    filtered = filtered.filter(e =>
      e.attacker.toLowerCase().includes(search) ||
      e.victim.toLowerCase().includes(search)
    );
  }
  if (teamFilter !== "All") {
    filtered = filtered.filter(e => e.attackerTeam === teamFilter);
  }
  if (roomFilter !== "All") {
    filtered = filtered.filter(e => e.roomName === roomFilter);
  }
  if (dateFrom) {
    filtered = filtered.filter(e => e.time.split(" ")[0] >= dateFrom);
  }
  if (dateTo) {
    filtered = filtered.filter(e => e.time.split(" ")[0] <= dateTo);
  }

  // Sort
  const dir = sortDir === "asc" ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    if (sortKey === "time") {
      return (a.time > b.time ? 1 : -1) * dir;
    } else if (sortKey === "attacker") {
      return a.attacker.localeCompare(b.attacker) * dir;
    } else if (sortKey === "victim") {
      return a.victim.localeCompare(b.victim) * dir;
    } else if (sortKey === "team") {
      return (a.attackerTeam || "").localeCompare(b.attackerTeam || "") * dir;
    } else if (sortKey === "room") {
      return (a.roomName || "").localeCompare(b.roomName || "") * dir;
    }
    return 0;
  });

  // Store filtered for download
  state.filteredEvents = filtered;

  // Limit to 500 for performance
  const limited = filtered.slice(0, 500);

  document.getElementById("eventsCount").textContent =
    `(${limited.length}${filtered.length > 500 ? " of " + filtered.length : ""} shown)`;

  const columns = [
    { key: "time", label: "Date/Time" },
    { key: "attacker", label: "Attacker" },
    { key: "team", label: "Team" },
    { key: "victim", label: "Victim" },
    { key: "room", label: "Room" }
  ];

  const head = `<tr>${columns.map(col => {
    const arrow = sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-sort="${col.key}">${col.label}${arrow}</th>`;
  }).join("")}</tr>`;

  const body = limited.map(e => {
    const teamClass = e.attackerTeam?.toLowerCase() || "";
    return `
      <tr>
        <td>${escapeHtml(e.time)}</td>
        <td>${escapeHtml(e.attacker)}</td>
        <td><span class="pill ${teamClass}">${e.attackerTeam || ""}</span></td>
        <td>${escapeHtml(e.victim)}</td>
        <td>${escapeHtml(e.roomName || "")}</td>
      </tr>
    `;
  }).join("");

  table.innerHTML = head + body;

  // Wire up column header sorting
  table.querySelectorAll("th[data-sort]").forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      const [currentKey, currentDir] = state.eventsSort.split("-");
      if (currentKey === key) {
        state.eventsSort = `${key}-${currentDir === "asc" ? "desc" : "asc"}`;
      } else {
        state.eventsSort = `${key}-asc`;
      }
      document.getElementById("eventsSort").value = state.eventsSort;
      renderEventsTable();
    };
  });
}

function downloadEventsCSV() {
  const events = state.filteredEvents || state.allEvents;
  const headers = ["Date/Time", "Attacker", "Attacker Team", "Victim", "Room"];
  const rows = events.map(e => [
    e.time,
    e.attacker,
    e.attackerTeam || "",
    e.victim,
    e.roomName || ""
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `snowball-events-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function compareHeadToHead() {
  const user1Input = document.getElementById("h2hUser1").value.trim().toLowerCase();
  const user2Input = document.getElementById("h2hUser2").value.trim().toLowerCase();
  const resultDiv = document.getElementById("h2hResult");
  const statsDiv = document.getElementById("h2hStats");

  if (!user1Input || !user2Input) {
    resultDiv.style.display = "none";
    return;
  }

  // Find users (case-insensitive)
  const user1 = state.allUsers.find(u => u.user.toLowerCase() === user1Input);
  const user2 = state.allUsers.find(u => u.user.toLowerCase() === user2Input);

  if (!user1 || !user2) {
    resultDiv.style.display = "block";
    statsDiv.innerHTML = `<div style="grid-column:1/-1;color:var(--text-muted);">One or both users not found.</div>`;
    return;
  }

  // Count attacks between users
  let user1HitsOnUser2 = 0;
  let user2HitsOnUser1 = 0;

  state.allEvents.forEach(e => {
    const attacker = e.attacker.toLowerCase();
    const victim = e.victim.toLowerCase();
    if (attacker === user1.user.toLowerCase() && victim === user2.user.toLowerCase()) {
      user1HitsOnUser2++;
    } else if (attacker === user2.user.toLowerCase() && victim === user1.user.toLowerCase()) {
      user2HitsOnUser1++;
    }
  });

  const user1Wins = user1HitsOnUser2 > user2HitsOnUser1;
  const user2Wins = user2HitsOnUser1 > user1HitsOnUser2;
  const isTie = user1HitsOnUser2 === user2HitsOnUser1;

  // Calculate comparison stats
  const totalHits = user1HitsOnUser2 + user2HitsOnUser1;
  const user1WinRate = totalHits > 0 ? Math.round((user1HitsOnUser2 / totalHits) * 100) : 0;
  const user2WinRate = totalHits > 0 ? 100 - user1WinRate : 0;
  const user1NetDiff = user1HitsOnUser2 - user2HitsOnUser1;
  const user2NetDiff = -user1NetDiff;

  const formatNetDiff = (diff) => diff > 0 ? `+${diff}` : diff.toString();

  const getTeamLogo = (team) => team.toLowerCase() === 'penguin' ? 'penguin.png' : 'reindeer.png';

  resultDiv.style.display = "block";
  statsDiv.innerHTML = `
    <div>
      <img src="${getTeamLogo(user1.team)}" alt="${user1.team}" style="width:48px;height:48px;margin-bottom:8px;">
      <div class="h2h-user">${escapeHtml(user1.user)}</div>
      <div class="h2h-stat"><span class="pill ${user1.team.toLowerCase()}">${user1.team}</span></div>
      <div class="h2h-value ${user1Wins ? 'h2h-winner' : ''}">${user1HitsOnUser2}</div>
      <div class="h2h-stat">hits on ${escapeHtml(user2.user)}</div>
      <div class="h2h-stat" style="margin-top:8px;font-size:0.9rem;">
        <span style="font-weight:600;${user1Wins ? 'color:#16a34a;' : ''}">${user1WinRate}%</span> win rate
      </div>
      <div class="h2h-stat" style="font-size:0.9rem;">
        <span style="font-weight:600;${user1NetDiff > 0 ? 'color:#16a34a;' : user1NetDiff < 0 ? 'color:#dc2626;' : ''}">${formatNetDiff(user1NetDiff)}</span> net
      </div>
    </div>
    <div class="h2h-vs">VS</div>
    <div>
      <img src="${getTeamLogo(user2.team)}" alt="${user2.team}" style="width:48px;height:48px;margin-bottom:8px;">
      <div class="h2h-user">${escapeHtml(user2.user)}</div>
      <div class="h2h-stat"><span class="pill ${user2.team.toLowerCase()}">${user2.team}</span></div>
      <div class="h2h-value ${user2Wins ? 'h2h-winner' : ''}">${user2HitsOnUser1}</div>
      <div class="h2h-stat">hits on ${escapeHtml(user1.user)}</div>
      <div class="h2h-stat" style="margin-top:8px;font-size:0.9rem;">
        <span style="font-weight:600;${user2Wins ? 'color:#16a34a;' : ''}">${user2WinRate}%</span> win rate
      </div>
      <div class="h2h-stat" style="font-size:0.9rem;">
        <span style="font-weight:600;${user2NetDiff > 0 ? 'color:#16a34a;' : user2NetDiff < 0 ? 'color:#dc2626;' : ''}">${formatNetDiff(user2NetDiff)}</span> net
      </div>
    </div>
  `;
}

function renderHeatmap() {
  const container = document.getElementById("heatmap");
  if (!container) return;

  // Build hour x day-of-week matrix
  const matrix = {};
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Initialize matrix
  for (let h = 0; h < 24; h++) {
    matrix[h] = {};
    for (let d = 0; d < 7; d++) {
      matrix[h][d] = 0;
    }
  }

  // Count events (timestamps are in Eastern time)
  state.allEvents.forEach(e => {
    // Parse as local time since data is already in Eastern time
    const [datePart, timePart] = e.time.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute, second] = timePart.split(":").map(Number);
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (isNaN(date.getTime())) return;
    const h = date.getHours();
    const d = date.getDay();
    matrix[h][d]++;
  });

  // Find max for scaling
  let maxVal = 0;
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) {
      if (matrix[h][d] > maxVal) maxVal = matrix[h][d];
    }
  }

  // Build grid HTML
  let html = '<div class="heatmap-grid" style="grid-template-columns: auto repeat(24, 1fr);">';

  // Header row with hours
  html += '<div class="heatmap-label"></div>';
  for (let h = 0; h < 24; h++) {
    html += `<div class="heatmap-label">${h}</div>`;
  }

  // Data rows
  for (let d = 0; d < 7; d++) {
    html += `<div class="heatmap-label">${days[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const val = matrix[h][d];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const bg = getHeatmapColor(intensity);
      html += `<div class="heatmap-cell" style="background:${bg};" title="${days[d]} ${h}:00 ET - ${val} attacks"></div>`;
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function getHeatmapColor(intensity) {
  // Blue gradient from light to dark
  const minL = 95; // Very light
  const maxL = 30; // Dark blue
  const lightness = minL - (minL - maxL) * intensity;
  return `hsl(220, 80%, ${lightness}%)`;
}

function populateRoomFilter() {
  const select = document.getElementById("eventsRoomFilter");
  if (!select) return;

  // Extract unique rooms
  const rooms = new Set();
  state.allEvents.forEach(e => {
    if (e.roomName) rooms.add(e.roomName);
  });

  const sortedRooms = Array.from(rooms).sort();
  state.allRooms = sortedRooms;

  // Build options
  let html = '<option value="All">All Rooms</option>';
  sortedRooms.forEach(room => {
    html += `<option value="${escapeHtml(room)}">${escapeHtml(room)}</option>`;
  });
  select.innerHTML = html;
}

function setupEventListeners() {
  // Initialize combo boxes for user search (dropdown autocomplete)
  initComboBox("userSearch", "userSearchDropdown", { multiSelect: true });

  // Initialize combo boxes for H2H inputs
  initComboBox("h2hUser1", "h2hUser1Dropdown", {
    onSelect: () => {
      // Auto-compare when both users are filled
      const user1 = document.getElementById("h2hUser1").value.trim();
      const user2 = document.getElementById("h2hUser2").value.trim();
      if (user1 && user2) {
        compareHeadToHead();
      }
    }
  });

  initComboBox("h2hUser2", "h2hUser2Dropdown", {
    onSelect: () => {
      // Auto-compare when both users are filled
      const user1 = document.getElementById("h2hUser1").value.trim();
      const user2 = document.getElementById("h2hUser2").value.trim();
      if (user1 && user2) {
        compareHeadToHead();
      }
    }
  });

  // Search input
  const searchInput = document.getElementById("userSearch");
  searchInput.addEventListener("input", () => {
    const raw = searchInput.value || "";
    state.query = raw;
    const parsedNames = parseSearchNames(raw);
    const isMulti = parsedNames.length > 1;
    state.searchNames = isMulti ? parsedNames : [];

    if (isMulti) {
      const matches = state.allUsers.filter(u => state.searchNames.includes(u.user.toLowerCase()));
      state.selectedUsers = new Set(matches.map(m => m.user));

      // Auto-trigger H2H when exactly 2 users are matched
      if (matches.length === 2) {
        document.getElementById("h2hUser1").value = matches[0].user;
        document.getElementById("h2hUser2").value = matches[1].user;
        compareHeadToHead();
      }
    } else if (parsedNames.length === 1) {
      const exact = state.allUsers.find(u => u.user.toLowerCase() === parsedNames[0]);
      state.selectedUsers = exact ? new Set([exact.user]) : new Set();
    } else {
      state.selectedUsers = new Set();
    }

    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();
    updateScatterHighlights();
  });

  // Filter expression input
  const filterInput = document.getElementById("filterExpr");
  filterInput.addEventListener("input", () => {
    state.filterExpr = filterInput.value || "";
    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();
  });

  // Team filter
  const teamFilter = document.getElementById("teamFilter");
  teamFilter.addEventListener("change", () => {
    state.teamFilter = teamFilter.value;
    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();
  });

  // Sort dropdown
  const sortSelect = document.getElementById("sortSelect");
  sortSelect.addEventListener("change", () => {
    const [key, dir] = sortSelect.value.split("-");
    state.sortKey = key;
    state.sortDir = dir;
    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();
  });

  // Victim breakdown table controls
  const victimSearch = document.getElementById("victimTableSearch");
  victimSearch?.addEventListener("input", () => {
    state.victimSearch = victimSearch.value || "";
    renderVictimBreakdownTable();
  });

  const victimTeamFilter = document.getElementById("victimTableTeam");
  victimTeamFilter?.addEventListener("change", () => {
    state.victimTeamFilter = victimTeamFilter.value;
    renderVictimBreakdownTable();
  });

  // Events table controls
  const eventsSearch = document.getElementById("eventsSearch");
  eventsSearch?.addEventListener("input", () => {
    state.eventsSearch = eventsSearch.value || "";
    renderEventsTable();
  });

  const eventsTeamFilter = document.getElementById("eventsTeamFilter");
  eventsTeamFilter?.addEventListener("change", () => {
    state.eventsTeamFilter = eventsTeamFilter.value;
    renderEventsTable();
  });

  const eventsSort = document.getElementById("eventsSort");
  eventsSort?.addEventListener("change", () => {
    state.eventsSort = eventsSort.value;
    renderEventsTable();
  });

  // Download button
  const downloadBtn = document.getElementById("downloadEventsBtn");
  downloadBtn?.addEventListener("click", downloadEventsCSV);

  // Room filter
  const eventsRoomFilter = document.getElementById("eventsRoomFilter");
  eventsRoomFilter?.addEventListener("change", () => {
    state.eventsRoomFilter = eventsRoomFilter.value;
    renderEventsTable();
  });

  // Date filters
  const eventsDateFrom = document.getElementById("eventsDateFrom");
  eventsDateFrom?.addEventListener("change", () => {
    state.eventsDateFrom = eventsDateFrom.value;
    renderEventsTable();
  });

  const eventsDateTo = document.getElementById("eventsDateTo");
  eventsDateTo?.addEventListener("change", () => {
    state.eventsDateTo = eventsDateTo.value;
    renderEventsTable();
  });

  // Head-to-head comparison
  const h2hCompare = document.getElementById("h2hCompare");
  h2hCompare?.addEventListener("click", compareHeadToHead);

  // Also trigger on Enter key in h2h inputs
  const h2hUser1 = document.getElementById("h2hUser1");
  const h2hUser2 = document.getElementById("h2hUser2");
  h2hUser1?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") compareHeadToHead();
  });
  h2hUser2?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") compareHeadToHead();
  });

  // Theme toggle
  const themeToggle = document.getElementById("themeToggle");
  themeToggle?.addEventListener("click", toggleDarkMode);
  updateThemeToggleIcon();

  // Data mode toggle
  const dataModeLive = document.getElementById("dataModeLive");
  const dataModePreReset = document.getElementById("dataModePreReset");
  dataModeLive?.addEventListener("click", () => switchDataMode("live"));
  dataModePreReset?.addEventListener("click", () => switchDataMode("pre-reset"));
}

(async function main() {
  try {
    // Restore saved data mode preference (default to "live")
    const savedMode = localStorage.getItem("dataMode");
    if (savedMode === "pre-reset") {
      state.dataMode = "pre-reset";
    }
    updateDataModeUI();

    // Setup event listeners first (for combo boxes to work during data load)
    setupEventListeners();

    // Load and render all data
    await loadAndRefreshData();

  } catch (err) {
    console.error(err);
    document.getElementById("meta").textContent = `Error: ${err.message}`;
  }
})();
