#!/usr/bin/env node
/**
 * mermail-brief — the reference implementation of the mermail-inbox-brief skill.
 *
 * It reads a Mermail MCP tool payload (whatever `list_emails`, `search_emails`,
 * or `get_thread` returned) and writes the brief. It holds no credentials and
 * opens no sockets: the agent's own Mermail MCP connection fetches the mail,
 * this runs the rubric over it. That is why nothing here can send email even by
 * accident.
 *
 *   mermail-brief brief  --input <file|-> [--out f] [--format json|text] [...]
 *   mermail-brief draft  --input <file|-> --email <id> [--mailbox <id>]
 *   mermail-brief render --input <file|-> [--out f] [--title t]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { buildBrief } from './brief.mjs';
import { renderBriefHtml } from './render.mjs';

const USAGE = `mermail-brief <command> [options]

Commands
  brief    Build a mermail.inbox-brief/v1 document from a Mermail tool payload
  draft    Show one message's reply draft and the exact save_draft arguments
  render   Build the brief and write the single-screen review page

Options
  --input, -i <path>   Mermail tool payload as JSON; "-" reads stdin (required)
  --out, -o <path>     Write output to a file instead of stdout
  --format <json|text> Output format for "brief" (default: text)
  --email <id>         email_id to draft for ("draft" only)
  --mailbox <id>       mailboxId to embed in the save_draft arguments
  --address <addr>     Mailbox address, for the brief header
  --limit <n>          Consider at most n messages
  --now <iso>          Reference instant for due-date resolution (default: now)
  --title <text>       Page title ("render" only)
  --help, -h           Show this message

Nothing in this tool sends email. Replies are produced as save_draft arguments
for a human to approve.`;

function parseArgs(argv) {
  const options = { _: [] };
  const alias = { i: 'input', o: 'out', h: 'help' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) {
      options._.push(token);
      continue;
    }
    const bare = token.replace(/^--?/, '');
    const [rawKey, inlineValue] = bare.split('=');
    const key = alias[rawKey] ?? rawKey;
    if (key === 'help') {
      options.help = true;
      continue;
    }
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || (next.startsWith('-') && next !== '-')) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function readInput(source) {
  if (!source || source === true) {
    throw new Error('--input is required (a JSON file, or "-" for stdin)');
  }
  const raw = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  if (raw.trim() === '') throw new Error(`input ${source === '-' ? '(stdin)' : source} is empty`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`input is not valid JSON: ${error.message}`);
  }
}

function emit(text, out) {
  if (out && out !== true) {
    writeFileSync(out, text.endsWith('\n') ? text : `${text}\n`);
    process.stderr.write(`wrote ${out}\n`);
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

function briefOptions(options) {
  const now = options.now && options.now !== true ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now is not a valid date: ${options.now}`);
  const limit = options.limit && options.limit !== true ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got ${options.limit}`);
  }
  return {
    now,
    limit,
    mailboxId: options.mailbox && options.mailbox !== true ? options.mailbox : null,
    mailboxAddress: options.address && options.address !== true ? options.address : null,
    sourceLabel: options.input === '-' ? 'stdin' : options.input,
  };
}

const BAR = { critical: '████', high: '███', medium: '██', low: '█', none: '' };

function renderText(brief) {
  const lines = [];
  const c = brief.counts;
  lines.push(`MERMAIL INBOX BRIEF  ${brief.generated_at}`);
  if (brief.source.mailbox_address) lines.push(`mailbox              ${brief.source.mailbox_address}`);
  lines.push(
    `coverage             ${c.considered} considered · ${c.classified} classified · ${c.quarantined} held · ${c.malformed} malformed · ${c.duplicates} duplicate`,
  );
  lines.push(`extracted            ${c.action_items} action items · ${c.drafts_available} drafts awaiting approval`);
  lines.push('');

  for (const item of brief.items) {
    const flag = item.quarantine ? 'HELD' : item.urgency.level.toUpperCase();
    lines.push('─'.repeat(76));
    lines.push(`[${flag}] ${item.subject}`);
    lines.push(
      `  from ${item.from.address || 'unknown'} · auth ${item.from.authentication} · ${item.classes.join(', ')} · score ${item.urgency.score} ${BAR[item.urgency.level] ?? ''}`,
    );
    lines.push(`  id   ${item.email_id}`);

    if (item.quarantine) {
      lines.push(`  HELD: ${item.quarantine.reason} — ${item.quarantine.detail}`);
      for (const attempt of item.quarantine.attempted) {
        lines.push(`        ${attempt.code} (${attempt.field}): ${attempt.evidence}`);
      }
    }

    lines.push(`  summary: ${item.summary.text}`);
    if (item.summary.note) lines.push(`           (${item.summary.note})`);

    if (item.action_items.length > 0) {
      lines.push('  actions:');
      for (const action of item.action_items) {
        const due = action.due ? ` [due ${action.due}${action.due_precision === 'relative' ? '?' : ''}]` : '';
        lines.push(`    - (${action.owner}) ${action.text}${due}`);
        lines.push(`      ↳ ${action.evidence.email_id}: ${action.evidence.quote}`);
      }
    }

    if (item.suggested_reply.available) {
      lines.push(`  draft: ready · ${item.suggested_reply.placeholders.length} placeholder(s) · awaiting approval for save_draft`);
    } else {
      lines.push(`  draft: none (${item.suggested_reply.reason})`);
    }
    lines.push('');
  }

  if (brief.defects.length > 0) {
    lines.push(`malformed records: ${brief.defects.map((d) => `#${d.index} ${d.reason}`).join(', ')}`);
    lines.push('');
  }
  lines.push(...brief.boundaries.map((b) => `· ${b}`));
  return lines.join('\n');
}

function commandBrief(options) {
  const brief = buildBrief(readInput(options.input), briefOptions(options));
  const format = options.format === true || !options.format ? 'text' : options.format;
  if (format !== 'json' && format !== 'text') throw new Error(`--format must be json or text, got ${format}`);
  emit(format === 'json' ? JSON.stringify(brief, null, 2) : renderText(brief), options.out);
  return 0;
}

function commandDraft(options) {
  if (!options.email || options.email === true) throw new Error('--email <email_id> is required');
  const brief = buildBrief(readInput(options.input), briefOptions(options));
  const item = brief.items.find((i) => i.email_id === options.email);
  if (!item) {
    const known = brief.items.map((i) => i.email_id).join(', ') || '(none)';
    throw new Error(`no message with email_id "${options.email}" in this payload. Known ids: ${known}`);
  }
  const draft = item.suggested_reply;
  const lines = [`Subject: ${item.subject}`, `From:    ${item.from.address || 'unknown'}`, ''];
  if (!draft.available) {
    lines.push(`No draft produced: ${draft.reason}.`);
    lines.push('This is a deliberate stop, not a failure — see references/security.md.');
  } else {
    lines.push(draft.body, '', 'Awaiting approval — exact MCP call:', JSON.stringify(draft.mcp_call, null, 2));
  }
  emit(lines.join('\n'), options.out);
  return 0;
}

function commandRender(options) {
  const brief = buildBrief(readInput(options.input), briefOptions(options));
  const html = renderBriefHtml(brief, {
    title: options.title && options.title !== true ? options.title : undefined,
  });
  emit(html, options.out);
  return 0;
}

export function main(argv) {
  const options = parseArgs(argv);
  const command = options._[0];
  if (options.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return command ? 0 : 1;
  }
  const commands = { brief: commandBrief, draft: commandDraft, render: commandRender };
  const handler = commands[command];
  if (!handler) {
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}\n`);
    return 1;
  }
  try {
    return handler(options);
  } catch (error) {
    process.stderr.write(`mermail-brief: ${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
