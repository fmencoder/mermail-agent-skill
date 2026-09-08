/**
 * Ingest and normalization layer.
 *
 * Input is whatever the Mermail MCP host returned from `list_emails`,
 * `search_emails`, `get_email`, or `get_thread`. Field names and nesting vary
 * by tool and by host, and any field may be absent, so every accessor here is
 * total: it returns a well-formed record or an explicit defect, never a throw.
 *
 * Everything that came out of a message — subject, body, headers, display
 * names, attachment names — is untrusted data. It is normalized for reading
 * and never interpreted as an instruction.
 */

/** Characters that let untrusted text redraw itself in a terminal or reorder
 * visually against its own code points. Stripped before anything reads them. */
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ANSI_RE = /\u001B\[[0-?]*[ -\/]*[@-~]|\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Per-message read budget. Bounded so a single hostile message cannot
 * consume the whole brief's attention. See references/security.md. */
export const MAX_BODY_CHARS = 10000;

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function pick(source, names) {
  if (!source || typeof source !== 'object') return undefined;
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Unwraps the container shapes Mermail tools and MCP hosts wrap results in. */
export function unwrapMessages(payload) {
  const seen = new Set();
  let node = payload;
  for (let depth = 0; depth < 8; depth += 1) {
    // Non-object entries are kept, not filtered: they become explicit defects
    // downstream so the brief's coverage count stays honest.
    if (Array.isArray(node)) return node;
    if (!node || typeof node !== 'object') return [];
    if (seen.has(node)) return [];
    seen.add(node);
    const next = pick(node, ['emails', 'messages', 'items', 'results', 'data', 'result', 'thread', 'content']);
    if (next === undefined) return [];
    node = next;
  }
  return [];
}

export function sanitizeText(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(ANSI_RE, '')
    .replace(BIDI_RE, '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strips tags and decodes the handful of entities that survive tag removal.
 * Active content (script/style) is dropped whole rather than de-tagged. */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return sanitizeText(
    html
      .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]{2,}/g, ' '),
  );
}

/** Drops the quoted history below a reply marker. The brief is about what this
 * message says, not what the whole thread already said. */
export function stripQuotedHistory(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*(On .+ wrote:|-{2,}\s*Original Message\s*-{2,}|_{5,}|From:\s.+)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const trimmed = out.join('\n').trim();
  return trimmed.length > 0 ? trimmed : text.trim();
}

function normalizeAddress(value) {
  if (value == null) return { address: '', display_name: '' };
  if (typeof value === 'string') {
    const angled = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (angled) {
      return {
        address: sanitizeText(angled[2]).toLowerCase(),
        display_name: sanitizeText(angled[1]).replace(/^["']|["']$/g, ''),
      };
    }
    return { address: sanitizeText(value).toLowerCase(), display_name: '' };
  }
  if (typeof value === 'object') {
    const address = pick(value, ['address', 'email', 'value', 'addr']);
    const display = pick(value, ['display_name', 'displayName', 'name', 'label']);
    return {
      address: sanitizeText(typeof address === 'string' ? address : '').toLowerCase(),
      display_name: sanitizeText(typeof display === 'string' ? display : ''),
    };
  }
  return { address: '', display_name: '' };
}

/**
 * Provider-derived SPF/DKIM/DMARC verdict only.
 *
 * A raw `Authentication-Results` header, a `From` value, or a `Return-Path`
 * cannot promote this to `pass` — they are attacker-controlled. Anything that
 * is not an explicit provider `pass` is reported as `unknown`, and `unknown`
 * is never treated as `pass`.
 */
export function readSenderAuthentication(raw) {
  const holder = pick(raw, ['sender_authentication', 'senderAuthentication']);
  const status = typeof holder === 'string' ? holder : pick(holder, ['status', 'result', 'verdict']);
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'pass' || value === 'fail') return value;
  return 'unknown';
}

function readScanStatus(raw) {
  const value = pick(raw, ['scan_status', 'scanStatus', 'security_scan_status']);
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'clean' || text === 'flagged' || text === 'skipped') return text;
  return 'unknown';
}

function readTimestamp(raw) {
  const value = pick(raw, ['received_at', 'receivedAt', 'date', 'created_at', 'createdAt', 'sent_at', 'timestamp']);
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readBody(raw) {
  const text = pick(raw, ['text', 'body_text', 'bodyText', 'plain', 'plain_text']);
  if (typeof text === 'string' && text.trim()) return { text: sanitizeText(text), source: 'text' };
  const body = pick(raw, ['body']);
  if (typeof body === 'string' && body.trim()) {
    return /<[a-z][\s\S]*>/i.test(body)
      ? { text: htmlToText(body), source: 'html' }
      : { text: sanitizeText(body), source: 'text' };
  }
  const html = pick(raw, ['html', 'body_html', 'bodyHtml']);
  if (typeof html === 'string' && html.trim()) return { text: htmlToText(html), source: 'html' };
  const snippet = pick(raw, ['snippet', 'preview', 'summary']);
  if (typeof snippet === 'string' && snippet.trim()) return { text: sanitizeText(snippet), source: 'snippet' };
  return { text: '', source: 'none' };
}

function readAttachments(raw) {
  const list = asArray(pick(raw, ['attachments', 'files']));
  return list
    .map((item) => {
      if (typeof item === 'string') return { filename: sanitizeText(item), size: null, id: null };
      if (!item || typeof item !== 'object') return null;
      const size = pick(item, ['size', 'bytes', 'size_bytes']);
      const id = pick(item, ['id', 'attachment_id', 'attachmentId']);
      return {
        filename: sanitizeText(String(pick(item, ['filename', 'name', 'file_name']) ?? 'attachment')),
        size: typeof size === 'number' ? size : null,
        id: typeof id === 'string' ? id : null,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Normalizes one raw Mermail message.
 *
 * Returns `{ ok: true, message }` or `{ ok: false, defect }`. A message with no
 * usable identifier is a defect: an item in the brief has to be addressable
 * back to the mailbox, otherwise its claims cannot be audited.
 */
export function normalizeMessage(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, defect: { index, reason: 'not_an_object' } };
  }

  const idValue = pick(raw, ['id', 'email_id', 'emailId', 'message_id', 'messageId', 'public_id', 'publicId']);
  const id = typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : '';
  if (!id) return { ok: false, defect: { index, reason: 'missing_email_id' } };

  const threadValue = pick(raw, ['thread_id', 'threadId', 'conversation_id', 'conversationId']);
  const from = normalizeAddress(pick(raw, ['from', 'sender', 'from_address', 'fromAddress']));
  const to = asArray(pick(raw, ['to', 'to_addresses', 'recipients'])).map(normalizeAddress).filter((a) => a.address);

  const subjectRaw = pick(raw, ['subject', 'title']);
  const subject = sanitizeText(typeof subjectRaw === 'string' ? subjectRaw : '');

  const scanStatus = readScanStatus(raw);
  const contentOmitted = pick(raw, ['content_omitted', 'contentOmitted']) === true;

  // Body is read only when the provider says the message scanned clean and
  // did not withhold content. Otherwise the item stays metadata-only.
  let bodyText = '';
  let bodySource = 'withheld';
  let truncated = false;
  if (scanStatus === 'clean' && !contentOmitted) {
    const body = readBody(raw);
    bodySource = body.source;
    const stripped = stripQuotedHistory(body.text);
    truncated = stripped.length > MAX_BODY_CHARS;
    bodyText = truncated ? stripped.slice(0, MAX_BODY_CHARS) : stripped;
  }

  const folderValue = pick(raw, ['folder', 'folder_id', 'folderId', 'mailbox_folder']);
  const readFlag = pick(raw, ['read', 'is_read', 'isRead', 'seen']);

  return {
    ok: true,
    message: {
      email_id: id,
      thread_id: typeof threadValue === 'string' || typeof threadValue === 'number' ? String(threadValue) : null,
      from,
      to,
      subject,
      received_at: readTimestamp(raw),
      folder: typeof folderValue === 'string' ? folderValue : null,
      read: typeof readFlag === 'boolean' ? readFlag : null,
      scan_status: scanStatus,
      sender_authentication: readSenderAuthentication(raw),
      content_omitted: contentOmitted,
      body_text: bodyText,
      body_source: bodySource,
      truncated,
      attachments: readAttachments(raw),
    },
  };
}

/** Normalizes a whole tool payload, keeping defects rather than dropping them
 * silently — a brief that quietly skipped three malformed records is a brief
 * that lies about its own coverage. */
export function normalizePayload(payload) {
  const raw = unwrapMessages(payload);
  const messages = [];
  const defects = [];
  raw.forEach((item, index) => {
    const result = normalizeMessage(item, index);
    if (result.ok) messages.push(result.message);
    else defects.push(result.defect);
  });
  const seen = new Set();
  const deduped = messages.filter((m) => {
    if (seen.has(m.email_id)) return false;
    seen.add(m.email_id);
    return true;
  });
  return { messages: deduped, defects, duplicates: messages.length - deduped.length };
}
