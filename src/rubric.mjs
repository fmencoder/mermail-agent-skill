/**
 * The classification rubric.
 *
 * This file is the single source of truth for how a message earns a category
 * and an urgency score. It is data, not prose, so that two runs over the same
 * mailbox produce the same brief and a reviewer can argue with a weight
 * instead of with a vibe. `SKILL.md` instructs the agent to apply exactly
 * these signals; `references/brief-schema.md` documents the output they feed.
 *
 * Every signal carries a `code` that appears verbatim in the brief, so an
 * urgency level can always be traced back to the phrase that caused it.
 */

/** The five categories a message can carry. A message may carry several;
 * `primary_class` is the highest-priority one it earned. */
export const CATEGORIES = ['action_required', 'financial', 'scheduling', 'follow_up', 'informational'];

/** Tie-break order when a message earns several categories. */
export const CATEGORY_PRIORITY = ['action_required', 'financial', 'scheduling', 'follow_up', 'informational'];

export const URGENCY_LEVELS = ['none', 'low', 'medium', 'high', 'critical'];

/** Score thresholds. A message at or above a threshold takes that level. */
export const URGENCY_THRESHOLDS = [
  { level: 'critical', min: 80 },
  { level: 'high', min: 55 },
  { level: 'medium', min: 30 },
  { level: 'low', min: 12 },
  { level: 'none', min: 0 },
];

/** `urgent` is a derived display flag, not a sixth category. */
export const URGENT_AT = 'high';

const rx = (source) => new RegExp(source, 'gi');

/**
 * Category signals. `weight` contributes to the urgency score; `category`
 * is what the signal votes for. A signal fires at most once per message.
 */
