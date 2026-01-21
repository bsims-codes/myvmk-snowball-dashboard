#!/usr/bin/env node

/**
 * Parses git history to find when each user was first seen on their CURRENT team.
 * Only tracks post-reset users (after 2025-12-18 23:33:32).
 *
 * Logic:
 *   1. Get current team assignments from roster.json
 *   2. Scan users.json history to find when user first appeared with that team
 *   3. Fall back to roster.json creation date for users who never participated
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const USERS_FILE_PATH = 'docs/data/users.json';
const ROSTER_FILE_PATH = 'docs/data/roster.json';
const OUTPUT_PATH = 'docs/data/user-join-dates.json';

// Reset cutoff - last event before reset was 2025-12-18 23:33:32
const RESET_CUTOFF = new Date('2025-12-18T23:33:32');

// Get all commits that touched a file, oldest first
function getCommits(filePath) {
  try {
    const output = execSync(
      `git log --reverse --format="%H %aI" --follow -- ${filePath}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    if (!output.trim()) return [];

    return output.trim().split('\n').map(line => {
      const [hash, ...dateParts] = line.split(' ');
      return { hash, date: dateParts.join(' ') };
    });
  } catch (e) {
    return [];
  }
}

// Get file content at a specific commit
function getFileAtCommit(hash, filePath) {
  try {
    const content = execSync(
      `git show ${hash}:${filePath}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// Load current roster to get current team assignments
function loadCurrentRoster() {
  try {
    const content = readFileSync(ROSTER_FILE_PATH, 'utf-8');
    const data = JSON.parse(content);
    const teamMap = new Map();

    for (const username of (data.rosters?.Penguin || [])) {
      teamMap.set(username.toLowerCase(), { user: username, team: 'Penguin' });
    }
    for (const username of (data.rosters?.Reindeer || [])) {
      teamMap.set(username.toLowerCase(), { user: username, team: 'Reindeer' });
    }
    return teamMap;
  } catch (e) {
    console.error('Failed to load current roster:', e.message);
    return new Map();
  }
}

// Extract users from users.json format
function extractUsersFromUsersJson(data) {
  if (!data || !Array.isArray(data)) return [];
  return data
    .filter(u => u.user && u.team && u.team !== 'Unknown')
    .map(u => ({ user: u.user, team: u.team }));
}

async function main() {
  console.log('Extracting user join dates from git history...');
  console.log(`Reset cutoff: ${RESET_CUTOFF.toISOString()}`);
  console.log('Tracking when users first appeared on their CURRENT team.\n');

  // Load current team assignments
  const currentTeams = loadCurrentRoster();
  console.log(`Loaded ${currentTeams.size} users from current roster\n`);

  if (currentTeams.size === 0) {
    console.error('No roster data found. Run build-data.mjs first.');
    process.exit(1);
  }

  const userFirstSeen = new Map(); // user -> { firstSeen, team, source }

  // Process users.json history
  console.log('=== Processing users.json history ===');
  const usersCommits = getCommits(USERS_FILE_PATH);
  console.log(`Found ${usersCommits.length} commits to process`);

  let processed = 0;
  let skippedPreReset = 0;

  for (const { hash, date } of usersCommits) {
    processed++;
    const commitDate = new Date(date);

    if (processed % 100 === 0 || processed === usersCommits.length) {
      console.log(`Processing commit ${processed}/${usersCommits.length}...`);
    }

    // Skip commits before reset
    if (commitDate <= RESET_CUTOFF) {
      skippedPreReset++;
      continue;
    }

    const data = getFileAtCommit(hash, USERS_FILE_PATH);
    const users = extractUsersFromUsersJson(data);

    for (const { user, team } of users) {
      const userKey = user.toLowerCase();
      const currentTeamData = currentTeams.get(userKey);

      // Only record if:
      // 1. User is in current roster
      // 2. Team matches their CURRENT team
      // 3. We haven't recorded them yet
      if (currentTeamData && team === currentTeamData.team && !userFirstSeen.has(userKey)) {
        userFirstSeen.set(userKey, {
          user: currentTeamData.user, // Use canonical name from roster
          firstSeen: date,
          team: team,
          source: 'participants'
        });
      }
    }
  }

  console.log(`Skipped ${skippedPreReset} pre-reset commits`);
  console.log(`Found ${userFirstSeen.size} users with participation history on current team\n`);

  // Fill in remaining users from roster (never participated or team changed)
  console.log('=== Adding users without participation history ===');
  const rosterCommits = getCommits(ROSTER_FILE_PATH);
  const rosterDate = rosterCommits.length > 0 ? rosterCommits[0].date : new Date().toISOString();

  let addedFromRoster = 0;
  for (const [userKey, data] of currentTeams) {
    if (!userFirstSeen.has(userKey)) {
      userFirstSeen.set(userKey, {
        user: data.user,
        firstSeen: rosterDate,
        team: data.team,
        source: 'roster'
      });
      addedFromRoster++;
    }
  }

  console.log(`Added ${addedFromRoster} users from roster (no participation on current team)\n`);

  // Convert to sorted array
  const results = Array.from(userFirstSeen.values())
    .sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen));

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    resetCutoff: RESET_CUTOFF.toISOString(),
    totalUsers: results.length,
    fromParticipants: results.filter(u => u.source === 'participants').length,
    fromRosterOnly: results.filter(u => u.source === 'roster').length,
    users: results
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Done! Found ${results.length} users.`);
  console.log(`  - ${output.fromParticipants} with participation history on current team`);
  console.log(`  - ${output.fromRosterOnly} from roster only (no history on current team)`);
  console.log(`Output written to ${OUTPUT_PATH}`);

  // Show some stats
  const teams = { Reindeer: 0, Penguin: 0 };
  results.forEach(u => teams[u.team]++);
  console.log(`\nTeam breakdown:`);
  console.log(`  Reindeer: ${teams.Reindeer}`);
  console.log(`  Penguin: ${teams.Penguin}`);

  if (results.length > 0) {
    console.log(`\nEarliest 5 users on current team:`);
    results.slice(0, 5).forEach(u => {
      console.log(`  ${u.user} (${u.team}) - ${u.firstSeen} [${u.source}]`);
    });

    console.log(`\nMost recent 5 users:`);
    results.slice(-5).forEach(u => {
      console.log(`  ${u.user} (${u.team}) - ${u.firstSeen} [${u.source}]`);
    });

    // Check for bsims specifically
    const bsims = results.find(u => u.user.toLowerCase() === 'bsims');
    if (bsims) {
      console.log(`\nbsims: ${bsims.team} - first seen ${bsims.firstSeen} [${bsims.source}]`);
    }
  }
}

main().catch(console.error);
