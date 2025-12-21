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
 * Fetch team data from the snow teams API
 * Returns { totals: { Penguin, Reindeer }, rosters: { Penguin: [], Reindeer: [] } }
 */
async function fetchTeamData() {
  try {
    const res = await fetch("https://www.myvmk.com/api/getsnowteams", { cache: "no-store" });
    if (!res.ok) return null;

    const text = await res.text();
    // Handle both \r\n and \n line endings
    const lines = text.trim().split(/\r?\n/).slice(1); // Skip header row

    const rosters = { Penguin: [], Reindeer: [] };

    for (const line of lines) {
      const parts = line.split(",");
      const username = parts[0]?.trim();
      const team = parts[1]?.trim();
      if (username) {
        if (team === "1") rosters.Penguin.push(username);
        else if (team === "0") rosters.Reindeer.push(username);
      }
    }

    // Sort rosters alphabetically
    rosters.Penguin.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    rosters.Reindeer.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return {
      totals: { Penguin: rosters.Penguin.length, Reindeer: rosters.Reindeer.length },
      rosters
    };
  } catch (err) {
    console.warn("Failed to fetch team data:", err);
    return null;
  }
}

/**
 * Render team roster tables
 */
function renderTeamRosters(teamData, penguinFilter = "", reindeerFilter = "") {
  const penguinTable = document.getElementById("penguinRosterTable");
  const reindeerTable = document.getElementById("reindeerRosterTable");
  const penguinCount = document.getElementById("penguinRosterCount");
  const reindeerCount = document.getElementById("reindeerRosterCount");

  if (!teamData || !teamData.rosters) {
    // No data available (e.g., pre-reset mode)
    if (penguinTable) penguinTable.innerHTML = "<tr><td style='color:var(--text-muted);'>Team roster not available</td></tr>";
    if (reindeerTable) reindeerTable.innerHTML = "<tr><td style='color:var(--text-muted);'>Team roster not available</td></tr>";
    if (penguinCount) penguinCount.textContent = "";
    if (reindeerCount) reindeerCount.textContent = "";
    return;
  }

  const { rosters } = teamData;

  // Filter rosters
  const penguinFilterLower = penguinFilter.toLowerCase();
  const reindeerFilterLower = reindeerFilter.toLowerCase();

  const filteredPenguin = penguinFilter
    ? rosters.Penguin.filter(u => u.toLowerCase().includes(penguinFilterLower))
    : rosters.Penguin;

  const filteredReindeer = reindeerFilter
    ? rosters.Reindeer.filter(u => u.toLowerCase().includes(reindeerFilterLower))
    : rosters.Reindeer;

  // Update counts (show filtered/total)
  if (penguinCount) {
    penguinCount.textContent = penguinFilter
      ? `(${filteredPenguin.length}/${rosters.Penguin.length})`
      : `(${rosters.Penguin.length})`;
  }
  if (reindeerCount) {
    reindeerCount.textContent = reindeerFilter
      ? `(${filteredReindeer.length}/${rosters.Reindeer.length})`
      : `(${rosters.Reindeer.length})`;
  }

  // Render Penguin roster
  if (penguinTable) {
    penguinTable.innerHTML = `
      <tr><th>Username</th></tr>
      ${filteredPenguin.length > 0
        ? filteredPenguin.map(u => `<tr><td>${escapeHtml(u)}</td></tr>`).join("")
        : `<tr><td style="color:var(--text-muted);">No members matching "${escapeHtml(penguinFilter)}"</td></tr>`
      }
    `;
  }

  // Render Reindeer roster
  if (reindeerTable) {
    reindeerTable.innerHTML = `
      <tr><th>Username</th></tr>
      ${filteredReindeer.length > 0
        ? filteredReindeer.map(u => `<tr><td>${escapeHtml(u)}</td></tr>`).join("")
        : `<tr><td style="color:var(--text-muted);">No members matching "${escapeHtml(reindeerFilter)}"</td></tr>`
      }
    `;
  }
}

// Store team data globally for filtering
let currentTeamData = null;

// Room ID to name mapping (loaded once)
let roomMapping = null;

/**
 * Load room mapping from static JSON
 */
async function loadRoomMapping() {
  if (roomMapping) return roomMapping;
  try {
    roomMapping = await loadJSON("./data/rooms.json");
    return roomMapping;
  } catch (err) {
    console.warn("Failed to load room mapping:", err);
    return {};
  }
}

/**
 * Sum adjusted point values per attacker team.
 */
function computeTeamAdjustedPoints(events) {
  const totals = { Penguin: 0, Reindeer: 0, Unknown: 0 };
  if (!Array.isArray(events)) return totals;

  for (const evt of events) {
    const value = Number(evt?.value);
    if (!Number.isFinite(value)) continue;

    const team = evt?.attackerTeam === "Penguin" || evt?.attackerTeam === "Reindeer"
      ? evt.attackerTeam
      : "Unknown";

    totals[team] += value;
  }

  return totals;
}

/**
 * Ensure summary has adjustedPoints populated from events.
 */
function applyAdjustedPointsToSummary(summary, events) {
  if (!summary) return summary;

  const adjusted = computeTeamAdjustedPoints(events);
  summary.teamStats = summary.teamStats || {};

  ["Penguin", "Reindeer", "Unknown"].forEach(team => {
    const bucket = summary.teamStats[team] || { users: 0, attacks: 0, hitsTaken: 0 };
    bucket.adjustedPoints = adjusted[team] || 0;
    summary.teamStats[team] = bucket;
  });

  return summary;
}

function safeRatio(attacks, hitsTaken) {
  if (!hitsTaken) return attacks ? attacks / 1 : 0;
  return attacks / hitsTaken;
}

const BATTLE_MIN_HITS = 30;
const BATTLE_MAX_GAP_SECONDS = 120;

function parseEventTime(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute, second].some(v => Number.isNaN(v))) return null;
  return new Date(year, month - 1, day, hour, minute, second);
}

