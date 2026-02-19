// Script to convert structured match text and player_ids.txt to JSON for fantasy league bot
// Usage: node scripts/convertMatchTextToJson.js <input.txt> <output.json>


import fs from 'fs';
import path from 'path';

// Prepare unmatched player log
const unmatchedLogPath = path.resolve('unmatched_players.log');
fs.writeFileSync(unmatchedLogPath, '', 'utf8'); // clear log at start

// Read player_ids.txt and build a mapping
const playerIdsPath = path.resolve('player_ids.txt');
const playerIdLines = fs.readFileSync(playerIdsPath, 'utf-8').split('\n');
const playerIdMap = {};
for (const line of playerIdLines) {
  const match = line.match(/^(.+?):\s*(\d+)$/);
  if (match) {
    playerIdMap[match[1].trim().toLowerCase()] = match[2];
  }
}


// Helper to extract the true player name (handles extra parentheses in names)
function extractPlayerName(raw, isLeft) {
  // Only strip the last parenthesis if there are at least two sets of parentheses
  let s = raw.trim();
  // Count number of '(' in the string
  let parenCount = (s.match(/\(/g) || []).length;
  let lastParen = s.lastIndexOf('(');
  let lastClose = s.lastIndexOf(')');
  if (parenCount >= 2 && lastParen !== -1 && lastClose === s.length - 1) {
    // Remove the last parenthesis group (assumed to be deck/alias)
    let before = s.substring(0, lastParen).trim();
    if (before.length > 0) {
      return before;
    }
  }
  return s;
}

// Helper to normalize player names for lookup, optionally with team
function normalizeName(name, team) {
  if (team) {
    return (team.trim() + ':' + name.trim()).toLowerCase();
  }
  return name.trim().toLowerCase();
}

// Parse the structured match text
function parseMatchText(text) {
  // Split by lines and process
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let currentTeams = [];
  let currentPlayers = [];
  let currentWeek = null;
  let currentSet = null;
  let currentGame = null;
  let results = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Week header: Week N
    const weekMatch = line.match(/^Week (\d+)/i);
    if (weekMatch) {
      currentWeek = parseInt(weekMatch[1]);
      continue;
    }
    // Match header: TeamA vs TeamB X-Y
    const headerMatch = line.match(/^(.+) vs (.+) (\d+)-(\d+)$/);
    if (headerMatch) {
      currentTeams = [headerMatch[1].trim(), headerMatch[2].trim()];
      currentPlayers = [headerMatch[1].trim(), headerMatch[2].trim()];
      continue;
    }
    // Match Set: Set N X-Y
    const setMatch = line.match(/^Set (\d+) (\d+)-(\d+)$/);
    if (setMatch) {
      currentSet = parseInt(setMatch[1]);
      continue;
    }
    // Match Game: Game N X-Y
    const gameMatch = line.match(/^Game (\d+) (\d+)-(\d+)$/);
    if (gameMatch) {
      currentGame = parseInt(gameMatch[1]);
      continue;
    }
    // Normalize all dash types to hyphen-minus for matching
    const normalizedLine = line
      .replace(/[\u2013\u2014\u2212\u2012\u2010]/g, '-') // en dash, em dash, minus, figure dash, hyphen
      .replace(/\s*-\s*/g, ' - '); // normalize spaces around dashes

    // Further relax: allow any whitespace (including non-breaking) around dash, and any dash variant
    // Normalize all dash types and all whitespace
    const normalizedLine2 = normalizedLine.replace(/[\u00A0\u2000-\u200B]/g, ' '); // replace non-breaking and other unicode spaces
    // Enhanced regex: support both 'vs' and '-' as separators, allow extra info after score, and handle optional parentheses
    // Examples handled:
    //   PlayerA (DeckA) - PlayerB (DeckB) (1-0)
    //   PlayerA (DeckA) vs PlayerB (DeckB) (1-0)
    //   PlayerA (DeckA) - PlayerB (DeckB) (1-0) Time Limit Win
    //   PlayerA (DeckA) – PlayerB (DeckB) (1-0)
    //   PlayerA (DeckA) - PlayerB (DeckB) (1-0) (extra info)
    //   PlayerA (DeckA) - PlayerB (DeckB) (1-0)rdu
    // Accept both hyphen-minus and en-dash, and allow trailing info after score
    const enhancedResultMatch = normalizedLine2.match(/^(.+?)(?: \((.*?)\))?\s*(?:-|–|—|vs)\s*(.+?)(?: \((.*?)\))?\s*\((\d+)\s*-\s*(\d+)\)(?:\s*[^\d\s].*)?$/i);
    // If matched, trim all capture groups to remove extra spaces
    if (enhancedResultMatch) {
      for (let j = 1; j < enhancedResultMatch.length; j++) {
        if (typeof enhancedResultMatch[j] === 'string') {
          enhancedResultMatch[j] = enhancedResultMatch[j].trim();
        }
      }
    }
    const resultMatch = enhancedResultMatch;
    if (resultMatch && currentTeams.length === 2 && currentSet && currentGame && currentWeek) {
      // Destructure once for use in debug and logic
      // resultMatch: [full, pAraw, deckA, pBraw, deckB, scoreA, scoreB]
      // deckA and deckB may be undefined
      const [__, pAraw, deckA, pBraw, deckB, scoreA, scoreB] = resultMatch;
      // Debug: log every parsed result line, especially for Benk1w
      if ((pAraw && pAraw.toLowerCase().includes('benk1w')) || (pBraw && pBraw.toLowerCase().includes('benk1w')) || line.toLowerCase().includes('benk1w')) {
        const logMsg = `DEBUG: Parsed result line for Benk1w: line='${line}', pAraw='${pAraw}', pBraw='${pBraw}'\n`;
        fs.appendFileSync(unmatchedLogPath, logMsg);
        console.warn(logMsg.trim());
      }
      // Extract true player names
      const pA = extractPlayerName(pAraw, true);
      const pB = extractPlayerName(pBraw, false);
      // Determine teams for each player
      // Left side is always currentTeams[0], right side is currentTeams[1]
      // Try all reasonable lookup keys for each player
      function getPlayerId(name, team) {
        // Debug: log every getPlayerId call for Benk1w
        if (name && name.toLowerCase().includes('benk1w')) {
          const logMsg = `DEBUG: getPlayerId called for name='${name}', team='${team}'\n`;
          fs.appendFileSync(unmatchedLogPath, logMsg);
          console.warn(logMsg.trim());
        }
        // Try 'Name (Team)' first, then 'Name', then all possible teams for this name
        const keys = [
          name.trim() + ' (' + team.trim() + ')',
          name.trim(),
          team.trim() + ' (' + name.trim() + ')', // unlikely, but fallback
        ];
        let triedKeys = [];
        for (const key of keys) {
          triedKeys.push(key.toLowerCase());
          const id = playerIdMap[key.toLowerCase()];
          if (id) return id;
        }
        // Fallback: try all player_ids.txt entries that match this name (with any team)
        const namePattern = new RegExp('^' + name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \((.+)\)$', 'i');
        for (const key in playerIdMap) {
          if (key === name.trim().toLowerCase()) continue; // already tried plain name
          const match = key.match(namePattern);
          triedKeys.push(key);
          if (match) {
            return playerIdMap[key];
          }
        }
        // Fuzzy fallback: ignore case, spaces, and special chars
        const simple = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const nameSimple = simple(name);
        for (const key in playerIdMap) {
          if (simple(key) === nameSimple) {
            triedKeys.push(key);
            return playerIdMap[key];
          }
        }
        // Log all tried keys for debugging
        const logMsg = `DEBUG: Tried keys for '${name}' (team: '${team}'): ${JSON.stringify(triedKeys)}\n`;
        fs.appendFileSync(unmatchedLogPath, logMsg);
        console.warn(logMsg.trim());
        return null;
      }
      const pAIdRaw = getPlayerId(pA, currentTeams[0]);
      const pBIdRaw = getPlayerId(pB, currentTeams[1]);
      // Convert to numbers if possible
      const pAId = pAIdRaw !== null ? Number(pAIdRaw) : null;
      const pBId = pBIdRaw !== null ? Number(pBIdRaw) : null;
      // Winner logic
      let winnerId = null;
      if (parseInt(scoreA) > parseInt(scoreB)) winnerId = pAId;
      else if (parseInt(scoreB) > parseInt(scoreA)) winnerId = pBId;
      // Opponent logic
      let opponentId = parseInt(scoreA) > parseInt(scoreB) ? pBId : pAId;
      // Build result
      for (const [pid, team, oppId] of [[pAId, currentTeams[0], pBId], [pBId, currentTeams[1], pAId]]) {
        if (typeof pid !== 'number' || isNaN(pid)) {
          const unmatchedMsg = `Unmatched player: '${team}:${isNaN(pid) ? (team === currentTeams[0] ? pA : pB) : pid}' in line: ${line}\n`;
          fs.appendFileSync(unmatchedLogPath, unmatchedMsg);
          console.warn(unmatchedMsg.trim());
          continue;
        }
        // Debug: log every time a result is added for Benk1w (ID 100351)
        if (pid === 100351) {
          const logMsg = `DEBUG: Adding result for Benk1w (ID 100351) in week ${currentWeek}, set ${currentSet}, game ${currentGame}, line: ${line}\n`;
          fs.appendFileSync(unmatchedLogPath, logMsg);
          console.warn(logMsg.trim());
        }
        if (!results[pid]) results[pid] = { id: pid, weeks: [] };
        // Find or create week
        let week = results[pid].weeks.find(w => w.week_number === currentWeek);
        if (!week) {
          week = { week_number: currentWeek, games: [] };
          results[pid].weeks.push(week);
        }
        week.games.push({
          opponent_id: (typeof oppId === 'number' && !isNaN(oppId)) ? oppId : undefined,
          winner_id: (typeof winnerId === 'number' && !isNaN(winnerId)) ? winnerId : undefined,
          set: currentSet,
          round: currentGame
        });
      }
    } else if ((line.includes('(') && line.includes(')')) && (line.match(/-|\u2013|\u2014|\u2212|\u2012|\u2010|vs/)) && /\(\d+-\d+\)/.test(line)) {
      // Looks like a result line but was skipped, log reason and deep debug info
      let reason = [];
      if (!resultMatch) reason.push('regex mismatch');
      if (currentTeams.length !== 2) reason.push('currentTeams');
      if (!currentSet) reason.push('currentSet');
      if (!currentGame) reason.push('currentGame');
      if (!currentWeek) reason.push('currentWeek');
      // Deep debug: log normalized line and char codes around dash
      let dashDebug = '';
      const dashIdx = line.search(/-|\u2013|\u2014|\u2212|\u2012|\u2010|vs/);
      if (dashIdx !== -1) {
        const context = line.substring(Math.max(0, dashIdx - 5), Math.min(line.length, dashIdx + 6));
        dashDebug = ` | Dash context: '${context}' | Char codes: [${[...context].map(c => c.charCodeAt(0)).join(',')}]`;
      }
      const logMsg = `SKIPPED: '${line}' | Reason(s): ${reason.join(', ')} | Normalized: '${normalizedLine2}'${dashDebug}\n`;
      fs.appendFileSync(unmatchedLogPath, logMsg);
      // Optionally, print to console for immediate feedback
      console.warn(logMsg.trim());
    }
  }
  // Convert results to array
  return Object.values(results);
}

// Main
const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/convertMatchTextToJson.js <input.txt> <output.json>');
  process.exit(1);
}
const inputText = fs.readFileSync(inputPath, 'utf-8');
const json = parseMatchText(inputText);
fs.writeFileSync(outputPath, JSON.stringify(json, null, 2));
console.log('Conversion complete:', outputPath);