export const CATEGORY_SIGNALS = [
  // --- action required -----------------------------------------------------
  { code: 'explicit_request', category: 'action_required', weight: 14, pattern: rx('\\b(can|could|would) you\\b|\\bplease (review|send|confirm|approve|sign|complete|update|provide|share)\\b|\\bwe need you to\\b|\\bplease advise\\b') },
  { code: 'approval_requested', category: 'action_required', weight: 16, pattern: rx('\\b(needs?|require[sd]?|awaiting|pending) (your )?(approval|sign[- ]?off|authorization|authoris(?:ation|ing))\\b|\\bapprove (this|the)\\b') },
  { code: 'blocked_on_you', category: 'action_required', weight: 20, pattern: rx('\\bblocked\\b|\\bblocker\\b|\\bwe(?:\'re| are) stuck\\b|\\bcan(?:not|\'t) (?:proceed|continue|ship)\\b|\\bholding (?:up|this)\\b') },
  { code: 'question_direct', category: 'action_required', weight: 8, pattern: rx('\\b(what|when|where|which|who|how|why|do you|are you|is it|should we|shall we)\\b[^.!?\\n]{0,120}\\?') },
  { code: 'decision_requested', category: 'action_required', weight: 12, pattern: rx('\\b(let us know|let me know|your (?:call|decision|preference)|which (?:option|one) )\\b|\\bgo/no[- ]?go\\b') },

  // --- financial -----------------------------------------------------------
  { code: 'invoice_or_bill', category: 'financial', weight: 12, pattern: rx('\\binvoice\\b|\\bbill(?:ing|ed)?\\b|\\breceipt\\b|\\bstatement\\b|\\bpurchase order\\b|\\bPO\\s?#') },
  { code: 'payment_due', category: 'financial', weight: 18, pattern: rx('\\b(payment|amount|balance|total)\\s+(?:is\\s+)?(?:now\\s+)?due\\b|\\bdue (?:on|by|date)\\b|\\bpay(?:able)? (?:by|before)\\b|\\bnet\\s?\\d{1,3}\\b') },
  { code: 'overdue', category: 'financial', weight: 26, pattern: rx('\\boverdue\\b|\\bpast due\\b|\\blate fee\\b|\\bfinal notice\\b|\\bin arrears\\b|\\bsuspend(?:ed|ing)? (?:your )?(?:account|service)\\b') },
  { code: 'money_amount', category: 'financial', weight: 6, pattern: rx('(?:[$€£]\\s?\\d[\\d,]*(?:\\.\\d{2})?)|\\b\\d[\\d,]*(?:\\.\\d{2})?\\s?(?:USD|EUR|GBP|USDC|SOL)\\b') },
  { code: 'contract_terms', category: 'financial', weight: 8, pattern: rx('\\b(quote|quotation|estimate|renewal|subscription|refund|charge(?:d|back)?|pricing)\\b') },

  // --- scheduling ----------------------------------------------------------
  { code: 'meeting_request', category: 'scheduling', weight: 12, pattern: rx('\\b(schedule|reschedul(?:e|ing)|book|set up|arrange)\\b[^.!?\\n]{0,40}\\b(call|meeting|sync|chat|time|slot|demo|interview)\\b|\\bare you (?:free|available)\\b|\\bdoes .{0,20}work for you\\b') },
  { code: 'invite_or_calendar', category: 'scheduling', weight: 10, pattern: rx('\\b(calendar invite|\\.ics\\b|google meet|zoom\\.us|teams\\.microsoft|meet\\.google)') },
  { code: 'proposed_time', category: 'scheduling', weight: 10, pattern: rx('\\b(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\\b[^.!?\\n]{0,30}\\b(?:\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)|\\d{1,2}:\\d{2})\\b|\\b\\d{1,2}\\s?(?:am|pm)\\s?(?:[A-Z]{2,4}T|UTC|GMT)\\b') },
  { code: 'cancellation', category: 'scheduling', weight: 14, pattern: rx('\\b(cancel(?:led|ling)?|postpon(?:e|ed|ing)|moved to|no longer available)\\b[^.!?\\n]{0,40}\\b(call|meeting|sync|session|interview)\\b') },

  // --- follow-up -----------------------------------------------------------
  { code: 'second_attempt', category: 'follow_up', weight: 14, pattern: rx('\\b(following up|circling back|bumping this|gentle (?:nudge|reminder)|checking in|just a reminder|as discussed|per my last email|haven\'t heard back|any update)\\b') },
  { code: 'awaiting_reply', category: 'follow_up', weight: 10, pattern: rx('\\b(still (?:waiting|awaiting)|no response|did you (?:get|see) (?:my|the))\\b') },
  { code: 'reply_marker', category: 'follow_up', weight: 4, pattern: rx('^\\s*(?:re|fwd?)\\s*:', ) },

  // --- informational -------------------------------------------------------
  { code: 'newsletter', category: 'informational', weight: 0, pattern: rx('\\b(unsubscribe|manage (?:your )?preferences|view (?:this|in) browser|newsletter|digest|no[- ]?reply@)\\b') },
  { code: 'automated_notice', category: 'informational', weight: 0, pattern: rx('\\b(this is an automated|do not reply to this|notification (?:from|settings)|status page|build (?:passed|succeeded)|deployment (?:succeeded|completed))\\b') },
];

/**
 * Urgency modifiers. These do not vote for a category; they only move the
 * score. Kept separate so "urgent" language cannot invent an action item.
 */
export const URGENCY_SIGNALS = [
  { code: 'deadline_today', weight: 30, pattern: rx('\\b(?:by |before |end of )?(?:today|eod|end of day|cob|close of business|tonight)\\b') },
  { code: 'deadline_tomorrow', weight: 22, pattern: rx('\\b(?:by |before )?tomorrow\\b|\\bnext business day\\b') },
  { code: 'deadline_this_week', weight: 14, pattern: rx('\\bby (?:mon|tues?|wed(?:nes)?|thur?s?|fri)(?:day)?\\b|\\bthis week\\b|\\bend of (?:the )?week\\b|\\beow\\b') },
  { code: 'explicit_urgency', weight: 20, pattern: rx('\\burgent(?:ly)?\\b|\\basap\\b|\\bimmediately\\b|\\btime[- ]sensitive\\b|\\bright away\\b|\\bhigh priority\\b') },
  { code: 'escalation', weight: 24, pattern: rx('\\bescalat(?:e|ed|ing|ion)\\b|\\bsev[- ]?[012]\\b|\\bp[01]\\b|\\boutage\\b|\\bincident\\b|\\bdown\\b(?=[^.!?\\n]{0,30}\\b(?:prod|production|site|service|api)\\b)') },
  { code: 'consequence_stated', weight: 16, pattern: rx('\\b(?:will|may|could) (?:be )?(?:expire|expires?|lapse|terminate[ds]?|be cancell?ed|be suspended|lose access)\\b|\\botherwise we\\b') },
  { code: 'explicit_date', weight: 8, pattern: rx('\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b') },
];