function detectBattles(events) {
  const byRoom = new Map();
  events.forEach(evt => {
    const room = evt.roomName || evt.roomId || "Unknown";
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(evt);
  });

  const battles = [];

  for (const [roomName, roomEvents] of byRoom.entries()) {
    const sorted = [...roomEvents]
      .map(e => ({ ...e, __t: parseEventTime(e.time) }))
      .filter(e => e.__t)
      .sort((a, b) => a.__t - b.__t);

    if (!sorted.length) continue;

    let cluster = [];
    let prev = null;
    let roomCounter = 1;

    const flush = () => {
      if (!cluster.length) return;
      const hitCount = cluster.length;
      if (hitCount < BATTLE_MIN_HITS) {
        cluster = [];
        return;
      }

      const start = cluster[0].__t;
      const end = cluster[cluster.length - 1].__t;
      const durationMinutes = Math.max(1, Math.round((end - start) / 60000));

      const byUser = new Map();
      const userSet = new Set();

      cluster.forEach(evt => {
        if (evt.attacker) {
          userSet.add(evt.attacker);
          const s = byUser.get(evt.attacker) || { user: evt.attacker, team: evt.attackerTeam || "Unknown", attacks: 0, hitsTaken: 0 };
          s.attacks++;
          byUser.set(evt.attacker, s);
        }
        if (evt.victim) {
          userSet.add(evt.victim);
          const s = byUser.get(evt.victim) || { user: evt.victim, team: evt.victimTeam || "Unknown", attacks: 0, hitsTaken: 0 };
          s.hitsTaken++;
          byUser.set(evt.victim, s);
        }
      });

      const participants = [...byUser.values()].map(p => ({
        ...p,
        ratio: safeRatio(p.attacks, p.hitsTaken)
      })).sort((a, b) => (b.attacks + b.hitsTaken) - (a.attacks + a.hitsTaken));

      const topAttackers = [...participants]
        .filter(p => p.attacks > 0)
        .sort((a, b) => b.attacks - a.attacks)
        .slice(0, 3)
        .map(p => ({ user: p.user, team: p.team, attacks: p.attacks }));

      const topVictims = [...participants]
        .filter(p => p.hitsTaken > 0)
        .sort((a, b) => b.hitsTaken - a.hitsTaken)
        .slice(0, 3)
        .map(p => ({ user: p.user, team: p.team, hitsTaken: p.hitsTaken }));

      battles.push({
        id: `${roomName}-${roomCounter++}`,
        roomName,
        start: start.toISOString(),
        end: end.toISOString(),
        durationMinutes,
        hitCount,
        uniqueUsers: userSet.size,
        topAttackers,
        topVictims,
        participants
      });

      cluster = [];
    };

    for (const evt of sorted) {
      if (!prev) {
        cluster.push(evt);
        prev = evt.__t;
        continue;
      }
      const gapSeconds = (evt.__t - prev) / 1000;
      if (gapSeconds <= BATTLE_MAX_GAP_SECONDS) {
        cluster.push(evt);
      } else {
        flush();
        cluster = [evt];
      }
      prev = evt.__t;
    }

    flush();
  }

  return battles.sort((a, b) => new Date(b.start) - new Date(a.start));
}

/**
 * Fetch and process live data directly from MyVMK APIs
 * Returns { summary, users, events, roomsSummary, teamData }
 */
