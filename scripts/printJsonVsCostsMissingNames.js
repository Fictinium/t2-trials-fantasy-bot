// Script: scripts/printJsonVsCostsMissingNames.js
// Prints all missing names between players.json and player_costs.txt.
//
// Usage:
//   node .\scripts\printJsonVsCostsMissingNames.js
//   node .\scripts\printJsonVsCostsMissingNames.js --json .\players.json --costs .\player_costs.txt --out .\scripts\_json_vs_costs_missing_names.txt

import fs from 'fs';
import path from 'path';

function readArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parsePlayerCosts(text) {
  const lines = text.split(/\r?\n/);
  const teams = new Map(); // normalized team -> original team
  const players = new Map(); // normalized player -> Set(normalized team)
  const teamPlayers = new Map(); // normalized team -> Set(normalized player)

  let currentTeam = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const teamMatch = line.match(/^(.+):$/);
    if (teamMatch) {
      const teamName = teamMatch[1].trim();
      const nTeam = normalize(teamName);
      currentTeam = nTeam;
      teams.set(nTeam, teamName);
      if (!teamPlayers.has(nTeam)) teamPlayers.set(nTeam, new Set());
      continue;
    }

    const playerMatch = line.match(/^(.+?)\s*-\s*(\d+)\s*$/);
    if (playerMatch && currentTeam) {
      const playerName = playerMatch[1].trim();
      const nName = normalize(playerName);
      if (!players.has(nName)) players.set(nName, new Set());
      players.get(nName).add(currentTeam);
      teamPlayers.get(currentTeam).add(nName);
    }
  }

  return { teams, players, teamPlayers };
}

function parsePlayersJson(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : (Array.isArray(raw.players) ? raw.players
      : Array.isArray(raw.data) ? raw.data
      : Array.isArray(raw.payload) ? raw.payload
      : Array.isArray(raw.stats) ? raw.stats
      : null);

  if (!arr) {
    throw new Error('Invalid players JSON root. Expected array or object with players/data/payload/stats array.');
  }

  const teams = new Map(); // normalized team -> original team
  const players = new Map(); // normalized player -> { name, teams:Set(normalized team), ids:Set(number|null) }
  const pairs = []; // { id, name, team, nName, nTeam }

  for (const p of arr) {
    const name = String(p?.name ?? '').trim();
    const team = String(p?.team_name ?? '').trim();
    const idRaw = Number(p?.id);
    const id = Number.isFinite(idRaw) ? idRaw : null;

    const nName = normalize(name);
    const nTeam = normalize(team);

    if (team) teams.set(nTeam, team);

    if (name) {
      if (!players.has(nName)) {
        players.set(nName, { name, teams: new Set(), ids: new Set() });
      }
      players.get(nName).teams.add(nTeam);
      players.get(nName).ids.add(id);
    }

    pairs.push({ id, name, team, nName, nTeam });
  }

  return { arr, teams, players, pairs };
}

function main() {
  const jsonPath = path.resolve(process.cwd(), readArg('--json', '.\\players.json'));
  const costsPath = path.resolve(process.cwd(), readArg('--costs', '.\\player_costs.txt'));
  const outPath = path.resolve(process.cwd(), readArg('--out', '.\\scripts\\_json_vs_costs_missing_names.txt'));

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file not found: ${jsonPath}`);
  }
  if (!fs.existsSync(costsPath)) {
    throw new Error(`Costs file not found: ${costsPath}`);
  }

  const jsonRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const costsRaw = fs.readFileSync(costsPath, 'utf8');

  const costs = parsePlayerCosts(costsRaw);
  const j = parsePlayersJson(jsonRaw);

  const missingTeams = [];
  for (const [nTeam, teamName] of j.teams.entries()) {
    if (!costs.teams.has(nTeam)) missingTeams.push(teamName);
  }
  missingTeams.sort((a, b) => a.localeCompare(b));

  const missingPlayerNamesWithTeams = [];
  for (const [nName, info] of j.players.entries()) {
    if (costs.players.has(nName)) continue;
    const teams = [...info.teams]
      .map(t => j.teams.get(t) || t)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const ids = [...info.ids].filter(v => v !== null).sort((a, b) => a - b);
    missingPlayerNamesWithTeams.push({
      name: info.name,
      teams,
      ids
    });
  }
  missingPlayerNamesWithTeams.sort((a, b) => a.name.localeCompare(b.name));

  const missingPlayerTeamPairs = [];
  for (const row of j.pairs) {
    const teamsForName = costs.players.get(row.nName);
    if (!teamsForName || !teamsForName.has(row.nTeam)) {
      missingPlayerTeamPairs.push({
        id: row.id,
        name: row.name,
        team: row.team
      });
    }
  }
  missingPlayerTeamPairs.sort((a, b) => {
    const byTeam = (a.team || '').localeCompare(b.team || '');
    if (byTeam !== 0) return byTeam;
    return (a.name || '').localeCompare(b.name || '');
  });

  const lines = [];
  lines.push('JSON vs player_costs Missing Names Report');
  lines.push('');
  lines.push(`JSON file: ${jsonPath}`);
  lines.push(`Costs file: ${costsPath}`);
  lines.push('');
  lines.push('Summary');
  lines.push(`- JSON rows: ${j.arr.length}`);
  lines.push(`- JSON unique teams: ${j.teams.size}`);
  lines.push(`- JSON unique player names: ${j.players.size}`);
  lines.push(`- Costs teams: ${costs.teams.size}`);
  lines.push(`- Costs unique player names: ${costs.players.size}`);
  lines.push('');
  lines.push(`Missing team names in costs: ${missingTeams.length}`);
  lines.push(`Missing player names in costs (with JSON teams): ${missingPlayerNamesWithTeams.length}`);
  lines.push(`Missing player-team pairs in costs: ${missingPlayerTeamPairs.length}`);
  lines.push('');

  lines.push('=== Missing Team Names (present in JSON, absent in player_costs) ===');
  if (!missingTeams.length) {
    lines.push('(none)');
  } else {
    for (const teamName of missingTeams) {
      lines.push(`- ${teamName}`);
    }
  }
  lines.push('');

  lines.push('=== Missing Player Names (present in JSON, absent in player_costs) ===');
  if (!missingPlayerNamesWithTeams.length) {
    lines.push('(none)');
  } else {
    const byTeam = new Map(); // team -> ["name (ids=...)"]
    for (const item of missingPlayerNamesWithTeams) {
      const idsText = item.ids.length ? ` (ids=${item.ids.join(',')})` : '';
      const label = `${item.name}${idsText}`;
      for (const teamName of item.teams) {
        if (!byTeam.has(teamName)) byTeam.set(teamName, []);
        byTeam.get(teamName).push(label);
      }
    }

    const sortedTeams = [...byTeam.keys()].sort((a, b) => a.localeCompare(b));
    for (const teamName of sortedTeams) {
      const players = [...new Set(byTeam.get(teamName))].sort((a, b) => a.localeCompare(b));
      lines.push(`- ${teamName}: ${players.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('=== Missing Player-Team Pairs (JSON pair not found in player_costs) ===');
  if (!missingPlayerTeamPairs.length) {
    lines.push('(none)');
  } else {
    for (const row of missingPlayerTeamPairs) {
      const idText = row.id !== null ? `id=${row.id} ` : '';
      lines.push(`- ${idText}${row.name} @ ${row.team}`);
    }
  }
  lines.push('');

  const output = lines.join('\n');
  fs.writeFileSync(outPath, output, 'utf8');

  console.log(output);
  console.log(`\nFull text report written to: ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
