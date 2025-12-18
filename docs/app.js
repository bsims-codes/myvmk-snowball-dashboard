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

function parseSearchNames(input) {
  if (!input) return [];
  return input.split(",").map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase());
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
  eventsSearch: "",
  eventsTeamFilter: "All",
  eventsSort: "time-desc",
  // Victim breakdown state
  victimBreakdown: [],
  victimSearch: "",
  victimTeamFilter: "All"
};

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

function renderTeamStats(summary) {
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

  container.innerHTML = items.map(item => `
    <div class="team-stat ${item.team}">
      ${logoMap[item.team] ? `<img src="${logoMap[item.team]}" alt="${item.label}" class="team-logo">` : ''}
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

  const head = `<tr><th>Attacker</th><th>Team</th><th>Total Attacks</th></tr>`;

  const body = filtered.map((u, idx) => {
    const teamClass = u.team?.toLowerCase() || "";
    const parentRow = `
      <tr class="parent-row" data-idx="${idx}">
        <td>${escapeHtml(u.attacker)}</td>
        <td><span class="pill ${teamClass}">${u.team || ""}</span></td>
        <td>${u.total}</td>
      </tr>
    `;

    const childRows = u.victims.map(v => `
      <tr class="child-row" data-parent="${idx}">
        <td>${escapeHtml(v.victim)}</td>
        <td></td>
        <td>${v.count}</td>
      </tr>
    `).join("");

    const totalRow = `
      <tr class="child-row total-row" data-parent="${idx}">
        <td>${escapeHtml(u.attacker)} Total</td>
        <td></td>
        <td>${u.total}</td>
      </tr>
    `;

    return parentRow + childRows + totalRow;
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

  // Sort
  const dir = sortDir === "asc" ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    if (sortKey === "time") {
      return (a.time > b.time ? 1 : -1) * dir;
    } else if (sortKey === "attacker") {
      return a.attacker.localeCompare(b.attacker) * dir;
    } else if (sortKey === "victim") {
      return a.victim.localeCompare(b.victim) * dir;
    }
    return 0;
  });

  // Limit to 500 for performance
  const limited = filtered.slice(0, 500);

  document.getElementById("eventsCount").textContent =
    `(${limited.length}${filtered.length > 500 ? " of " + filtered.length : ""} shown)`;

  const head = `<tr><th>Date/Time</th><th>Attacker</th><th>Team</th><th>Victim</th></tr>`;

  const body = limited.map(e => {
    const teamClass = e.attackerTeam?.toLowerCase() || "";
    return `
      <tr>
        <td>${escapeHtml(e.time)}</td>
        <td>${escapeHtml(e.attacker)}</td>
        <td><span class="pill ${teamClass}">${e.attackerTeam || ""}</span></td>
        <td>${escapeHtml(e.victim)}</td>
      </tr>
    `;
  }).join("");

  table.innerHTML = head + body;
}

function setupEventListeners() {
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
}

(async function main() {
  try {
    const [summary, users, roomsSummary, events] = await Promise.all([
      loadJSON("./data/summary.json"),
      loadJSON("./data/users.json"),
      loadJSON("./data/rooms_summary.json"),
      loadJSON("./data/events.json")
    ]);

    // Update metadata
    document.getElementById("meta").textContent =
      `Last updated: ${new Date(summary.generatedAt).toLocaleString()} | ` +
      `${summary.totalRows?.toLocaleString() || 0} events | ` +
      `${summary.totalUsers?.toLocaleString() || 0} users`;

    // Initialize state
    state.allUsers = users;
    state.usersIndex = new Map(users.map(u => [u.user, u]));
    state.allEvents = events;
    state.victimBreakdown = buildVictimBreakdown(events);

    // Render components
    renderTeamStats(summary);
    renderTopLists(summary);

  // Apply initial filter/sort
  applyFilterSort();
  buildUsersTable();
  updateSelectionUI();

  // Create charts
  createScatter(document.getElementById("scatter"), summary);
    createRoomsChart(document.getElementById("roomsChart"), roomsSummary);
    createDailyChart(document.getElementById("dailyChart"), events);

    // Render new tables
    renderVictimBreakdownTable();
    renderEventsTable();

    // Setup event listeners
    setupEventListeners();

  } catch (err) {
    console.error(err);
    document.getElementById("meta").textContent = `Error: ${err.message}`;
  }
})();