async function fetchLiveData() {
  // Fetch all data in parallel
  const [hitsResponse, teamsResponse, rooms] = await Promise.all([
    fetch("https://www.myvmk.com/api/gethits", { cache: "no-store" }),
    fetch("https://www.myvmk.com/api/getsnowteams", { cache: "no-store" }),
    loadRoomMapping()
  ]);

  if (!hitsResponse.ok) throw new Error("Failed to fetch hits data");
  if (!teamsResponse.ok) throw new Error("Failed to fetch teams data");

  const hitsText = await hitsResponse.text();
  const teamsText = await teamsResponse.text();

  // Parse teams CSV -> { username: team }
  const teamMap = {};
  const rosters = { Penguin: [], Reindeer: [] };
  const teamsLines = teamsText.trim().split(/\r?\n/).slice(1);
  for (const line of teamsLines) {
    const [username, team] = line.split(",").map(s => s?.trim());
    if (username && team) {
      const teamName = team === "1" ? "Penguin" : "Reindeer";
      teamMap[username.toLowerCase()] = teamName;
      rosters[teamName].push(username);
    }
  }
  rosters.Penguin.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  rosters.Reindeer.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Parse hits CSV
  const hitsLines = hitsText.trim().split(/\r?\n/).slice(1);
  const events = [];
  const userStats = {};
  const roomStats = {};

  for (const line of hitsLines) {
    const parts = line.split(",");
    if (parts.length < 4) continue;

    const time = parts[0]?.trim();
    const attacker = parts[1]?.trim();
    const victim = parts[2]?.trim();
    const roomId = parts[3]?.trim();
    const value = Number(parts[4]?.trim());

    if (!attacker || !victim) continue;

    const attackerTeam = teamMap[attacker.toLowerCase()] || "Unknown";
    const roomName = rooms[roomId] || `Room ${roomId}`;

    // Build event
    events.push({
      time,
      attacker,
      victim,
      attackerTeam,
      roomName,
      value: Number.isFinite(value) ? value : 0
    });

    // Track attacker stats
    if (!userStats[attacker]) {
      userStats[attacker] = { attacks: 0, hitsTaken: 0, team: attackerTeam };
    }
    userStats[attacker].attacks++;

    // Track victim stats
    if (!userStats[victim]) {
      const victimTeam = teamMap[victim.toLowerCase()] || "Unknown";
      userStats[victim] = { attacks: 0, hitsTaken: 0, team: victimTeam };
    }
    userStats[victim].hitsTaken++;

    // Track room stats
    if (!roomStats[roomName]) {
      roomStats[roomName] = { hitCount: 0, users: new Set() };
    }
    roomStats[roomName].hitCount++;
    roomStats[roomName].users.add(attacker);
  }

  // Build users array
  const users = Object.entries(userStats).map(([user, stats]) => ({
    user,
    team: stats.team,
    attacks: stats.attacks,
    hitsTaken: stats.hitsTaken,
    ratio: stats.hitsTaken > 0 ? stats.attacks / stats.hitsTaken : stats.attacks
  })).sort((a, b) => b.attacks - a.attacks);

  // Build team stats
  const adjustedPointsByTeam = computeTeamAdjustedPoints(events);
  const teamStats = {
    Penguin: { users: 0, attacks: 0, hitsTaken: 0, adjustedPoints: adjustedPointsByTeam.Penguin || 0 },
    Reindeer: { users: 0, attacks: 0, hitsTaken: 0, adjustedPoints: adjustedPointsByTeam.Reindeer || 0 },
    Unknown: { users: 0, attacks: 0, hitsTaken: 0, adjustedPoints: adjustedPointsByTeam.Unknown || 0 }
  };
  users.forEach(u => {
    if (u.team === "Penguin" || u.team === "Reindeer") {
      teamStats[u.team].users++;
      teamStats[u.team].attacks += u.attacks;
      teamStats[u.team].hitsTaken += u.hitsTaken;
    }
  });

  // Build rooms summary
  const roomsSummary = Object.entries(roomStats)
    .map(([roomName, stats]) => {
      const roomUsers = Array.from(stats.users);
      const avgRatio = roomUsers.reduce((sum, u) => {
        const user = users.find(usr => usr.user === u);
        return sum + (user?.ratio || 1);
      }, 0) / (roomUsers.length || 1);

      return {
        roomName,
        hitCount: stats.hitCount,
        avgUserRatio: Math.round(avgRatio * 100) / 100,
        activeUsers: roomUsers.length
      };
    })
    .sort((a, b) => b.hitCount - a.hitCount);

  // Build scatter points
  const scatterPoints = users.map(u => ({
    user: u.user,
    team: u.team,
    attacks: u.attacks,
    hitsTaken: u.hitsTaken
  }));

  // Build top attackers/victims
  const topAttackers = [...users].sort((a, b) => b.attacks - a.attacks).slice(0, 10);
  const topVictims = [...users].sort((a, b) => b.hitsTaken - a.hitsTaken).slice(0, 10);

  // Build summary
  const summary = {
    generatedAt: new Date().toISOString(),
    totalRows: events.length,
    totalUsers: users.length,
    teamStats,
    scatterPoints,
    topAttackers,
    topVictims
  };

  const battles = detectBattles(events);

  applyAdjustedPointsToSummary(summary, events);

  // Build team data for roster display
  const teamData = {
    totals: { Penguin: rosters.Penguin.length, Reindeer: rosters.Reindeer.length },
    rosters
  };

  return { summary, users, events, roomsSummary, teamData, battles };
}

/**
 * Refresh dashboard with live API data
 */
async function refreshFromAPI() {
  const refreshBtn = document.getElementById("refreshDataBtn");
  const refreshIcon = document.getElementById("refreshIcon");

  try {
    // Show loading state
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.style.animation = "spin 1s linear infinite";
    document.getElementById("meta").textContent = "Fetching live data from API...";

    const { summary, users, events, roomsSummary, teamData, battles } = await fetchLiveData();

    // Update state
    state.allUsers = users;
    state.usersIndex = new Map(users.map(u => [u.user, u]));
    state.allEvents = events;
    state.victimBreakdown = buildVictimBreakdown(events);
    state.attackerBreakdown = buildAttackerBreakdown(events);
    currentTeamData = teamData;
    state.allBattles = battles || [];
    state.selectedBattleId = null;

    // Update metadata
    document.getElementById("meta").textContent =
      `Live data fetched: ${new Date().toLocaleString()} | ` +
      `${summary.totalRows?.toLocaleString() || 0} events | ` +
      `${summary.totalUsers?.toLocaleString() || 0} users`;

    // Render components
    renderTeamStats(summary, teamData?.totals);
    renderTopLists(summary);
    renderTeamRosters(teamData);
    renderBattlesTable();

    // Clear roster search inputs
    const penguinSearch = document.getElementById("penguinRosterSearch");
    const reindeerSearch = document.getElementById("reindeerRosterSearch");
    if (penguinSearch) penguinSearch.value = "";
    if (reindeerSearch) reindeerSearch.value = "";

    // Apply filter/sort and rebuild tables
    applyFilterSort();
    buildUsersTable();
    updateSelectionUI();

    // Destroy and recreate charts
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

    createScatter(document.getElementById("scatter"), summary);
    createRoomsChart(document.getElementById("roomsChart"), roomsSummary);
    createDailyChart(document.getElementById("dailyChart"), events);

    // Render tables
    renderVictimBreakdownTable();
    renderAttackerBreakdownTable();
    populateRoomFilter();
    renderEventsTable();
    renderHeatmap();

    // Update admin panel if visible
    if (isAdminMode()) {
      renderCloneDetection();
      renderTraitors();
    }

  } catch (err) {
    console.error("Failed to refresh from API:", err);
    document.getElementById("meta").textContent = `Error refreshing: ${err.message}. Using cached data.`;
  } finally {
    // Reset button state
    if (refreshBtn) refreshBtn.disabled = false;
    if (refreshIcon) refreshIcon.style.animation = "";
  }
}

function fmt(n, decimals = 2) {
  if (n == null) return "";
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return String(n);
    const fixed = n.toFixed(decimals);
    // Only strip trailing zeros after a decimal point, not from integers
    return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") || "0";
  }
  return String(n);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * Copy section link to clipboard
 */
