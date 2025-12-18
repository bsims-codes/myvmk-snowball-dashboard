import fs from "fs";
import path from "path";

const URL = "https://www.myvmk.com/api/gethits";

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

function opposite(team) {
  if (team === "Reindeer") return "Penguin";
  if (team === "Penguin") return "Reindeer";
  return "Unknown";
}

/**
 * BFS-based team inference with conflict detection.
 *
 * Two-team assumption: for each hit, attacker and victim should be opposite teams.
 * Seed with teams.json, then propagate labels across the attacker↔victim "opposite" edges.
 *
 * Returns:
 * - teamMap: { user: "Penguin" | "Reindeer" | "Unknown" }
 * - conflicts: [{ user1, team1, user2, team2, expected, edge }]
 * - confidence: { user: 0..1 }
 * - inferenceSource: { user: "seeded" | "inferred" }
 */
function inferTeamsWithBFS(events, seedTeams) {
  // Build adjacency list: user -> Map<opponent, count>
  const adj = new Map();

  const addEdge = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a).set(b, (adj.get(a).get(b) || 0) + 1);
    adj.get(b).set(a, (adj.get(b).get(a) || 0) + 1);
  };

  // Collect all users
  const allUsers = new Set();
  for (const e of events) {
    if (e.attacker) {
      allUsers.add(e.attacker);
      if (e.victim) addEdge(e.attacker, e.victim);
    }
    if (e.victim) allUsers.add(e.victim);
  }

  // Initialize team assignments from seed
  const teamOf = new Map();
  const inferenceSource = new Map(); // "seeded" or "inferred"
  const confidence = new Map();
  const conflicts = [];

  // Track evidence for inferred users: { penguinVotes, reindeerVotes }
  const evidence = new Map();

  // Seed known teams
  for (const [user, team] of Object.entries(seedTeams)) {
    if (team === "Penguin" || team === "Reindeer") {
      teamOf.set(user, team);
      inferenceSource.set(user, "seeded");
      confidence.set(user, 1.0);
    }
  }

  // BFS queue: start with all seeded users
  const queue = [...teamOf.keys()];
  const visited = new Set(queue);

  while (queue.length > 0) {
    const u = queue.shift();
    const ut = teamOf.get(u);
    const neighbors = adj.get(u);

    if (!neighbors) continue;

    for (const [v, edgeCount] of neighbors.entries()) {
      const expectedTeam = opposite(ut);
      const currentTeam = teamOf.get(v);

      if (!currentTeam) {
        // User not yet assigned - infer from neighbor
        teamOf.set(v, expectedTeam);
        inferenceSource.set(v, "inferred");

        // Track evidence
        if (!evidence.has(v)) evidence.set(v, { penguinVotes: 0, reindeerVotes: 0, totalEdges: 0 });
        const ev = evidence.get(v);
        if (expectedTeam === "Penguin") ev.penguinVotes += edgeCount;
        else ev.reindeerVotes += edgeCount;
        ev.totalEdges += edgeCount;

        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      } else if (currentTeam !== expectedTeam) {
        // Conflict detected
        // Only record conflict if at least one is seeded, or both are inferred but disagree
        const uSource = inferenceSource.get(u);
        const vSource = inferenceSource.get(v);

        conflicts.push({
          user1: u,
          team1: ut,
          source1: uSource,
          user2: v,
          team2: currentTeam,
          source2: vSource,
          expected: expectedTeam,
          edgeCount,
          description: `${u} (${ut}, ${uSource}) hit/was hit by ${v} (${currentTeam}, ${vSource}), expected ${v} to be ${expectedTeam}`
        });
      } else {
        // Agreement - add more evidence
        if (inferenceSource.get(v) === "inferred") {
          if (!evidence.has(v)) evidence.set(v, { penguinVotes: 0, reindeerVotes: 0, totalEdges: 0 });
          const ev = evidence.get(v);
          if (expectedTeam === "Penguin") ev.penguinVotes += edgeCount;
          else ev.reindeerVotes += edgeCount;
          ev.totalEdges += edgeCount;
        }
      }
    }
  }

  // Calculate confidence for inferred users
  for (const [user, ev] of evidence.entries()) {
    if (inferenceSource.get(user) === "inferred") {
      const total = ev.penguinVotes + ev.reindeerVotes;
      if (total === 0) {
        confidence.set(user, 0);
        continue;
      }

      const majority = Math.max(ev.penguinVotes, ev.reindeerVotes);
      const margin = Math.abs(ev.penguinVotes - ev.reindeerVotes);

      // Confidence based on:
      // 1. Margin of agreement (how consistent is the evidence)
      // 2. Total evidence (more edges = more confidence)
      const marginRatio = margin / total;
      const evidenceBonus = Math.min(1, total / 20); // Cap at 20 edges for full bonus

      // Combined confidence: average of margin ratio and evidence bonus
      const conf = (marginRatio * 0.6 + evidenceBonus * 0.4);
      confidence.set(user, Math.round(conf * 100) / 100);
    }
  }

  // Check for users with conflicting evidence and potentially reassign
  for (const [user, ev] of evidence.entries()) {
    if (inferenceSource.get(user) === "inferred") {
      const assignedTeam = teamOf.get(user);
      const penguinVotes = ev.penguinVotes;
      const reindeerVotes = ev.reindeerVotes;

      // If votes are heavily against the assigned team, flag as conflict
      if (assignedTeam === "Penguin" && reindeerVotes > penguinVotes * 2) {
        conflicts.push({
          user1: user,
          team1: assignedTeam,
          source1: "inferred",
          user2: null,
          team2: null,
          source2: null,
          expected: "Reindeer",
          edgeCount: reindeerVotes,
          description: `${user} was inferred as Penguin but ${reindeerVotes} edges suggest Reindeer (only ${penguinVotes} suggest Penguin)`
        });
      } else if (assignedTeam === "Reindeer" && penguinVotes > reindeerVotes * 2) {
        conflicts.push({
          user1: user,
          team1: assignedTeam,
          source1: "inferred",
          user2: null,
          team2: null,
          source2: null,
          expected: "Penguin",
          edgeCount: penguinVotes,
          description: `${user} was inferred as Reindeer but ${penguinVotes} edges suggest Penguin (only ${reindeerVotes} suggest Reindeer)`
        });
      }
    }
  }

  // Assign "Unknown" to any remaining users
  for (const user of allUsers) {
    if (!teamOf.has(user)) {
      teamOf.set(user, "Unknown");
      confidence.set(user, 0);
      inferenceSource.set(user, "unknown");
    }
  }

  return {
    teamMap: Object.fromEntries(teamOf),
    conflicts,
    confidence: Object.fromEntries(confidence),
    inferenceSource: Object.fromEntries(inferenceSource)
  };
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
  console.log("Fetching data from", URL);

  const roomsMap = loadJSON("docs/data/rooms.json", {});
  const seedTeams = loadJSON("docs/data/teams.json", {});

  console.log(`Loaded ${Object.keys(roomsMap).length} room mappings`);
  console.log(`Loaded ${Object.keys(seedTeams).length} seeded team assignments`);

  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csvText = await res.text();

  const parsed = parseCSV(csvText);
  const headers = parsed[0];
  const dataRows = parsed.slice(1);

  console.log(`Parsed ${dataRows.length} data rows`);

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

  // Run BFS team inference
  console.log("Running BFS team inference...");
  const inference = inferTeamsWithBFS(baseEvents, seedTeams);
  const { teamMap, conflicts, confidence, inferenceSource } = inference;

  const teamCounts = { Penguin: 0, Reindeer: 0, Unknown: 0 };
  for (const team of Object.values(teamMap)) {
    teamCounts[team] = (teamCounts[team] || 0) + 1;
  }
  console.log(`Team assignments: Penguin=${teamCounts.Penguin}, Reindeer=${teamCounts.Reindeer}, Unknown=${teamCounts.Unknown}`);
  console.log(`Found ${conflicts.length} conflicts`);

  // Enrich events with resolved teams
  const events = baseEvents.map(e => ({
    ...e,
    attackerTeam: teamMap[e.attacker] || "Unknown",
    victimTeam: teamMap[e.victim] || "Unknown"
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
    const team = teamMap[user] || "Unknown";
    const teamConfidence = confidence[user] ?? 0;
    const source = inferenceSource[user] || "unknown";

    return {
      user,
      team,
      teamConfidence,
      teamSource: source,
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
    team: teamMap[u] || "Unknown",
    teamConfidence: confidence[u] ?? 0,
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

    topRooms: roomsSummary.slice(0, 25),

    conflictCount: conflicts.length
  };

  // Write output files
  const outDir = path.join(process.cwd(), "docs", "data");
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "events.json"), JSON.stringify(events, null, 2));
  fs.writeFileSync(path.join(outDir, "users.json"), JSON.stringify(users, null, 2));
  fs.writeFileSync(path.join(outDir, "rooms_summary.json"), JSON.stringify(roomsSummary, null, 2));
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, "team_conflicts.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalConflicts: conflicts.length,
    conflicts: conflicts.slice(0, 500) // Limit to 500 for readability
  }, null, 2));

  console.log("\nOutput files written:");
  console.log("  - docs/data/events.json");
  console.log("  - docs/data/users.json");
  console.log("  - docs/data/rooms_summary.json");
  console.log("  - docs/data/summary.json");
  console.log("  - docs/data/team_conflicts.json");
  console.log("\nBuild complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
