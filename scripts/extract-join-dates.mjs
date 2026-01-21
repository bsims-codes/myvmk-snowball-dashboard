#!/usr/bin/env node

/**
 * Parses git history of roster.json to find when each user first appeared.
 * Only tracks post-reset users (after 2025-12-18 23:33:32).
 * Outputs a JSON file with user -> { firstSeen, team } mappings.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const ROSTER_FILE_PATH = 'docs/data/roster.json';
const OUTPUT_PATH = 'docs/data/user-join-dates.json';

// Reset cutoff - last event before reset was 2025-12-18 23:33:32
// Only track users who joined AFTER this date
const RESET_CUTOFF = new Date('2025-12-18T23:33:32');

// Get all commits that touched roster.json, oldest first
function getCommits() {
  try {
    const output = execSync(
      `git log --reverse --format="%H %aI" --follow -- ${ROSTER_FILE_PATH}`,
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

// Get roster.json content at a specific commit
function getRosterAtCommit(hash) {
  try {
    const content = execSync(
      `git show ${hash}:${ROSTER_FILE_PATH}`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// Extract users from roster.json format
function extractUsersFromRoster(data) {
  if (!data || !data.rosters) return [];
  const users = [];
  for (const username of (data.rosters.Penguin || [])) {
    users.push({ user: username, team: 'Penguin' });
  }
  for (const username of (data.rosters.Reindeer || [])) {
    users.push({ user: username, team: 'Reindeer' });
  }
  return users;
}

async function main() {
  console.log('Extracting user join dates from roster.json git history...');
  console.log(`Reset cutoff: ${RESET_CUTOFF.toISOString()}`);
  console.log('Only users who joined AFTER this date will be included.\n');

  const commits = getCommits();
  console.log(`Found ${commits.length} roster.json commits to process`);

  if (commits.length === 0) {
    console.log('\nNo roster.json history found. Make sure roster.json has been committed.');
    writeFileSync(OUTPUT_PATH, JSON.stringify({
      generatedAt: new Date().toISOString(),
      resetCutoff: RESET_CUTOFF.toISOString(),
      totalUsers: 0,
      users: []
    }, null, 2));
    return;
  }

  const userFirstSeen = new Map(); // user -> { firstSeen, team }
  let processed = 0;
  let skippedPreReset = 0;

  for (const { hash, date } of commits) {
    processed++;
    const commitDate = new Date(date);

    if (processed % 50 === 0 || processed === commits.length) {
      console.log(`Processing commit ${processed}/${commits.length}...`);
    }

    // Skip commits before reset
    if (commitDate <= RESET_CUTOFF) {
      skippedPreReset++;
      continue;
    }

    const data = getRosterAtCommit(hash);
    const users = extractUsersFromRoster(data);

    for (const { user, team } of users) {
      if (!userFirstSeen.has(user)) {
        userFirstSeen.set(user, { firstSeen: date, team });
      }
    }
  }

  console.log(`\nSkipped ${skippedPreReset} pre-reset commits`);

  // Convert to sorted array (newest first by default for the output)
  const results = Array.from(userFirstSeen.entries())
    .map(([user, data]) => ({
      user,
      firstSeen: data.firstSeen,
      team: data.team
    }))
    .sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen));

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    resetCutoff: RESET_CUTOFF.toISOString(),
    totalUsers: results.length,
    users: results
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone! Found ${results.length} post-reset users.`);
  console.log(`Output written to ${OUTPUT_PATH}`);

  // Show some stats
  const teams = { Reindeer: 0, Penguin: 0 };
  results.forEach(u => teams[u.team]++);
  console.log(`\nTeam breakdown:`);
  console.log(`  Reindeer: ${teams.Reindeer}`);
  console.log(`  Penguin: ${teams.Penguin}`);

  if (results.length > 0) {
    // Show first and last 5 users
    console.log(`\nEarliest 5 users (post-reset):`);
    results.slice(0, 5).forEach(u => {
      console.log(`  ${u.user} (${u.team}) - ${u.firstSeen}`);
    });

    console.log(`\nMost recent 5 users:`);
    results.slice(-5).forEach(u => {
      console.log(`  ${u.user} (${u.team}) - ${u.firstSeen}`);
    });
  }
}

main().catch(console.error);