function copySectionLink(sectionId, button) {
  const url = `${window.location.origin}${window.location.pathname}#${sectionId}`;
  navigator.clipboard.writeText(url).then(() => {
    // Show feedback
    button.classList.add("copied");
    const originalText = button.textContent;
    button.textContent = "Copied!";
    setTimeout(() => {
      button.classList.remove("copied");
      button.textContent = originalText;
    }, 1500);
  }).catch(err => {
    console.error("Failed to copy link:", err);
  });
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

/**
 * Compute OLS (Ordinary Least Squares) linear regression
 * Returns { slope, intercept, r2, n, xMin, xMax, y1, y2 }
 */
function computeOLS(points) {
  const n = points.length;
  if (n < 2) return null;

  // Calculate means
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Calculate slope and intercept
  let numerator = 0, denominator = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  // Calculate R² (coefficient of determination)
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const predicted = slope * p.x + intercept;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - predicted) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

  // Calculate line endpoints
  const xMin = Math.min(...points.map(p => p.x));
  const xMax = Math.max(...points.map(p => p.x));
  const y1 = slope * xMin + intercept;
  const y2 = slope * xMax + intercept;

  return { slope, intercept, r2, n, xMin, xMax, y1, y2 };
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
  regressionData: {},
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
  // Attacker breakdown state (inverse of victim breakdown)
  attackerBreakdown: [],
  attackerSearch: "",
  attackerTeamFilter: "All",
  // Data mode: "live" or "pre-reset"
  dataMode: "live",
  // Battles
  allBattles: [],
  battleRoomFilter: "All",
  battleMinHits: 30,
  selectedBattleId: null
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

    const battlesPromise = loadJSON(`${basePath}/battles.json`).catch(() => []);

    // Load data files and fetch team data in parallel
    const [summary, users, roomsSummary, events, teamData, battles] = await Promise.all([
      loadJSON(`${basePath}/summary.json`),
      loadJSON(`${basePath}/users.json`),
      loadJSON(`${basePath}/rooms_summary.json`),
      loadJSON(`${basePath}/events.json`),
      // Only fetch live team data for live mode (pre-reset teams no longer exist in API)
      state.dataMode === "live" ? fetchTeamData() : Promise.resolve(null),
      battlesPromise
    ]);

    applyAdjustedPointsToSummary(summary, events);

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
    state.attackerBreakdown = buildAttackerBreakdown(events);

    state.allBattles = battles || [];
    state.selectedBattleId = null;

    // Store team data for roster filtering
    currentTeamData = teamData;

    // Render components (pass team totals for accurate member counts)
    renderTeamStats(summary, teamData?.totals);
    renderTopLists(summary);
    renderTeamRosters(teamData);
    renderBattlesTable();

    // Clear roster search inputs
    const penguinSearch = document.getElementById("penguinRosterSearch");
    const reindeerSearch = document.getElementById("reindeerRosterSearch");
    if (penguinSearch) penguinSearch.value = "";
    if (reindeerSearch) reindeerSearch.value = "";

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
    renderAttackerBreakdownTable();
    populateRoomFilter();
    renderEventsTable();

    // Render heatmap
    renderHeatmap();

    // Update admin panel if visible
    if (isAdminMode()) {
      renderCloneDetection();
      renderTraitors();
    }

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
    const adjusted = item.data.adjustedPoints || 0;

    return `
      <div class="team-stat ${item.team}">
        ${logoMap[item.team] ? `<img src="${logoMap[item.team]}" alt="${item.label}" class="team-logo">` : ''}
        <div class="label">${item.label}</div>
        <div class="value">${totalMembers} users</div>
        <div class="stat-row">
          <span class="label">${participants} active users</span>
          <span class="hits-strong">${fmt(item.data.attacks || 0, 0)} hits</span>
        </div>
        <div class="adjusted">Adj. points ${fmt(adjusted, 1)}</div>
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

function computeLineDataset(regLine, color, regKey) {
  if (!regLine) return null;
  const { xMin, xMax, y1, y2, label } = regLine;
  return {
    type: "line",
    label: `Trend (${label || "All"})`,
    data: [{ x: xMin, y: Math.max(0, y1) }, { x: xMax, y: Math.max(0, y2) }],
    parsing: false,
    pointRadius: 4,
    pointHoverRadius: 8,
    pointBackgroundColor: color.border,
    pointBorderColor: color.border,
    borderWidth: 2,
    borderColor: color.border,
    borderDash: color.dash || [],
    tension: 0,
    regKey: regKey // Store key to access regression data in tooltip
  };
}

function createScatter(ctx, summary) {
  const pts = summary.scatterPoints || [];
  state.scatterBasePoints = pts;

  const byTeam = {
    Penguin: pts.filter(p => p.team === "Penguin"),
    Reindeer: pts.filter(p => p.team === "Reindeer")
  };

  // Convert to x/y points for OLS
  const allPoints = pts.map(p => ({ x: p.attacks, y: p.hitsTaken }));
  const penguinPoints = byTeam.Penguin.map(p => ({ x: p.attacks, y: p.hitsTaken }));
  const reindeerPoints = byTeam.Reindeer.map(p => ({ x: p.attacks, y: p.hitsTaken }));

  // Compute OLS regression on the fly
  const overallOLS = computeOLS(allPoints);
  const penguinOLS = computeOLS(penguinPoints);
  const reindeerOLS = computeOLS(reindeerPoints);

  // Add labels for tooltip display
  if (overallOLS) overallOLS.label = "All Users";
  if (penguinOLS) penguinOLS.label = "Penguin";
  if (reindeerOLS) reindeerOLS.label = "Reindeer";

  state.regressionData = {
    overall: overallOLS,
    penguin: penguinOLS,
    reindeer: reindeerOLS
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

  // Add OLS trend lines
  const overallLine = computeLineDataset(state.regressionData.overall, TREND_COLORS.overall, "overall");
  const pengLine = computeLineDataset(state.regressionData.penguin, TREND_COLORS.penguin, "penguin");
  const reinLine = computeLineDataset(state.regressionData.reindeer, TREND_COLORS.reindeer, "reindeer");

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
            title: (items) => {
              if (!items.length) return "";
              const item = items[0];
              const dataset = item.dataset;
              // Check if this is a trend line
              if (dataset.regKey) {
                const regData = state.regressionData?.[dataset.regKey];
                if (regData && regData.slope != null) {
                  const sign = regData.intercept >= 0 ? "+" : "";
                  return `Hits Taken = ${fmt(regData.slope, 4)} * Attacks ${sign} ${fmt(regData.intercept, 2)}`;
                }
              }
              return "";
            },
            label: (item) => {
              const raw = item.raw;
              const dataset = item.dataset;

              // Check if this is a trend line dataset
              if (dataset.regKey) {
                const regData = state.regressionData?.[dataset.regKey];
                if (regData) {
                  const lines = [];

                  // R² value
                  if (regData.r2 != null) {
                    lines.push(`R²=${fmt(regData.r2, 4)}`);
                  }

                  lines.push("");  // blank line

                  // Team name
                  const teamLabel = dataset.regKey === "overall" ? "All" :
                    dataset.regKey.charAt(0).toUpperCase() + dataset.regKey.slice(1);
                  lines.push(`Team=${teamLabel}`);

                  // Attacks Made (x value of hovered point)
                  const x = raw?.x ?? 0;
                  lines.push(`Attacks Made=${fmt(x, 0)}`);

                  // Predicted Hits Taken from trend line
                  if (regData.slope != null && regData.intercept != null) {
                    const predicted = regData.slope * x + regData.intercept;
                    lines.push(`Hits Taken=${fmt(predicted, 2)} (trend)`);
                  }

                  return lines;
                }
                return dataset.label || "";
              }

              // Regular user point
              if (!raw?.user) return dataset.label || "";
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

/**
 * Check if admin mode is enabled via URL parameter
 */
function isAdminMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === "true";
}

/**
 * Detect potential clone accounts based on suspicious patterns
 * Returns array of suspicious users with details about why they're flagged
 */
function detectSuspiciousClones(events) {
  // Build victim -> { attackers: { attacker: count }, totalHits, attacks } mapping
  const userStats = {};

  events.forEach(e => {
    const attacker = e.attacker;
    const victim = e.victim;
    if (!attacker || !victim) return;

    // Track victim stats
    if (!userStats[victim]) {
      userStats[victim] = { attackers: {}, totalHits: 0, attacks: 0, team: null };
    }
    userStats[victim].attackers[attacker] = (userStats[victim].attackers[attacker] || 0) + 1;
    userStats[victim].totalHits++;

    // Track attack counts
    if (!userStats[attacker]) {
      userStats[attacker] = { attackers: {}, totalHits: 0, attacks: 0, team: null };
    }
    userStats[attacker].attacks++;

    // Get team info
    if (e.victimTeam && !userStats[victim].team) {
      userStats[victim].team = e.victimTeam;
    }
    if (e.attackerTeam && !userStats[attacker].team) {
      userStats[attacker].team = e.attackerTeam;
    }
  });

  const suspicious = [];

  for (const [user, stats] of Object.entries(userStats)) {
    // Skip if not enough hits to be meaningful
    if (stats.totalHits < 15) continue;

    const attackerList = Object.entries(stats.attackers)
      .map(([attacker, count]) => ({ attacker, count }))
      .sort((a, b) => b.count - a.count);

    const uniqueAttackers = attackerList.length;
    const topAttacker = attackerList[0];
    const topAttackerPct = topAttacker ? (topAttacker.count / stats.totalHits) * 100 : 0;

    // Calculate concentration - what % of hits come from top 2 attackers
    const top2Hits = attackerList.slice(0, 2).reduce((sum, a) => sum + a.count, 0);
    const top2Pct = (top2Hits / stats.totalHits) * 100;

    // Suspicion scoring
    let suspicionScore = 0;
    const flags = [];

    // Very low attack count relative to being hit
    if (stats.attacks <= 5 && stats.totalHits >= 20) {
      suspicionScore += 30;
      flags.push(`Only ${stats.attacks} attacks but hit ${stats.totalHits} times`);
    } else if (stats.attacks <= 10 && stats.totalHits >= 30) {
      suspicionScore += 20;
      flags.push(`Low attacks (${stats.attacks}) vs high victim count (${stats.totalHits})`);
    }

    // Very few unique attackers
    if (uniqueAttackers <= 2 && stats.totalHits >= 20) {
      suspicionScore += 35;
      flags.push(`Only ${uniqueAttackers} unique attacker(s)`);
    } else if (uniqueAttackers <= 3 && stats.totalHits >= 30) {
      suspicionScore += 20;
      flags.push(`Only ${uniqueAttackers} unique attackers for ${stats.totalHits} hits`);
    }

    // Top attacker concentration
    if (topAttackerPct >= 80) {
      suspicionScore += 30;
      flags.push(`${Math.round(topAttackerPct)}% of hits from "${topAttacker.attacker}"`);
    } else if (topAttackerPct >= 60) {
      suspicionScore += 15;
      flags.push(`${Math.round(topAttackerPct)}% of hits from "${topAttacker.attacker}"`);
    }

    // Top 2 concentration
    if (top2Pct >= 90 && uniqueAttackers >= 2) {
      suspicionScore += 15;
      flags.push(`Top 2 attackers account for ${Math.round(top2Pct)}% of hits`);
    }

    // High victim count with very low ratio (farming target)
    const ratio = stats.attacks > 0 ? stats.attacks / stats.totalHits : 0;
    if (stats.totalHits >= 200 && ratio < 0.5) {
      suspicionScore += 50;
      flags.push(`Heavy farming target: ${stats.totalHits} hits taken, ratio ${ratio.toFixed(2)}`);
    } else if (stats.totalHits >= 100 && ratio < 0.4) {
      suspicionScore += 40;
      flags.push(`Farming target: ${stats.totalHits} hits taken, ratio ${ratio.toFixed(2)}`);
    } else if (stats.totalHits >= 50 && ratio < 0.3) {
      suspicionScore += 30;
      flags.push(`High victim count (${stats.totalHits}) with very low ratio (${ratio.toFixed(2)})`);
    }

    // Only flag if suspicion score is high enough
    if (suspicionScore >= 50) {
      suspicious.push({
        user,
        team: stats.team || "Unknown",
        attacks: stats.attacks,
        totalHits: stats.totalHits,
        ratio: ratio.toFixed(2),
        uniqueAttackers,
        topAttacker: topAttacker?.attacker || "N/A",
        topAttackerHits: topAttacker?.count || 0,
        topAttackerPct: Math.round(topAttackerPct),
        suspicionScore,
        flags,
        attackerBreakdown: attackerList.slice(0, 5)
      });
    }
  }

  // Sort by suspicion score descending
  return suspicious.sort((a, b) => b.suspicionScore - a.suspicionScore);
}

// Suspicious detection table state
let suspiciousData = [];
let suspiciousSortKey = "suspicionScore";
let suspiciousSortDir = "desc";

/**
 * Sort and render the suspicious detection table
 */
function renderSuspiciousTable() {
  const container = document.getElementById("cloneDetectionPanel");
  if (!container || suspiciousData.length === 0) return;

  // Sort the data
  const sorted = [...suspiciousData].sort((a, b) => {
    let aVal = a[suspiciousSortKey];
    let bVal = b[suspiciousSortKey];

    // Handle string comparisons
    if (typeof aVal === "string") {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
      return suspiciousSortDir === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    // Numeric comparison
    aVal = parseFloat(aVal) || 0;
    bVal = parseFloat(bVal) || 0;
    return suspiciousSortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  const rows = sorted.map((s, idx) => {
    const teamClass = s.team?.toLowerCase() || "";
    const attackerDetails = s.attackerBreakdown
      .map(a => `${escapeHtml(a.attacker)}: ${a.count}`)
      .join(", ");

    return `
      <tr class="parent-row" data-clone-idx="${idx}">
        <td><strong>${escapeHtml(s.user)}</strong></td>
        <td><span class="pill ${teamClass}">${s.team}</span></td>
        <td>${s.attacks}</td>
        <td>${s.totalHits}</td>
        <td>${s.ratio}</td>
        <td>${s.uniqueAttackers}</td>
        <td>${escapeHtml(s.topAttacker)} (${s.topAttackerHits} hits, ${s.topAttackerPct}%)</td>
      </tr>
      <tr class="child-row" data-clone-parent="${idx}">
        <td colspan="7" style="padding-left:24px;">
          <div class="clone-flags">
            <strong>Flags:</strong> ${s.flags.map(f => `<span class="flag-item">${escapeHtml(f)}</span>`).join(" ")}
          </div>
          <div class="clone-attackers" style="margin-top:4px;">
            <strong>Top attackers:</strong> ${attackerDetails}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const sortIcon = (key) => {
    if (suspiciousSortKey !== key) return "";
    return suspiciousSortDir === "asc" ? " ▲" : " ▼";
  };

  container.innerHTML = `
    <table class="collapsible-table sortable-table">
      <tr>
        <th data-sort="user" class="sortable">User${sortIcon("user")}</th>
        <th data-sort="team" class="sortable">Team${sortIcon("team")}</th>
        <th data-sort="attacks" class="sortable">Attacks${sortIcon("attacks")}</th>
        <th data-sort="totalHits" class="sortable">Hits Taken${sortIcon("totalHits")}</th>
        <th data-sort="ratio" class="sortable">Ratio${sortIcon("ratio")}</th>
        <th data-sort="uniqueAttackers" class="sortable">Unique Attackers${sortIcon("uniqueAttackers")}</th>
        <th data-sort="topAttacker" class="sortable">Top Attacker${sortIcon("topAttacker")}</th>
      </tr>
      ${rows}
    </table>
  `;

  // Wire up column header sorting
  container.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = th.getAttribute("data-sort");
      if (suspiciousSortKey === key) {
        suspiciousSortDir = suspiciousSortDir === "asc" ? "desc" : "asc";
      } else {
        suspiciousSortKey = key;
        suspiciousSortDir = "desc";
      }
      renderSuspiciousTable();
    });
  });

  // Wire up row expansion
  container.querySelectorAll(".parent-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = row.getAttribute("data-clone-idx");
      const childRow = container.querySelector(`[data-clone-parent="${idx}"]`);
      if (childRow) {
        childRow.classList.toggle("expanded");
        row.classList.toggle("expanded");
      }
    });
  });
}

