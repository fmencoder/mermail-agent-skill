/**
 * Classification: rubric in, categories + urgency + evidence out.
 *
 * Nothing here reasons about the message. It matches the signals declared in
 * `rubric.mjs`, records the exact span that fired each one, and adds up
 * weights. That is deliberate: an urgency level a reviewer cannot trace to a
 * quoted phrase is an urgency level they cannot audit.
 */

import {
  CATEGORY_PRIORITY,
  CATEGORY_SIGNALS,
  FRAUD_SIGNALS,
  INJECTION_SIGNALS,
  URGENCY_SIGNALS,
  URGENCY_THRESHOLDS,
  URGENT_AT,
  URGENCY_LEVELS,
  VERIFICATION_SIGNALS,
} from './rubric.mjs';

const QUOTE_RADIUS = 60;
const MAX_QUOTE = 180;

/** Builds the scannable projection of a message: subject first, then the
 * bounded body. The offset of the boundary lets a hit name its own field. */
export function scanTextOf(message) {
  const subject = message.subject ?? '';
  const body = message.body_text ?? '';
  return { text: `${subject}\n${body}`, subjectEnd: subject.length };
}

/** Extracts a short, single-line quote around a match so the brief can show
 * why a signal fired without reproducing the whole message. */
export function quoteAround(text, index, length) {
  const start = Math.max(0, index - QUOTE_RADIUS);
  const end = Math.min(text.length, index + length + QUOTE_RADIUS);
  let quote = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (quote.length > MAX_QUOTE) quote = `${quote.slice(0, MAX_QUOTE - 1)}…`;
  return `${start > 0 ? '…' : ''}${quote}${end < text.length ? '…' : ''}`;
}

/**
 * Runs one signal set over the scan text.
 *
 * Each signal fires at most once. Repeating "URGENT" nine times is a rhetorical
 * choice by the sender, not nine independent pieces of evidence, and letting it
 * stack would hand the sender control of their own priority.
 */
export function matchSignals(signals, { text, subjectEnd }) {
  const hits = [];
  for (const signal of signals) {
    signal.pattern.lastIndex = 0;
    const match = signal.pattern.exec(text);
    if (!match) continue;
    hits.push({
      code: signal.code,
      category: signal.category ?? null,
      weight: signal.weight ?? 0,
      field: match.index < subjectEnd ? 'subject' : 'body',
      evidence: quoteAround(text, match.index, match[0].length),
    });
  }
  return hits;
}

function levelFor(score) {
  for (const { level, min } of URGENCY_THRESHOLDS) {
    if (score >= min) return level;
  }
  return 'none';
}

/**
 * Classifies one normalized message.
 *
 * A message whose body was withheld (flagged scan, omitted content) is still
 * classified — from its subject alone — and says so. Reporting "we could not
 * read this, here is what the header claims" beats dropping it from the brief.
 */
export function classifyMessage(message, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const scan = scanTextOf(message);

  const injection = matchSignals(INJECTION_SIGNALS, scan);
  const fraud = matchSignals(FRAUD_SIGNALS, scan);
  const verification = matchSignals(VERIFICATION_SIGNALS, scan);
  const categoryHits = matchSignals(CATEGORY_SIGNALS, scan);
  const urgencyHits = matchSignals(URGENCY_SIGNALS, scan);

  const categories = [...new Set(categoryHits.map((h) => h.category))].sort(
    (a, b) => CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b),
  );

  // Signals that voted for `informational` carry weight 0 by construction, so
  // a newsletter that says "urgent" still cannot climb on category weight
  // alone — only a real urgency signal moves it.
  let score = 0;
  for (const hit of [...categoryHits, ...urgencyHits]) score += hit.weight;

  // A message nobody has read yet, that arrived in the last day, and that asks
  // for something is more urgent than the same message from last month.
  const ageHours = message.received_at
    ? (now.getTime() - new Date(message.received_at).getTime()) / 3_600_000
    : null;
  const modifiers = [];
  if (categories.includes('action_required') && ageHours !== null && ageHours > 72 && message.read === false) {
    score += 8;
    modifiers.push({ code: 'unread_request_aging', detail: `unread for ${Math.floor(ageHours / 24)}d` });
  }
  if (categories.length === 1 && categories[0] === 'informational') {
    score = Math.min(score, 11);
    modifiers.push({ code: 'informational_ceiling', detail: 'purely informational mail is capped below "low"' });
  }
  // The sender's own authentication is not authority, but a failed verdict on
  // a message asking for money is a reason for a human to look sooner.
  if (message.sender_authentication !== 'pass' && categories.includes('financial')) {
    score += 10;
    modifiers.push({ code: 'unauthenticated_financial', detail: `sender_authentication=${message.sender_authentication}` });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = levelFor(score);

  const primary = categories[0] ?? 'informational';

  return {
    categories: categories.length > 0 ? categories : ['informational'],
    primary_class: primary,
    urgency: {
      level,
      score,
      urgent: URGENCY_LEVELS.indexOf(level) >= URGENCY_LEVELS.indexOf(URGENT_AT),
      signals: [...categoryHits, ...urgencyHits].map(({ code, field, evidence }) => ({ code, field, evidence })),
      modifiers,
    },
    injection_hits: injection.map(({ code, field, evidence }) => ({ code, field, evidence })),
    fraud_hits: fraud.map(({ code, field, evidence }) => ({ code, field, evidence })),
    verification_hits: verification.map(({ code, field, evidence }) => ({ code, field, evidence })),
    metadata_only: message.body_text === '',
  };
}
