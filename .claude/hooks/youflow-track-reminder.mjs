// YouFlow PostToolUse reminder hook. Self-contained (no imports beyond node
// builtins) so it runs when copied into any project's .claude/hooks/. After the
// agent edits code in a YouFlow-bound repo (.youflow.json present), it injects a
// PostToolUse additionalContext nudge to create/keep a card In Progress — a
// safety net that re-fires during work, where a start-of-session directive decays.
// Throttled to ONCE per session (sentinel file keyed by session id) so it never
// spams. Never throws / always exits 0 — a tracking hook must not break a session.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export function buildReminder(binding) {
  const board = binding?.board_name || binding?.board_id || 'the bound board';
  return (
    `You just changed files in a YouFlow-tracked project (board "${board}"). ` +
    `If this work is not on a YouFlow card yet, create one now — create_card in the todo column with a plain-language title — and update_card to move it to in_progress. ` +
    `If a card already exists, keep it current: comment milestones and move it toward done as you go. ` +
    `The todo / in_progress / done column ids are in .youflow.json. Do this without waiting to be asked.`
  );
}

/**
 * Returns the hook stdout JSON string, or null when nothing should be emitted:
 * not a YouFlow project, or already reminded this session. Writes a per-session
 * sentinel into `sentinelDir` so it fires at most once per session.
 */
export function reminderOutput(projectDir, sessionId, sentinelDir) {
  let raw;
  try {
    raw = readFileSync(join(projectDir, '.youflow.json'), 'utf8');
  } catch {
    return null; // no .youflow.json → not a YouFlow project
  }
  let binding = null;
  try { binding = JSON.parse(raw); } catch { binding = null; } // malformed → minimal reminder

  const id = String(sessionId || 'session').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const sentinel = join(sentinelDir, `youflow-remind-${id}`);
  try {
    if (existsSync(sentinel)) return null; // already reminded this session
    writeFileSync(sentinel, '');
  } catch {
    // if the sentinel can't be read/written, fail open (remind once) rather than loop
  }

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: buildReminder(binding) },
  });
}

// Run only when executed directly (Claude Code invokes this as the hook command).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    let sessionId;
    try { sessionId = JSON.parse(input).session_id; } catch { /* no/invalid stdin */ }
    try {
      const out = reminderOutput(process.cwd(), sessionId, tmpdir());
      if (out) process.stdout.write(out);
    } catch {
      // degrade to silent — never break the session
    }
    process.exit(0);
  });
  // If stdin never delivers (unexpected), don't hang the session.
  setTimeout(() => process.exit(0), 2000).unref?.();
}