/**
 * Render the clone detection admin panel
 */
function renderCloneDetection() {
  const container = document.getElementById("cloneDetectionPanel");
  if (!container) return;

  suspiciousData = detectSuspiciousClones(state.allEvents);
  const countEl = document.getElementById("suspiciousCount");
  if (countEl) {
    countEl.textContent = `(${suspiciousData.length} flagged)`;
  }

  if (suspiciousData.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">No suspicious accounts detected.</p>`;
    return;
  }

  renderSuspiciousTable();
}

/**
 * Detect users who switched teams between pre-reset and current season
 * Returns array of traitors with old and new team info
 */
async function detectTraitors() {
  try {
    // Load pre-reset user data
    const preResetUsers = await loadJSON("./data/archive/pre-reset/users.json");

    // Build map of pre-reset teams (username lowercase -> { user, team })
    const preResetTeams = {};
    preResetUsers.forEach(u => {
      if (u.user && u.team) {
        preResetTeams[u.user.toLowerCase()] = { user: u.user, team: u.team };
      }
    });

    // Get current team data
    if (!currentTeamData || !currentTeamData.rosters) {
      return [];
    }

    const traitors = [];

    // Check Penguin roster for former Reindeer
    currentTeamData.rosters.Penguin.forEach(user => {
      const preReset = preResetTeams[user.toLowerCase()];
      if (preReset && preReset.team === "Reindeer") {
        traitors.push({
          user: user,
          oldTeam: "Reindeer",
          newTeam: "Penguin"
        });
      }
    });

    // Check Reindeer roster for former Penguin
    currentTeamData.rosters.Reindeer.forEach(user => {
      const preReset = preResetTeams[user.toLowerCase()];
      if (preReset && preReset.team === "Penguin") {
        traitors.push({
          user: user,
          oldTeam: "Penguin",
          newTeam: "Reindeer"
        });
      }
    });

    // Sort alphabetically
    return traitors.sort((a, b) => a.user.toLowerCase().localeCompare(b.user.toLowerCase()));
  } catch (err) {
    console.warn("Failed to detect traitors:", err);
    return [];
  }
}

