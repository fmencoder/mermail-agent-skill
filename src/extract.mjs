/**
 * Summary and action-item extraction.
 *
 * Everything this module emits is *extractive*: a summary sentence is a
 * sentence that appeared in the message, and an action item quotes the span it
 * came from. Nothing is paraphrased into existence. If the message does not
 * say it, the brief does not claim it.
 */

const MAX_SUMMARY_CHARS = 320;
const MAX_ACTION_ITEMS = 6;
const MAX_ACTION_TEXT = 200;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Boilerplate that carries no information about what the message wants. */
const NOISE_RE = /^(hi|hey|hello|dear|good (?:morning|afternoon|evening))\b|^(thanks|thank you|cheers|best|regards|kind regards|sincerely|sent from my)\b|^(unsubscribe|view (?:this )?in browser|manage preferences)\b/i;

const ASK_RE = /\b(can|could|would|will) you\b|\bplease\b|\bwe need (?:you )?to\b|\bneed you to\b|\b(?:needs?|require[sd]?|awaiting|pending) (?:your )?(?:approval|sign[- ]?off|review|input|confirmation|response|decision)\b|\blet (?:me|us) know\b|\bwould appreciate\b|\baction (?:is )?required\b|\bcould (?:you|we)\b|\bany chance you\b/i;
const SENDER_COMMIT_RE = /\b(?:I|we)(?:'ll| will| are going to| plan to| intend to)\b|\bI(?:'ve| have) (?:attached|sent|scheduled)\b/i;
const QUESTION_RE = /\?\s*$/;

/** Splits into sentences without a tokenizer: mail is short and this stays
 * predictable, which matters more here than linguistic completeness. */
export function splitSentences(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n(?=[-*•\d]\s)|\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trim()}…`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolves a due date mentioned in a sentence against a reference instant.
 *
 * Returns `{ date, expression, precision }` or null. `precision: "explicit"`
 * means the message named a calendar date; `"relative"` means the skill
 * resolved a phrase like "by Friday" and a human should sanity-check it.
 */
export function extractDue(sentence, now) {
  const lower = sentence.toLowerCase();
  const ref = new Date(now.getTime());

  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: iso[0], expression: iso[0], precision: 'explicit' };

  const named = lower.match(
    new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`),
  );
  if (named) {
    const month = MONTHS.indexOf(named[1]);
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : ref.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, month, day));
    if (!named[3] && candidate.getTime() < ref.getTime() - 86_400_000 * 30) {
      candidate.setUTCFullYear(year + 1);
    }
    return { date: isoDate(candidate), expression: named[0], precision: 'explicit' };
  }

  const sameDay = lower.match(/\b(today|eod|end of day|cob|close of business|tonight)\b/);
  if (sameDay) {
    return { date: isoDate(ref), expression: sameDay[0], precision: 'relative' };
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(ref.getTime() + 86_400_000);
    return { date: isoDate(d), expression: 'tomorrow', precision: 'relative' };
  }

  const weekday = lower.match(/\bby\s+(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?\b/);
  if (weekday) {
    const stem = weekday[1];
    const target = WEEKDAYS.findIndex((d) => d.startsWith(stem.slice(0, 3)));
    if (target >= 0) {
      const delta = (target - ref.getUTCDay() + 7) % 7 || 7;
      return {
        date: isoDate(new Date(ref.getTime() + delta * 86_400_000)),
        expression: weekday[0],
        precision: 'relative',
      };
    }
  }

  if (/\bend of (?:the )?week\b|\beow\b/.test(lower)) {
    const delta = (5 - ref.getUTCDay() + 7) % 7;
    return { date: isoDate(new Date(ref.getTime() + delta * 86_400_000)), expression: 'end of week', precision: 'relative' };
  }
  return null;
}