/**
 * Attempts by message content to direct the agent rather than inform it.
 *
 * A hit does not change the classification — it quarantines the message. The
 * brief reports what was attempted so a human sees the attempt instead of the
 * agent silently obeying or silently discarding it.
 */
export const INJECTION_SIGNALS = [
  { code: 'instruction_override', pattern: rx('\\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)\\b|\\bdisregard (?:your|all|the) (?:instructions?|rules?|system prompt)\\b') },
  { code: 'role_reassignment', pattern: rx('\\byou are (?:now )?(?:an?|the) (?:ai|assistant|agent|admin|system)\\b|\\bact as (?:an?|the) \\b|\\bnew (?:system )?(?:prompt|instructions?)\\s*:') },
  { code: 'fake_system_turn', pattern: rx('(?:^|\\n)\\s*(?:system|assistant|developer)\\s*:\\s|<\\s*\\/?\\s*(?:system|instructions?|important)\\s*>|\\[\\/?INST\\]') },
  { code: 'self_declared_priority', pattern: rx('(?:^|\\n)\\s*(?:priority|importance|urgency|classification)\\s*:\\s*(?:high|urgent|critical|p[01])\\b|\\bmark this (?:as |email as )?urgent\\b|\\bclassify this as\\b') },
  { code: 'exfiltration_request', pattern: rx('\\b(?:forward|send|share|paste|reply with)\\b[^.!?\\n]{0,60}\\b(?:api key|api_key|password|credential|secret|token|otp|one[- ]time (?:code|password)|seed phrase|private key|2fa)\\b|\\bsend (?:all|every|the last) \\d*\\s*(?:emails?|messages?)\\b') },
  { code: 'tool_direction', pattern: rx('\\b(?:call|invoke|run|execute)\\b[^.!?\\n]{0,40}\\b(?:tool|function|command|mcp)\\b|\\b(?:send_email|delete_email|bulk_delete_emails|empty_trash|paybox_[a-z_]+|submit_agent_wallet_transfer)\\b') },
];

/**
 * Attempts to move where money goes.
 *
 * Kept separate from the injection set because it is a different accusation.
 * An injection hit says the message tried to command the agent; this says the
 * message tried to redirect a payment. Both stop the message, but a human
 * reading the brief needs to know which one they are looking at.
 */
export const FRAUD_SIGNALS = [
  { code: 'payment_redirection', pattern: rx('\\b(?:updated?|new|changed?|corrected)\\b[^.!?\\n]{0,40}\\b(?:bank(?:ing)? (?:details|account)|wire (?:details|instructions)|iban|routing number|wallet address|payment (?:details|method))\\b|\\bremit(?:tance)? to\\b') },
  { code: 'credential_bait', pattern: rx('\\b(?:verify|confirm|re-?enter|update)\\b[^.!?\\n]{0,30}\\b(?:your )?(?:password|payment (?:details|method)|card details|billing information)\\b') },
];

/**
 * Credential-bearing mail that must not be summarized or drafted against.
 * Mermail routes this class to its own agent-inbox workflow; this skill
 * reports the message exists and stops.
 */
export const VERIFICATION_SIGNALS = [
  { code: 'verification_mail', pattern: rx('\\b(?:verify your (?:email|account)|confirm your (?:email|address)|magic link|sign[- ]?in link|one[- ]time (?:code|password)|\\botp\\b|password reset|reset your password|verification code|security code|2fa code)\\b') },
];
