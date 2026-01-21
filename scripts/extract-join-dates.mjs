#!/usr/bin/env node

/**
 * Parses git history to find when each user first appeared in the roster.
 * Outputs a JSON file with user -> { firstSeen, team } mappings.
 *
 * Checks both:
 *   - docs/data/roster.json (full team roster from API - preferred)
 *   - docs/data/users.json (participants only - fallback)
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const ROSTER_FILE_PATH = 'docs/data/roster.json';
const USERS_FILE_PATH = 'docs/data/users.json';
const OUTPUT_PATH = 'docs/data/user-join-dates.json';

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

// Extract users from users.json format (array of user objects)
function extractUsersFromUsersJson(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.map(u => ({ user: u.user, team: u.team }));
}

async function main() {
  const userFirstSeen = new Map(); // user -> { firstSeen, team, source }

  // First, process roster.json (full team roster - preferred source)
  console.log('Checking roster.json history...');
  const rosterCommits = getCommits(ROSTER_FILE_PATH);
  console.log(`Found ${rosterCommits.length} roster.json commits`);

  let processed = 0;
  for (const { hash, date } of rosterCommits) {
    processed++;
    if (processed % 50 === 0 || processed === rosterCommits.length) {
      console.log(`Processing roster commit ${processed}/${rosterCommits.length}...`);
    }

    const data = getFileAtCommit(hash, ROSTER_FILE_PATH);
    const users = extractUsersFromRoster(data);

    for (const { user, team } of users) {
      if (!userFirstSeen.has(user)) {
        userFirstSeen.set(user, { firstSeen: date, team, source: 'roster' });
      }
    }
  }

  const rosterUsers = userFirstSeen.size;
  console.log(`Found ${rosterUsers} users from roster.json\n`);

  // Then, process users.json (participants only - fallback for historical data)
  console.log('Checking users.json history...');
  const usersCommits = getCommits(USERS_FILE_PATH);
  console.log(`Found ${usersCommits.length} users.json commits`);

  processed = 0;
  for (const { hash, date } of usersCommits) {
    processed++;
    if (processed % 50 === 0 || processed === usersCommits.length) {
      console.log(`Processing users commit ${processed}/${usersCommits.length}...`);
    }

    const data = getFileAtCommit(hash, USERS_FILE_PATH);
    const users = extractUsersFromUsersJson(data);

    for (const { user, team } of users) {
      if (!userFirstSeen.has(user)) {
        userFirstSeen.set(user, { firstSeen: date, team, source: 'participants' });
      }
    }
  }

  const participantOnlyUsers = userFirstSeen.size - rosterUsers;
  console.log(`Found ${participantOnlyUsers} additional users from users.json\n`);

  // Convert to sorted array
  const results = Array.from(userFirstSeen.entries())
    .map(([user, data]) => ({
      user,
      firstSeen: data.firstSeen,
      team: data.team,
      source: data.source  // 'roster' or 'participants'
    }))
    .sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen));

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    totalUsers: results.length,
    users: results
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone! Found ${results.length} unique users.`);
  console.log(`Output written to ${OUTPUT_PATH}`);

  // Show some stats
  const teams = { Reindeer: 0, Penguin: 0 };
  results.forEach(u => teams[u.team]++);
  console.log(`\nTeam breakdown (at time of first appearance):`);
  console.log(`  Reindeer: ${teams.Reindeer}`);
  console.log(`  Penguin: ${teams.Penguin}`);

  // Show first and last 5 users
  console.log(`\nFirst 5 users seen:`);
  results.slice(0, 5).forEach(u => {
    console.log(`  ${u.user} (${u.team}) - ${u.firstSeen}`);
  });

  console.log(`\nMost recent 5 users:`);
  results.slice(-5).forEach(u => {
    console.log(`  ${u.user} (${u.team}) - ${u.firstSeen}`);
  });
}

main().catch(console.error);