function ownerOf(sentence) {
  if (/\b(?:can|could|would|will|are|do|did|have|should) you\b|\byou (?:need|must|should)\b|\bplease\b|\bneed you to\b|\byour (?:approval|sign[- ]?off|input|review|answer|call)\b/i.test(sentence)) {
    return 'you';
  }
  if (SENDER_COMMIT_RE.test(sentence)) return 'sender';
  return 'unassigned';
}

/**
 * Picks the sentences that state what the message wants.
 *
 * Each returned item carries the `email_id` and the quoted sentence it came
 * from, so every line in the brief's action list can be clicked back to its
 * source. An item with no evidence is not emitted.
 */
export function extractActionItems(message, classification, now) {
  if (!message.body_text) return [];
  const sentences = splitSentences(message.body_text);
  const items = [];
  const seen = new Set();

  for (const sentence of sentences) {
    if (sentence.length < 12 || NOISE_RE.test(sentence)) continue;
    const isAsk = ASK_RE.test(sentence);
    const isQuestion = QUESTION_RE.test(sentence);
    const isCommit = SENDER_COMMIT_RE.test(sentence);
    if (!isAsk && !isQuestion && !isCommit) continue;

    const key = sentence.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const due = extractDue(sentence, now);
    items.push({
      text: clip(sentence, MAX_ACTION_TEXT),
      owner: ownerOf(sentence),
      kind: isCommit && !isAsk ? 'sender_commitment' : isQuestion && !isAsk ? 'question' : 'request',
      due: due ? due.date : null,
      due_expression: due ? due.expression : null,
      due_precision: due ? due.precision : null,
      evidence: { email_id: message.email_id, field: 'body', quote: clip(sentence, MAX_ACTION_TEXT) },
    });
    if (items.length >= MAX_ACTION_ITEMS) break;
  }

  // An action-required classification with no extractable sentence is a real
  // outcome, not a bug: the brief says the signal fired and points at it
  // rather than manufacturing a task.
  if (items.length === 0 && classification.categories.includes('action_required')) {
    const signal = classification.urgency.signals.find((s) => s.field === 'body') ?? classification.urgency.signals[0];
    if (signal) {
      items.push({
        text: 'Message asks for something but no single sentence states it — read the source.',
        owner: 'you',
        kind: 'unresolved',
        due: null,
        due_expression: null,
        due_precision: null,
        evidence: { email_id: message.email_id, field: signal.field, quote: signal.evidence },
      });
    }
  }

  return items;
}

/**
 * Builds an extractive summary.
 *
 * Prefers sentences that carry a signal, falls back to the first informative
 * sentences, and degrades to the subject when the body was withheld.
 */
export function summarize(message, classification) {
  if (!message.body_text) {
    const reason =
      message.scan_status === 'flagged'
        ? 'body withheld: scan flagged'
        : message.content_omitted
          ? 'body withheld by Mermail'
          : message.scan_status !== 'clean'
            ? `body not read: scan_status=${message.scan_status}`
            : 'no body content returned';
    return { text: message.subject || '(no subject)', basis: 'subject_only', note: reason };
  }

  const sentences = splitSentences(message.body_text).filter((s) => s.length >= 12 && !NOISE_RE.test(s));
  if (sentences.length === 0) {
    return { text: message.subject || '(no subject)', basis: 'subject_only', note: 'no informative sentence found' };
  }

  const quoted = new Set(classification.urgency.signals.filter((s) => s.field === 'body').map((s) => s.evidence));
  const scored = sentences.map((sentence, index) => {
    let score = -index; // earlier sentences state the point
    for (const quote of quoted) {
      const core = quote.replace(/^…|…$/g, '').trim();
      if (core && sentence.includes(core.slice(0, 30))) score += 10;
    }
    if (/\?$/.test(sentence)) score += 3;
    return { sentence, score };
  });

  const chosen = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
    .map((s) => s.sentence);

  return {
    text: clip(chosen.join(' '), MAX_SUMMARY_CHARS),
    basis: 'extractive',
    note: message.truncated ? 'source body truncated at the read budget' : null,
  };
}
