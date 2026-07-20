// YouFlow SessionStart hook. Self-contained (no imports) so it runs when copied
// into any project's .claude/hooks/. Prints a SessionStart additionalContext
// directive when the project is bound (.youflow.json present); otherwise silent.
// Never throws / always exits 0 — a tracking hook must not break a session.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function buildDirective(binding) {
  const ws = binding?.workspace_name || binding?.workspace_id;
  const board = binding?.board_name || binding?.board_id;
  const where = ws && board ? ` (.youflow.json → workspace "${ws}", board "${board}")` : '';
  const c = (binding && typeof binding.columns === 'object' && binding.columns) || {};
  const cols = c.todo && c.in_progress && c.done
    ? ` Column ids — todo=${c.todo}, in_progress=${c.in_progress}, done=${c.done}.`
    : '';
  return (
    `This project is tracked in YouFlow${where}. You have TWO standing obligations this session — both are required, not optional.\n\n` +
    `(1) START OF WORK: before doing anything else, call list_my_work and list_notifications via the YouFlow MCP, then tell the user what is on their plate and what is new.\n\n` +
    `(2) TRACK EVERY UNIT OF WORK AS A CARD — do this yourself, automatically, without being asked. WHEN you begin any feature, fix, chore, or multi-step task in this repo: ` +
    `create_card in the todo column with a plain-language title AS YOU START; ` +
    `update_card to move it to in_progress when you begin; ` +
    `add_card_comment at each milestone (for example, "opened pull request #NN"); ` +
    `update_card to move it to done when the work is complete.${cols} ` +
    `Announce the card briefly — do not defer it to the end and do not wait for the user to ask. Skip only trivial one-off questions that change no code.\n\n` +
    `Write every title, description, and comment in plain language readable by technical, marketing, AND management people. Full protocol: youflow://guide §Project Tracking.`
  );
}

/** Returns the hook stdout JSON string, or null if this is not a YouFlow project. */
export function hookOutput(projectDir) {
  let raw;
  try {
    raw = readFileSync(join(projectDir, '.youflow.json'), 'utf8');
  } catch {
    return null; // no .youflow.json → not a YouFlow project
  }
  let binding = null;
  try { binding = JSON.parse(raw); } catch { binding = null; } // malformed → minimal directive
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildDirective(binding) },
  });
}

// Run only when executed directly (Claude Code invokes this as the hook command).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const out = hookOutput(process.cwd());
    if (out) process.stdout.write(out);
  } catch {
    // degrade to silent — never break the session
  }
  process.exit(0);
}
