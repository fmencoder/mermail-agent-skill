# Classification rubric

The contract between "this message is urgent" and something a reviewer can
argue with. Every signal below has a `code` that appears verbatim in the brief,
next to the span of text that fired it.

`src/rubric.mjs` is the executable copy of this file, and `npm test` fails if
the two drift apart.

## Two axes

**Class** is what the message is about. A message can carry several.

| Class | Meaning |
| --- | --- |
| `action_required` | Someone is waiting on the reader to do or decide something |
| `financial` | Money: invoices, payments, quotes, renewals, refunds |
| `scheduling` | Time: meetings, availability, reschedules, cancellations |
| `follow_up` | A second (or fifth) attempt at an earlier ask |
| `informational` | Nothing is being asked |

`informational` is also the fallback when no signal fires at all. The
informational ceiling below applies only when it was *earned* — a message where
no signal fired keeps whatever urgency score it accumulated, because "we could
not categorize this and it says the site is down" must not be capped to silence.

**Urgency** is how soon it matters: `none`, `low`, `medium`, `high`, `critical`,
from a 0–100 score. `urgent` is a derived flag, true at `high` and above — not
a sixth class.

| Level | Score |
| --- | --- |
| `critical` | ≥ 80 |
| `high` | ≥ 55 |
| `medium` | ≥ 30 |
| `low` | ≥ 12 |
| `none` | < 12 |

## Class signals

Each fires at most once per message. Repeating a phrase is a rhetorical choice
by the sender, not additional evidence — stacking would hand senders control of
their own priority.

| Code | Class | Weight | Fires on |
| --- | --- | ---: | --- |
| `explicit_request` | action_required | 14 | "can/could/would you", "please review/send/confirm…", "please advise" |
| `approval_requested` | action_required | 16 | needs your approval / sign-off / authorization |
| `blocked_on_you` | action_required | 20 | blocked, blocker, stuck, cannot proceed, holding this up |
| `question_direct` | action_required | 8 | a wh- or auxiliary question aimed at the reader |
| `decision_requested` | action_required | 12 | "let me know", "your call", "which option", go/no-go |
| `invoice_or_bill` | financial | 12 | invoice, bill, receipt, statement, purchase order |
| `payment_due` | financial | 18 | amount due, due by/on, payable by, net 30 |
| `overdue` | financial | 26 | overdue, past due, late fee, final notice, service suspension |
| `money_amount` | financial | 6 | a currency amount, including USDC and SOL |
| `contract_terms` | financial | 8 | quote, estimate, renewal, subscription, refund, pricing |
| `meeting_request` | scheduling | 12 | schedule/book/arrange a call, "are you free" |
| `invite_or_calendar` | scheduling | 10 | calendar invite, `.ics`, Meet / Zoom / Teams links |
| `proposed_time` | scheduling | 10 | a weekday paired with a clock time, or a time with a zone |
| `cancellation` | scheduling | 14 | cancelled, postponed, moved, no longer available |
| `second_attempt` | follow_up | 14 | following up, circling back, bumping, "per my last email" |
| `awaiting_reply` | follow_up | 10 | still waiting, no response, "did you see my" |
| `reply_marker` | follow_up | 4 | subject begins `Re:` or `Fwd:` |
| `newsletter` | informational | 0 | unsubscribe, manage preferences, view in browser, no-reply@ |
| `automated_notice` | informational | 0 | "this is an automated…", status page, build/deploy notices |

The two informational signals carry weight 0 on purpose: a newsletter that shouts
"URGENT" cannot climb on class weight. Only a real urgency signal moves it, and
the ceiling then pulls it back.

## Urgency signals

These move the score without voting for a class, so urgent-sounding language can
never manufacture an action item.

| Code | Weight | Fires on |
| --- | ---: | --- |
| `deadline_today` | 30 | today, EOD, COB, tonight |
| `deadline_tomorrow` | 22 | tomorrow, next business day |
| `deadline_this_week` | 14 | "by Friday", this week, end of week, EOW |
| `explicit_urgency` | 20 | urgent, ASAP, immediately, time-sensitive, high priority |
| `escalation` | 24 | escalate, SEV-0/1/2, P0/P1, outage, incident, production down |
| `consequence_stated` | 16 | will expire / lapse / be cancelled / be suspended / lose access |
| `explicit_date` | 8 | a named or ISO calendar date |

## Modifiers

Applied in order, after the signal sum:

| Code | Effect | When |
| --- | --- | --- |
| `unread_request_aging` | +8 | an `action_required` message, unread, older than 72h |
| `informational_ceiling` | caps at 11 | the message earned `informational` and nothing else |
| `unauthenticated_financial` | +10 | `financial` with `sender_authentication !== "pass"` |

The score is then clamped to 0–100.

`unauthenticated_financial` raises urgency *and* blocks the draft
([security.md](security.md#draft-eligibility)). Those are two different correct
responses to the same fact: a human should look at it sooner, and the agent
should not write a fluent reply to it.

## Quarantine signals

These do not score. A single hit sets the message aside, and the brief shows the
code and the quoted span. See [security.md](security.md#quarantine-rules) for
what each one means and why it stops there.

| Code | Reason | Fires on |
| --- | --- | --- |
| `instruction_override` | `injection_attempt` | "ignore previous instructions", "disregard your rules" |
| `role_reassignment` | `injection_attempt` | "you are now an assistant", "act as", "new system prompt:" |
| `fake_system_turn` | `injection_attempt` | a forged `System:` / `Assistant:` turn, `<system>` tags, `[INST]` |
| `self_declared_priority` | `injection_attempt` | `Priority: High`, "mark this as urgent", "classify this as" |
| `exfiltration_request` | `injection_attempt` | asks to send or reply with keys, passwords, OTPs, or bulk mail |
| `tool_direction` | `injection_attempt` | names a tool or asks for one to be called |
| `payment_redirection` | `payment_redirection` | new/updated bank, wire, IBAN, routing, or wallet details |
| `credential_bait` | `payment_redirection` | "verify your password", "update your card details" |
| `verification_mail` | `verification_mail` | OTP, one-time code, magic link, password reset |

A flagged scan (`scan_status: "flagged"`) quarantines with reason
`scan_flagged` and needs no content signal — Mermail already judged it.

## Ordering

Urgency level, then score, then most recent first. Quarantined messages keep
their computed urgency but are shown as held.

## Extending it

Add a signal with a distinct `code`, a class or urgency weight, and a row in
this table. Argue for the weight relative to its neighbours: `overdue` sits at
26 because a final notice earns more than a mention of an invoice, and below
`deadline_today` at 30 because a date beats a tone. Weights are a claim about
relative importance, and a reviewer should be able to disagree with one number
rather than with the whole file.
