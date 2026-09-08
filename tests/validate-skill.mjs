#!/usr/bin/env node
/**
 * Skill-format validator.
 *
 * Enforces the same contract the official Mermail skills repository enforces on
 * its own skills, so this companion could be graduated without a round of
 * format fixes. Checks that need a live workspace (remote tool catalog) are out
 * of scope here and named in the README instead of faked.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const SKILLS_DIR = 'skills';
const MAX_SKILL_LINES = 500;
const failures = [];
const checks = [];

const check = (name, condition, detail) => {
  checks.push(name);
  if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
};

/** Minimal frontmatter reader — enough for the keys the contract allows, and
 * deliberately not a YAML parser, so a malformed block fails loudly. */
function readFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const block = match[1];
  const topLevel = [...block.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((m) => m[1]);
  const value = (key) => {
    const found = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return found ? found[1].trim() : null;
  };
  return { block, topLevel, value, raw: match[0], lines: match[0].split('\n').length };
}

const skills = readdirSync(SKILLS_DIR).filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory());
check('at least one skill exists', skills.length > 0);

for (const name of skills) {
  const dir = join(SKILLS_DIR, name);
  const skillPath = join(dir, 'SKILL.md');

  let text;
  try {
    text = readFileSync(skillPath, 'utf8');
  } catch {
    failures.push(`${name}: SKILL.md is missing`);
    continue;
  }

  const lineCount = text.split('\n').length;
  check(`${name}: SKILL.md within ${MAX_SKILL_LINES} lines`, lineCount <= MAX_SKILL_LINES, `${lineCount} lines`);

  const front = readFrontmatter(text);
  if (!front) {
    failures.push(`${name}: SKILL.md has no --- frontmatter block`);
    continue;
  }

  check(`${name}: frontmatter name matches directory`, front.value('name') === name, `got ${front.value('name')}`);

  const description = front.value('description');
  check(`${name}: has a description`, Boolean(description) && description.length > 40);
  check(
    `${name}: description says when not to use the skill`,
    /\b(do not use|not for|rather than)\b/i.test(description ?? ''),
  );

  const allowed = new Set(['name', 'description', 'metadata']);
  const extra = front.topLevel.filter((key) => !allowed.has(key));
  check(`${name}: frontmatter has only allowed top-level keys`, extra.length === 0, `extra: ${extra.join(', ')}`);

  check(`${name}: declares metadata.openclaw`, /^\s{2}openclaw:/m.test(front.block));
  check(`${name}: primaryEnv is MERMAIL_API_KEY`, /primaryEnv:\s*MERMAIL_API_KEY\s*$/m.test(front.block));
  check(`${name}: requires MERMAIL_API_KEY`, /requires:[\s\S]*?env:[\s\S]*?-\s*MERMAIL_API_KEY/m.test(front.block));

  const bodyText = text.slice(front.raw.length);
  check(`${name}: no unresolved TODO`, !/\bTODO\b|\bREPLACE\b/.test(bodyText));

  // openai.yaml
  const yamlPath = join(dir, 'agents', 'openai.yaml');
  let yaml;
  try {
    yaml = readFileSync(yamlPath, 'utf8');
  } catch {
    failures.push(`${name}: agents/openai.yaml is missing`);
    yaml = '';
  }
  if (yaml) {
    check(`${name}: default_prompt references $${name}`, yaml.includes(`Use $${name}`));
    check(`${name}: declares the hosted Mermail MCP dependency`, yaml.includes('https://console.mermail.app/mcp'));
    check(`${name}: MCP transport is streamable_http`, /transport:\s*"?streamable_http"?/.test(yaml));
  }

  // references
  let references = [];
  try {
    references = readdirSync(join(dir, 'references'));
  } catch {
    references = [];
  }
  check(`${name}: has references/tools.md`, references.includes('tools.md'));
  check(`${name}: has references/security.md`, references.includes('security.md'));

  // Community skills must not present themselves as the official package.
  check(
    `${name}: identifies itself as a community skill`,
    /community skill|not part of the official/i.test(bodyText),
  );

  // Secrets must never be committed. An expanded key would be a live secret in
  // git history, so this fails the build rather than warning.
  const secretish = text.match(/\b(mk_live|sk-|MERMAIL_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{16,})/);
  check(`${name}: no expanded secret in SKILL.md`, secretish === null, secretish ? secretish[0] : '');

  // The tool contract must state the send-side boundary explicitly, since the
  // whole skill's safety claim rests on it.
  const tools = references.includes('tools.md') ? readFileSync(join(dir, 'references', 'tools.md'), 'utf8') : '';
  check(
    `${name}: tools.md names the send tools it must not call`,
    ['send_email', 'reply_to_email', 'forward_email', 'schedule_email_send'].every((t) => tools.includes(t)),
  );
  check(`${name}: tools.md requires native JSON query objects`, /native JSON object/i.test(tools));
}

if (failures.length > 0) {
  process.stderr.write(`skill validation failed (${failures.length} of ${checks.length} checks)\n`);
  for (const failure of failures) process.stderr.write(`  ✗ ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`skill validation passed (${checks.length} checks, ${skills.length} skill(s))\n`);
}