/**
 * Render the traitors panel
 */
async function renderTraitors() {
  const container = document.getElementById("traitorsPanel");
  if (!container) return;

  container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">Loading...</p>`;

  const traitors = await detectTraitors();
  const countEl = document.getElementById("traitorsCount");
  if (countEl) {
    countEl.textContent = `(${traitors.length} found)`;
  }

  if (traitors.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">No team switchers detected.</p>`;
    return;
  }

  // Group by direction
  const toReindeer = traitors.filter(t => t.newTeam === "Reindeer");
  const toPenguin = traitors.filter(t => t.newTeam === "Penguin");

  const rows = traitors.map(t => {
    const arrow = t.oldTeam === "Penguin"
      ? `<span class="pill penguin">Penguin</span> → <span class="pill reindeer">Reindeer</span>`
      : `<span class="pill reindeer">Reindeer</span> → <span class="pill penguin">Penguin</span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(t.user)}</strong></td>
        <td>${arrow}</td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <div class="traitors-summary">
      <span class="traitor-stat">
        <span class="pill reindeer">Reindeer</span> → <span class="pill penguin">Penguin</span>: <strong>${toPenguin.length}</strong>
      </span>
      <span class="traitor-stat">
        <span class="pill penguin">Penguin</span> → <span class="pill reindeer">Reindeer</span>: <strong>${toReindeer.length}</strong>
      </span>
    </div>
    <table>
      <tr>
        <th>User</th>
        <th>Team Change</th>
      </tr>
      ${rows}
    </table>
  `;
}

/**
 * Initialize admin panel visibility
 */
function initAdminPanel() {
  const adminSection = document.getElementById("admin-section");
  if (adminSection) {
    if (isAdminMode()) {
      adminSection.style.display = "block";
      renderCloneDetection();
      renderTraitors();
    } else {
      adminSection.style.display = "none";
    }
  }
}

function buildAttackerBreakdown(events) {
  // Build victim -> attacker -> count mapping (inverse of victim breakdown)
  const breakdown = {};

  events.forEach(e => {
    const attacker = e.attacker;
    const victim = e.victim;
    if (!attacker || !victim) return;

    // Get victim's team from usersIndex if available
    const victimData = state.usersIndex.get(victim);
    const victimTeam = victimData?.team || "Unknown";

    if (!breakdown[victim]) {
      breakdown[victim] = { team: victimTeam, attackers: {}, total: 0 };
    }
    breakdown[victim].attackers[attacker] = (breakdown[victim].attackers[attacker] || 0) + 1;
    breakdown[victim].total++;
  });

  // Convert to array and sort by total hits taken
  return Object.entries(breakdown)
    .map(([victim, data]) => ({
      victim,
      team: data.team,
      total: data.total,
      attackers: Object.entries(data.attackers)
        .map(([attacker, count]) => ({ attacker, count }))
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

function renderAttackerBreakdownTable() {
  const table = document.getElementById("attackerBreakdownTable");
  if (!table) return;

  const search = state.attackerSearch.toLowerCase();
  const teamFilter = state.attackerTeamFilter;

  let filtered = state.attackerBreakdown;

  if (search) {
    filtered = filtered.filter(u => u.victim.toLowerCase().includes(search));
  }
  if (teamFilter !== "All") {
    filtered = filtered.filter(u => u.team === teamFilter);
  }

  const head = `<tr><th>Victim</th><th>Team</th><th>Attackers</th><th>Total Hits Taken</th></tr>`;

  const body = filtered.map((u, idx) => {
    const teamClass = u.team?.toLowerCase() || "";
    const totalAttackers = u.attackers.length;
    const top10Attackers = u.attackers.slice(0, 10);

    const parentRow = `
      <tr class="parent-row" data-idx="${idx}">
        <td>${escapeHtml(u.victim)}</td>
        <td><span class="pill ${teamClass}">${u.team || ""}</span></td>
        <td>${totalAttackers}</td>
        <td>${u.total}</td>
      </tr>
    `;

    const childRows = top10Attackers.map(a => `
      <tr class="child-row" data-parent="${idx}">
        <td>${escapeHtml(a.attacker)}</td>
        <td></td>
        <td></td>
        <td>${a.count}</td>
      </tr>
    `).join("");

    const summaryRow = `
      <tr class="child-row total-row" data-parent="${idx}">
        <td colspan="3">Total: ${totalAttackers} attackers, ${u.total} hits taken</td>
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

  const formatHour = (h) => {
    const hour = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? "AM" : "PM";
    return `${hour}${suffix}`;
  };

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
    html += `<div class="heatmap-label">${formatHour(h)}</div>`;
  }

  // Data rows
  for (let d = 0; d < 7; d++) {
    html += `<div class="heatmap-label">${days[d]}</div>`;
    for (let h = 0; h < 24; h++) {
      const val = matrix[h][d];
      const intensity = maxVal > 0 ? val / maxVal : 0;
      const bg = getHeatmapColor(intensity);
      html += `<div class="heatmap-cell" style="background:${bg};" title="${days[d]} ${formatHour(h)} ET - ${val} attacks"></div>`;
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function populateBattleRoomFilter() {
  const select = document.getElementById("battleRoomFilter");
  if (!select) return;
  const rooms = new Set();
  state.allBattles.forEach(b => rooms.add(b.roomName));
  const sorted = [...rooms].sort();
  let options = '<option value="All">All Rooms</option>';
  sorted.forEach(r => { options += `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`; });
  select.innerHTML = options;
  select.value = state.battleRoomFilter;
}

function formatBattleTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", { timeZoneName: "short" });
}

function renderBattleDetail() {
  const detail = document.getElementById("battleDetail");
  if (!detail) return;
  const battle = state.allBattles.find(b => b.id === state.selectedBattleId);
  if (!battle) {
    detail.innerHTML = '<p class="legend-note" style="margin:0;">Select a battle to see participant stats.</p>';
    return;
  }

  const rows = (battle.participants || []).map(p => `
    <tr>
      <td>${escapeHtml(p.user)}</td>
      <td>${escapeHtml(p.team || "Unknown")}</td>
      <td>${p.attacks}</td>
      <td>${p.hitsTaken}</td>
      <td>${fmt(p.ratio)}</td>
    </tr>
  `).join("");

  detail.innerHTML = `
    <div class="legend-note" style="margin:0 0 6px 0; display:flex; justify-content:space-between; align-items:center; gap:8px;">
      <span>${escapeHtml(battle.roomName)} | ${formatBattleTime(battle.start)} to ${formatBattleTime(battle.end)} | ${battle.hitCount} hits, ${battle.uniqueUsers} users</span>
      <button id="battleDetailClose" class="pill">✕</button>
    </div>
    <div class="scroll" style="max-height:240px;">
      <table class="collapsible-table">
        <thead>
          <tr><th>User</th><th>Team</th><th>Attacks</th><th>Hits Taken</th><th>Ratio</th></tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="5" style="color:var(--text-muted);">No participant data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const closeBtn = detail.querySelector("#battleDetailClose");
  closeBtn?.addEventListener("click", () => {
    state.selectedBattleId = null;
    renderBattlesTable();
  });
}

function getFilteredBattles() {
  const minHits = Number.isFinite(state.battleMinHits) ? state.battleMinHits : 0;
  return state.allBattles.filter(b => {
    if (b.hitCount < minHits) return false;
    if (state.battleRoomFilter !== "All" && b.roomName !== state.battleRoomFilter) return false;
    return true;
  });
}

function renderBattlesTable() {
  const table = document.getElementById("battlesTable");
  if (!table) return;

  populateBattleRoomFilter();

  const minHitsInput = document.getElementById("battleMinHits");
  if (minHitsInput) {
    minHitsInput.value = state.battleMinHits;
  }

  const battles = getFilteredBattles();
  if (!battles.length) {
    table.innerHTML = '<p class="legend-note" style="margin:0;">No battles match the current filters.</p>';
    renderBattleDetail();
    return;
  }

  const rows = battles.map(b => {
    const topAtt = b.topAttackers?.[0];
    const topVict = b.topVictims?.[0];
    const selectedClass = b.id === state.selectedBattleId ? "battle-selected" : "";
    return `
      <tr data-battle="${escapeHtml(b.id)}" class="${selectedClass}">
        <td>${escapeHtml(b.roomName)}</td>
        <td>${formatBattleTime(b.start)}</td>
        <td>${formatBattleTime(b.end)}</td>
        <td>${b.durationMinutes} min</td>
        <td>${b.hitCount}</td>
        <td>${b.uniqueUsers}</td>
        <td>${topAtt ? `${escapeHtml(topAtt.user)} (${topAtt.attacks})` : "-"}</td>
        <td>${topVict ? `${escapeHtml(topVict.user)} (${topVict.hitsTaken})` : "-"}</td>
      </tr>
    `;
  }).join("");

  table.innerHTML = `
    <table class="collapsible-table">
      <thead>
        <tr>
          <th>Room</th>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
          <th>Hits</th>
          <th>Users</th>
          <th>Top Attacker</th>
          <th>Top Victim</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  renderBattleDetail();
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

  // Attacker breakdown table controls
  const attackerSearch = document.getElementById("attackerTableSearch");
  attackerSearch?.addEventListener("input", () => {
    state.attackerSearch = attackerSearch.value || "";
    renderAttackerBreakdownTable();
  });

  const attackerTeamFilter = document.getElementById("attackerTableTeam");
  attackerTeamFilter?.addEventListener("change", () => {
    state.attackerTeamFilter = attackerTeamFilter.value;
    renderAttackerBreakdownTable();
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

  // Refresh button (only works in live mode)
  const refreshBtn = document.getElementById("refreshDataBtn");
  refreshBtn?.addEventListener("click", () => {
    if (state.dataMode === "pre-reset") {
      alert("Refresh is only available in Live mode. Switch to Live mode to fetch fresh data.");
      return;
    }
    refreshFromAPI();
  });

  // Roster search filters
  const penguinRosterSearch = document.getElementById("penguinRosterSearch");
  const reindeerRosterSearch = document.getElementById("reindeerRosterSearch");

  penguinRosterSearch?.addEventListener("input", () => {
    const penguinFilter = penguinRosterSearch.value || "";
    const reindeerFilter = reindeerRosterSearch?.value || "";
    renderTeamRosters(currentTeamData, penguinFilter, reindeerFilter);
  });

  reindeerRosterSearch?.addEventListener("input", () => {
    const penguinFilter = penguinRosterSearch?.value || "";
    const reindeerFilter = reindeerRosterSearch.value || "";
    renderTeamRosters(currentTeamData, penguinFilter, reindeerFilter);
  });

  const battleRoomFilter = document.getElementById("battleRoomFilter");
  battleRoomFilter?.addEventListener("change", () => {
    state.battleRoomFilter = battleRoomFilter.value;
    renderBattlesTable();
  });

  const battleMinHits = document.getElementById("battleMinHits");
  battleMinHits?.addEventListener("input", () => {
    const parsed = parseInt(battleMinHits.value, 10);
    state.battleMinHits = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    renderBattlesTable();
  });

  const battlesTable = document.getElementById("battlesTable");
  battlesTable?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-battle]");
    if (!row) return;
    const id = row.getAttribute("data-battle");
    state.selectedBattleId = state.selectedBattleId === id ? null : id;
    renderBattlesTable();
  });
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

    // Initialize admin panel if in admin mode
    initAdminPanel();

  } catch (err) {
    console.error(err);
    document.getElementById("meta").textContent = `Error: ${err.message}`;
  }
})();
