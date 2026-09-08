# `mermail.inbox-brief/v1`

The brief is a document, not prose. It is stable enough to diff between runs,
store next to a ticket, or feed to something downstream.

Determinism: the same payload and the same `now` produce byte-identical JSON.
That is what makes a brief reviewable in a pull request.

## Top level

```json
{
  "schema": "mermail.inbox-brief/v1",
  "generated_at": "2026-09-08T09:00:00.000Z",
  "source": { "mailbox_id": null, "mailbox_address": null, "tool": "list_emails", "label": null },
  "counts": { },
  "by_class": { "action_required": 4, "financial": 2 },
  "by_urgency": { "high": 1, "medium": 3, "none": 2 },
  "items": [ ],
  "defects": [ ],
  "approval_required": [ ],
  "boundaries": [ ]
}
```

### `counts`

Every message that entered is in exactly one of the coverage buckets. If these
do not add up, the brief is wrong and should say so rather than round.

| Field | Meaning |
| --- | --- |
| `received` | Records in the payload, including malformed and duplicate ones |
| `considered` | Records that became items, after `--limit` |
| `classified` | Items that were not quarantined |
| `quarantined` | Items set aside by a security rule |
| `metadata_only` | Items whose body could not be read |
| `malformed` | Records rejected before becoming items |
| `duplicates` | Records dropped as repeat `email_id`s |
| `action_items` | Total extracted across all items |
| `drafts_available` | Drafts built and awaiting approval |

### `defects`

Records that could not become items, each with its index in the payload and a
reason (`not_an_object`, `missing_email_id`). Kept rather than dropped: a brief
that quietly skipped three records is lying about its coverage.

### `approval_required`

One row per built draft — `email_id`, `subject`, `tool`, `effect`,
`placeholders`. Nothing here has been executed. This is the list a human works
through.

### `boundaries`

The skill's contract, restated in its own output so a downstream reader knows
what the document does and does not authorize.

## `items[]`

```json
{
  "email_id": "msg_001",
  "thread_id": "thr_apex",
  "from": { "address": "dana@apex-partners.example.com", "display_name": "Dana Whitfield", "authentication": "pass" },
  "subject": "Re: Apex renewal — need the signed addendum",
  "received_at": "2026-09-08T07:41:00.000Z",
  "folder": "inbox",
  "read": false,
  "scan_status": "clean",
  "classes": ["action_required", "financial", "follow_up"],
  "primary_class": "action_required",
  "urgent": false,
  "urgency": { "level": "medium", "score": 54, "urgent": false, "signals": [], "modifiers": [] },
  "summary": { "text": "…", "basis": "extractive", "note": null },
  "action_items": [ ],
  "attachments": [ ],
  "metadata_only": false,
  "truncated": false,
  "quarantine": null,
  "suggested_reply": { }
}
```

`from.authentication` is the provider verdict only: `pass`, `fail`, or
`unknown`. `unknown` is never treated as `pass`.

### `urgency`

`level` and `score` from the rubric; `urgent` is derived (`high` or above).
`signals` lists every signal that fired with its `code`, the `field` it fired in
(`subject` or `body`), and the quoted `evidence`. `modifiers` lists the
post-sum adjustments with a short reason.

An urgency level that cannot be traced to a quoted span is a bug.

### `summary`

`basis` is `extractive` (sentences taken from the message) or `subject_only`
(the body was not readable). `note` carries the reason for a degraded summary or
a truncation warning. Nothing here is paraphrased into existence.

### `action_items[]`

```json
{
  "text": "Could you review and sign the addendum by Thursday?",
  "owner": "you",
  "kind": "request",
  "due": "2026-09-10",
  "due_expression": "by thursday",
  "due_precision": "relative",
  "evidence": { "email_id": "msg_001", "field": "body", "quote": "Could you review and sign the addendum by Thursday?" }
}
```

| Field | Values |
| --- | --- |
| `owner` | `you`, `sender`, `unassigned` |
| `kind` | `request`, `question`, `sender_commitment`, `unresolved` |
| `due_precision` | `explicit` (message named a date) or `relative` (resolved from a phrase) |

`kind: "unresolved"` means the message read as a request but no single sentence
stated it. The item points at the signal instead of inventing a task.

A `relative` due date is the skill's arithmetic, not the sender's words. Always
show it next to `due_expression` so a human can check it.

### `quarantine`

`null`, or `{ reason, detail, attempted[] }` where `attempted` holds the signal
codes and quoted spans. Reasons: `injection_attempt`, `payment_redirection`,
`verification_mail`, `scan_flagged`.

A quarantined item keeps its classification and summary — enough to know what
arrived — and carries no action items and no draft.

### `suggested_reply`

```json
{
  "available": true,
  "reason": null,
  "body": "Hi Dana,\n\n…",
  "placeholders": ["yes / by when / blocked", "your name"],
  "mcp_call": {
    "tool": "save_draft",
    "effect": "internal_write",
    "requires_approval": true,
    "arguments": { "mailboxId": null, "body": { "to": "…", "subject": "Re: …", "body": "…" } },
    "notes": []
  }
}
```

When `available` is false, `reason` is one of `injection_attempt`,
`payment_redirection`, `verification_mail`, `scan_flagged`, `metadata_only`,
`unauthenticated_financial`, `no_reply_address`, `no_actionable_content` — and
`mcp_call` is `null`.

`mcp_call.tool` is always `save_draft`. There is no code path that emits a
send-side tool, which is why the guarantee holds without needing to be checked
at call time.

`placeholders` are the `[[CONFIRM: …]]` spans a human must replace. A draft with
placeholders is not sendable.

## Compatibility

Additive fields are minor changes. Removing a field, renaming one, or changing
the meaning of `urgency.score`, a class name, or a quarantine reason is a new
schema id (`mermail.inbox-brief/v2`). Consumers should ignore unknown fields and
must not infer meaning from key order.
