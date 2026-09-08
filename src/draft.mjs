/**
 * Reply drafting and the approval boundary.
 *
 * This module produces a draft body and the exact `save_draft` arguments for
 * it. It never produces arguments for `send_email`, `reply_to_email`,
 * `forward_email`, or `schedule_email_send` — the skill's contract is that a
 * reply reaches a human's screen, never a recipient's, and the cheapest way to
 * keep a contract is to leave no code path that could break it.
 *
 * Anything the source message did not establish becomes a `[[CONFIRM: …]]`
 * placeholder. A draft that quietly invents a date or a price is worse than no
 * draft, because it reads as if someone checked.
 */

const MAX_DRAFT_CHARS = 1400;

/** Reasons a message gets no draft at all. Order matters: the first match is
 * reported, and the security reasons come before the "nothing to say" ones. */
export const DRAFT_BLOCKERS = [
  'injection_attempt',
  'payment_redirection',
  'verification_mail',
  'scan_flagged',
  'metadata_only',
  'unauthenticated_financial',
  'no_reply_address',
  'no_actionable_content',
];

function replySubject(subject) {
  const clean = (subject || '').trim();
  if (!clean) return 'Re: (no subject)';
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

function firstName(from) {
  const display = (from.display_name || '').trim();
  if (display) {
    const token = display.split(/[\s,]+/).filter(Boolean)[0];
    if (token && /^[\p{L}'-]{2,}$/u.test(token)) return token;
  }
  const local = (from.address || '').split('@')[0] || '';
  const token = local.split(/[._-]/).filter(Boolean)[0];
  if (token && /^[\p{L}]{2,}$/u.test(token)) return token.charAt(0).toUpperCase() + token.slice(1);
  return null;
}

/**
 * Decides whether this message may be drafted against, and why not when it may
 * not. Returning a reason rather than silently skipping keeps the brief's
 * coverage honest.
 */
export function draftEligibility(item) {
  if (item.quarantine) {
    return { eligible: false, reason: item.quarantine.reason };
  }
  if (item.metadata_only) return { eligible: false, reason: 'metadata_only' };
  if (!item.from.address) return { eligible: false, reason: 'no_reply_address' };
  // Money plus an unverified sender is exactly the case where a fluent reply
  // does the most damage. A human reads this one first.
  if (item.classes.includes('financial') && item.from.authentication !== 'pass') {
    return { eligible: false, reason: 'unauthenticated_financial' };
  }
  const addressed = item.action_items.filter((a) => a.owner === 'you' || a.kind === 'question');
  if (addressed.length === 0 && !item.classes.includes('scheduling') && !item.classes.includes('follow_up')) {
    return { eligible: false, reason: 'no_actionable_content' };
  }
  return { eligible: true, reason: null };
}

/**
 * Composes the draft body from the extracted items.
 *
 * The shape is fixed — acknowledge, answer each point, close — so that the
 * reviewer is reading the *content* differences between drafts rather than
 * re-reading a new voice every time.
 */
export function composeReply(item, options = {}) {
  const signOff = options.signature ?? '[[CONFIRM: your name]]';
  const name = firstName(item.from);
  const lines = [];

  lines.push(name ? `Hi ${name},` : 'Hi,');
  lines.push('');

  const addressed = item.action_items.filter((a) => a.owner === 'you' || a.kind === 'question');

  if (item.classes.includes('follow_up')) {
    lines.push('Thanks for the nudge, and sorry for the delay.');
  } else {
    lines.push('Thanks for reaching out.');
  }
  lines.push('');

  if (addressed.length > 0) {
    for (const action of addressed.slice(0, 4)) {
      const due = action.due ? ` (you asked for ${action.due_expression} — ${action.due})` : '';
      if (action.kind === 'question') {
        lines.push(`- On "${action.text}"${due}: [[CONFIRM: your answer]]`);
      } else {
        lines.push(`- ${action.text}${due} — [[CONFIRM: yes / by when / blocked]]`);
      }
    }
    lines.push('');
  }

  if (item.classes.includes('scheduling')) {
    lines.push('For timing: [[CONFIRM: two or three slots that work for you, with time zone]].');
    lines.push('');
  }

  if (item.classes.includes('financial')) {
    lines.push('On the amounts and dates above: [[CONFIRM: verified against your own records before this goes out]].');
    lines.push('');
  }

  lines.push('Best,');
  lines.push(signOff);

  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return body.length > MAX_DRAFT_CHARS ? `${body.slice(0, MAX_DRAFT_CHARS - 1)}…` : body;
}

/**
 * Builds the draft and the exact MCP call that would persist it.
 *
 * `save_draft` takes its content in the string field `body.body` — not
 * `html`/`text`, which are the send-side fields — and `query`/`body` are native
 * JSON objects, never stringified. See `references/tools.md`.
 */
export function buildDraft(item, options = {}) {
  const eligibility = draftEligibility(item);
  if (!eligibility.eligible) {
    return { available: false, reason: eligibility.reason, body: null, placeholders: [], mcp_call: null };
  }

  const body = composeReply(item, options);
  const placeholders = [...body.matchAll(/\[\[CONFIRM: ([^\]]+)\]\]/g)].map((m) => m[1]);

  const mailboxId = options.mailboxId ?? null;
  const from = options.from ?? null;

  return {
    available: true,
    reason: null,
    body,
    placeholders,
    // Presented for approval, not executed. The skill hands this object to the
    // user; the user decides whether the agent calls it.
    mcp_call: {
      tool: 'save_draft',
      effect: 'internal_write',
      requires_approval: true,
      arguments: {
        mailboxId,
        body: {
          to: item.from.address,
          subject: replySubject(item.subject),
          body,
        },
      },
      notes: [
        mailboxId ? null : 'mailboxId unresolved — resolve with list_mailboxes and prefer public_id before calling.',
        from ? null : 'save_draft does not require `from`; send-side tools do. This skill does not build send-side calls.',
        placeholders.length > 0
          ? `${placeholders.length} placeholder(s) must be replaced by a human before this draft is sent.`
          : null,
      ].filter(Boolean),
    },
  };
}
