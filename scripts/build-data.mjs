import fs from "fs";
import path from "path";

const HITS_URL = "https://www.myvmk.com/api/gethits";
const TEAMS_URL = "https://www.myvmk.com/api/getsnowteams";

function loadJSON(relPath, fallback = {}) {
  const p = path.join(process.cwd(), relPath);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Basic CSV parser that handles quoted fields.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function normUser(u) {
  return (u ?? "").toString().trim();
}

function normRoomId(r) {
  return (r ?? "").toString().trim();
}

function safeRatio(attacks, hitsTaken) {
  if (!hitsTaken) return attacks ? attacks / 1 : 0;
  return attacks / hitsTaken;
}

/**
 * Fetch team assignments from the official API.
 * CSV format: Username,Team (0=Reindeer, 1=Penguin)
 */
async function fetchTeamsFromAPI() {
  console.log("Fetching teams from", TEAMS_URL);

  const res = await fetch(TEAMS_URL);
  if (!res.ok) {
    console.warn(`Warning: Could not fetch teams API (HTTP ${res.status}), will use fallback`);
    return null;
  }

  const csvText = await res.text();
  const parsed = parseCSV(csvText);

  if (parsed.length < 2) {
    console.warn("Warning: Teams API returned no data");
    return null;
  }

  const headers = parsed[0];
  const dataRows = parsed.slice(1);

  // Find column indices
  const usernameIdx = headers.findIndex(h => h.toLowerCase() === "username");
  const teamIdx = headers.findIndex(h => h.toLowerCase() === "team");

  if (usernameIdx === -1 || teamIdx === -1) {
    console.warn("Warning: Teams API CSV missing expected columns");
    return null;
  }

  const teamMap = {};
  for (const row of dataRows) {
    const username = normUser(row[usernameIdx]);
    const teamValue = row[teamIdx]?.trim();

    if (!username) continue;

    // 0 = Reindeer, 1 = Penguin
    if (teamValue === "0") {
      teamMap[username] = "Reindeer";
    } else if (teamValue === "1") {
      teamMap[username] = "Penguin";
    }
  }

  console.log(`Loaded ${Object.keys(teamMap).length} team assignments from API`);
  return teamMap;
}

function topN(map, n, keyName, valName) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ [keyName]: k, [valName]: v }));
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = (n * sumXX - sumX * sumX);
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

async function main() {
  console.log("Fetching hits data from", HITS_URL);

  const roomsMap = loadJSON("docs/data/rooms.json", {});

  // Fetch teams from API (authoritative source)
  const apiTeams = await fetchTeamsFromAPI();

  // Use API teams, or empty if API failed
  const teamMap = apiTeams || {};

  console.log(`Loaded ${Object.keys(roomsMap).length} room mappings`);

  const res = await fetch(HITS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csvText = await res.text();

  const parsed = parseCSV(csvText);
  const headers = parsed[0];
  const dataRows = parsed.slice(1);

  console.log(`Parsed ${dataRows.length} hit events`);

  const rawRows = dataRows.map(cols => {
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
    return obj;
  });

  // Convert to base events
  const baseEvents = rawRows.map(r => {
    const attacker = normUser(r.Attacker);
    const victim = normUser(r.Victim);
    const roomId = normRoomId(r.Room);
    const value = Number(r.Value || 0);

    return {
      time: (r.Time ?? "").toString().trim(),
      attacker,
      victim,
      roomId,
      roomName: roomsMap[roomId] || roomId || "Unknown",
      value
    };
  });

  // Collect all users from events
  const allUsersSet = new Set();
  for (const e of baseEvents) {
    if (e.attacker) allUsersSet.add(e.attacker);
    if (e.victim) allUsersSet.add(e.victim);
  }

  // Assign teams - anyone not in API gets "Unknown"
  const resolvedTeams = {};
  for (const user of allUsersSet) {
    resolvedTeams[user] = teamMap[user] || "Unknown";
  }

  const teamCounts = { Penguin: 0, Reindeer: 0, Unknown: 0 };
  for (const team of Object.values(resolvedTeams)) {
    teamCounts[team] = (teamCounts[team] || 0) + 1;
  }
  console.log(`Team assignments: Penguin=${teamCounts.Penguin}, Reindeer=${teamCounts.Reindeer}, Unknown=${teamCounts.Unknown}`);

  // Enrich events with resolved teams
  const events = baseEvents.map(e => ({
    ...e,
    attackerTeam: resolvedTeams[e.attacker] || "Unknown",
    victimTeam: resolvedTeams[e.victim] || "Unknown"
  }));

  // --- USER AGGREGATES ---
  const attacksByUser = new Map();
  const hitsTakenByUser = new Map();

  // Room-level per-user counts (for avg ratio per room)
  const roomUser = new Map();

  // Room totals
  const roomHitCounts = new Map();

  // Team-vs-team
  const teamVsTeam = new Map();

  for (const e of events) {
    if (e.attacker) attacksByUser.set(e.attacker, (attacksByUser.get(e.attacker) || 0) + 1);
    if (e.victim) hitsTakenByUser.set(e.victim, (hitsTakenByUser.get(e.victim) || 0) + 1);

    roomHitCounts.set(e.roomName, (roomHitCounts.get(e.roomName) || 0) + 1);

    // room per-user
    if (!roomUser.has(e.roomName)) roomUser.set(e.roomName, new Map());
    const ru = roomUser.get(e.roomName);
    if (e.attacker) {
      if (!ru.has(e.attacker)) ru.set(e.attacker, { attacks: 0, hitsTaken: 0 });
      ru.get(e.attacker).attacks++;
    }
    if (e.victim) {
      if (!ru.has(e.victim)) ru.set(e.victim, { attacks: 0, hitsTaken: 0 });
      ru.get(e.victim).hitsTaken++;
    }

    // team vs team (only if both known)
    const at = e.attackerTeam;
    const vt = e.victimTeam;
    if (at !== "Unknown" && vt !== "Unknown") {
      const key = `${at} → ${vt}`;
      teamVsTeam.set(key, (teamVsTeam.get(key) || 0) + 1);
    }
  }

  // Build users list (ALL users)
  const allUsers = new Set([...attacksByUser.keys(), ...hitsTakenByUser.keys()]);
  const users = [...allUsers].map(user => {
    const attacks = attacksByUser.get(user) || 0;
    const hitsTaken = hitsTakenByUser.get(user) || 0;
    const ratio = safeRatio(attacks, hitsTaken);
    const team = resolvedTeams[user] || "Unknown";

    return {
      user,
      team,
      attacks,
      hitsTaken,
      ratio
    };
  }).sort((a, b) => b.attacks - a.attacks);

  // Scatter points for chart (top N by activity)
  const totals = new Map();
  for (const u of allUsers) totals.set(u, (attacksByUser.get(u) || 0) + (hitsTakenByUser.get(u) || 0));
  const topUsersList = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 500).map(x => x[0]);

  const scatterPoints = topUsersList.map(u => ({
    user: u,
    team: resolvedTeams[u] || "Unknown",
    attacks: attacksByUser.get(u) || 0,
    hitsTaken: hitsTakenByUser.get(u) || 0,
    ratio: safeRatio(attacksByUser.get(u) || 0, hitsTakenByUser.get(u) || 0)
  }));

  // Regression lines (overall + per team) based on scatterPoints
  const overallPts = scatterPoints.map(p => ({ x: p.attacks, y: p.hitsTaken }));
  const overallReg = linearRegression(overallPts);

  const pengPts = scatterPoints.filter(p => p.team === "Penguin").map(p => ({ x: p.attacks, y: p.hitsTaken }));
  const reinPts = scatterPoints.filter(p => p.team === "Reindeer").map(p => ({ x: p.attacks, y: p.hitsTaken }));
  const pengReg = linearRegression(pengPts);
  const reinReg = linearRegression(reinPts);

  const xMin = Math.min(...overallPts.map(p => p.x), 0);
  const xMax = Math.max(...overallPts.map(p => p.x), 1);

  function regLine(reg, label) {
    if (!reg) return null;
    const y1 = reg.slope * xMin + reg.intercept;
    const y2 = reg.slope * xMax + reg.intercept;
    return { slope: reg.slope, intercept: reg.intercept, xMin, xMax, y1, y2, label };
  }

  // Room summaries: hits per room + avg user ratio (within that room)
  const roomsSummary = [...roomHitCounts.entries()]
    .map(([roomName, hitCount]) => {
      const perUser = roomUser.get(roomName) || new Map();
      const ratios = [];

      for (const [_u, c] of perUser.entries()) {
        if (c.attacks === 0 && c.hitsTaken === 0) continue;
        ratios.push(safeRatio(c.attacks, c.hitsTaken));
      }

      const avgUserRatio = ratios.length ? (ratios.reduce((a, b) => a + b, 0) / ratios.length) : 0;

      return { roomName, hitCount, avgUserRatio: Math.round(avgUserRatio * 100) / 100, activeUsers: ratios.length };
    })
    .sort((a, b) => b.hitCount - a.hitCount);

  // Team stats summary
  const teamStats = {
    Penguin: { users: 0, attacks: 0, hitsTaken: 0 },
    Reindeer: { users: 0, attacks: 0, hitsTaken: 0 },
    Unknown: { users: 0, attacks: 0, hitsTaken: 0 }
  };

  for (const u of users) {
    const ts = teamStats[u.team] || teamStats.Unknown;
    ts.users++;
    ts.attacks += u.attacks;
    ts.hitsTaken += u.hitsTaken;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalRows: events.length,
    totalUsers: users.length,

    teamStats,
    teamVsTeam: topN(teamVsTeam, 12, "pair", "count"),

    // For quick widgets
    topAttackers: users.slice(0, 25).map(u => ({ user: u.user, attacks: u.attacks, team: u.team })),
    topVictims: [...users].sort((a, b) => b.hitsTaken - a.hitsTaken).slice(0, 25)
      .map(u => ({ user: u.user, hitsTaken: u.hitsTaken, team: u.team })),

    scatterPoints,
    regression: {
      overall: regLine(overallReg, "All"),
      penguin: regLine(pengReg, "Penguin"),
      reindeer: regLine(reinReg, "Reindeer")
    },

    topRooms: roomsSummary.slice(0, 25)
  };

  // Write output files
  const outDir = path.join(process.cwd(), "docs", "data");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "events.json"), JSON.stringify(events, null, 2));
  fs.writeFileSync(path.join(outDir, "users.json"), JSON.stringify(users, null, 2));
  fs.writeFileSync(path.join(outDir, "rooms_summary.json"), JSON.stringify(roomsSummary, null, 2));
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log("\nOutput files written:");
  console.log("  - docs/data/events.json");
  console.log("  - docs/data/users.json");
  console.log("  - docs/data/rooms_summary.json");
  console.log("  - docs/data/summary.json");
  console.log("\nBuild complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
