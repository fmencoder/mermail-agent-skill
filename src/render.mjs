/**
 * Renders a brief into one self-contained HTML page.
 *
 * The page is the review surface: inbox on the left, and for the selected
 * message its summary, action items, and the draft that would be saved. The
 * approve control is inert on purpose — approving here records a decision for
 * a human to carry back to the agent; the page has no credentials and cannot
 * call Mermail.
 *
 * The brief is embedded as JSON inside a script tag and parsed at load. Nothing
 * from a message is ever interpolated into markup as HTML.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** `</script>` inside embedded JSON would close the tag early; U+2028/U+2029
 * are literal line terminators in a script context. */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderBriefHtml(brief, options = {}) {
  const title = options.title ?? 'Mermail Inbox Brief';
  const subtitle = options.subtitle ?? 'mermail-inbox-brief · community skill';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --panel: #ffffff;
    --ink: #14171c;
    --muted: #5d6673;
    --line: #e2e5ea;
    --accent: #2f6df6;
    --crit: #c02626;
    --high: #d1631a;
    --med: #9a7b12;
    --low: #4a7a4d;
    --none: #6b7480;
    --code: #f2f4f7;
    --warn-bg: #fff4f4;
    --warn-line: #f0c8c8;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --panel: #161a21; --ink: #e6e9ee; --muted: #98a2b0;
      --line: #262c36; --accent: #6f9bff; --crit: #ff7a7a; --high: #ffab5e;
      --med: #e0c261; --low: #86c98a; --none: #8b949e; --code: #1c2129;
      --warn-bg: #24171a; --warn-line: #4d2b2f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: baseline;
    padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { font-size: 15px; margin: 0; letter-spacing: -0.01em; }
  header .sub { color: var(--muted); font-size: 12px; }
  header .stats { margin-left: auto; display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
  header .stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
  main { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 0; align-items: start; }
  @media (max-width: 880px) { main { grid-template-columns: 1fr; } }
  #list { border-right: 1px solid var(--line); background: var(--panel); max-height: calc(100vh - 56px); overflow-y: auto; }
  @media (max-width: 880px) { #list { max-height: 320px; border-right: 0; border-bottom: 1px solid var(--line); } }
  .row { display: block; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line);
         padding: 10px 14px; cursor: pointer; color: inherit; font: inherit; }
  .row:hover { background: var(--code); }
  .row[aria-current="true"] { background: color-mix(in srgb, var(--accent) 12%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
  .row .top { display: flex; gap: 8px; align-items: center; }
  .row .subj { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .who { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
          border: 1px solid currentColor; border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
  .u-critical { color: var(--crit); } .u-high { color: var(--high); } .u-medium { color: var(--med); }
  .u-low { color: var(--low); } .u-none { color: var(--none); }
  .pill.held { color: var(--crit); background: var(--warn-bg); }
  .tag { font-size: 10.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  #detail { padding: 20px 24px 60px; max-width: 860px; }
  section { margin-bottom: 26px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
       margin: 0 0 10px; font-weight: 700; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 12px; margin-top: 6px; }
  .subject { font-size: 17px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
  ul.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  ul.items li { border-left: 2px solid var(--line); padding-left: 12px; }
  .owner { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); }
  .due { font-size: 11px; color: var(--high); font-weight: 600; }
  blockquote { margin: 6px 0 0; padding: 6px 10px; background: var(--code); border-radius: 6px;
               font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: pre-wrap; word-break: break-word; }
  pre { margin: 0; background: var(--code); border-radius: 8px; padding: 12px 14px; overflow-x: auto;
        font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .ph { background: color-mix(in srgb, var(--high) 22%, transparent); border-radius: 3px; padding: 0 3px; font-weight: 600; }
  .warn { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 10px; padding: 14px 16px; }
  .warn h3 { margin: 0 0 6px; font-size: 13px; color: var(--crit); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
  button.act { font: inherit; font-weight: 600; border-radius: 8px; padding: 7px 14px; cursor: pointer;
               border: 1px solid var(--line); background: var(--panel); color: var(--ink); }
  button.act.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.act:disabled { opacity: .45; cursor: not-allowed; }
  .verdict { font-size: 12px; color: var(--muted); }
  .boundary { font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 10px; margin-top: 10px; }
  .empty { color: var(--muted); font-style: italic; }
  code.k { font-family: var(--mono); font-size: 12px; background: var(--code); border-radius: 4px; padding: 1px 5px; }
</style>
</head>
<body>
<header>
  <div>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">${escapeHtml(subtitle)}</div>
  </div>
  <div class="stats" id="stats"></div>
</header>
<main>
  <nav id="list" aria-label="Inbox"></nav>
  <div id="detail"></div>
</main>
<script id="brief-data" type="application/json">${embedJson(brief)}</script>
<script>
(function () {
  var brief = JSON.parse(document.getElementById('brief-data').textContent);
  var list = document.getElementById('list');
  var detail = document.getElementById('detail');
  var decisions = Object.create(null);
  var selected = brief.items.length ? brief.items[0].email_id : null;

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function stats() {
    var c = brief.counts;
    var pairs = [
      ['considered', c.considered], ['classified', c.classified], ['quarantined', c.quarantined],
      ['actions', c.action_items], ['drafts', c.drafts_available], ['malformed', c.malformed]
    ];
    var box = document.getElementById('stats');
    box.textContent = '';
    pairs.forEach(function (p) {
      var s = el('span', {}, [el('b', { text: String(p[1]) })]);
      s.appendChild(document.createTextNode(' ' + p[0]));
      box.appendChild(s);
    });
  }

  function renderList() {
    list.textContent = '';
    if (!brief.items.length) {
      list.appendChild(el('div', { class: 'row empty', text: 'No messages in this brief.' }));
      return;
    }
    brief.items.forEach(function (item) {
      var pill = el('span', { class: item.quarantine ? 'pill held' : 'pill u-' + item.urgency.level, text: item.quarantine ? 'held' : item.urgency.level });
      var top = el('div', { class: 'top' }, [
        el('span', { class: 'subj', text: item.subject }), pill
      ]);
      var who = el('div', { class: 'who', text: (item.from.display_name || item.from.address || 'unknown sender') + ' · ' + item.primary_class.replace(/_/g, ' ') });
      var row = el('button', { class: 'row', type: 'button', 'aria-current': String(item.email_id === selected) }, [top, who]);
      row.addEventListener('click', function () { selected = item.email_id; renderList(); renderDetail(); });
      list.appendChild(row);
    });
  }

  function evidenceBlock(quote) {
    return el('blockquote', { text: quote });
  }

  function draftBody(text) {
    var pre = el('pre');
    var re = /\\[\\[CONFIRM: ([^\\]]+)\\]\\]/g;
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      pre.appendChild(document.createTextNode(text.slice(last, m.index)));
      pre.appendChild(el('span', { class: 'ph', text: m[1] }));
      last = m.index + m[0].length;
    }
    pre.appendChild(document.createTextNode(text.slice(last)));
    return pre;
  }

  function renderDetail() {
    detail.textContent = '';
    var item = brief.items.filter(function (i) { return i.email_id === selected; })[0];
    if (!item) { detail.appendChild(el('p', { class: 'empty', text: 'Select a message.' })); return; }

    // MESSAGE
    var meta = el('div', { class: 'meta' });
    [
      (item.from.display_name ? item.from.display_name + ' ' : '') + '<' + (item.from.address || 'unknown') + '>',
      'auth: ' + item.from.authentication,
      'scan: ' + item.scan_status,
      item.received_at || 'no timestamp',
      'id: ' + item.email_id
    ].forEach(function (t) { meta.appendChild(el('span', { text: t })); });
    var tags = el('div', { class: 'meta' });
    item.classes.forEach(function (c) { tags.appendChild(el('span', { class: 'tag', text: c.replace(/_/g, ' ') })); });
    tags.appendChild(el('span', { class: 'tag', text: 'urgency ' + item.urgency.level + ' (' + item.urgency.score + ')' }));
    detail.appendChild(el('section', {}, [
      el('h2', { text: 'Message' }),
      el('div', { class: 'card' }, [el('p', { class: 'subject', text: item.subject }), meta, tags])
    ]));

    // QUARANTINE
    if (item.quarantine) {
      var warn = el('div', { class: 'warn' }, [
        el('h3', { text: 'Held: ' + item.quarantine.reason.replace(/_/g, ' ') }),
        el('p', { text: item.quarantine.detail })
      ]);
      item.quarantine.attempted.forEach(function (a) {
        warn.appendChild(el('div', { class: 'owner', text: a.code.replace(/_/g, ' ') + ' · ' + a.field }));
        warn.appendChild(evidenceBlock(a.evidence));
      });
      detail.appendChild(el('section', {}, [el('h2', { text: 'Security' }), warn]));
    }

    // SUMMARY
    var sum = el('div', { class: 'card' }, [el('p', { text: item.summary.text })]);
    var sumMeta = el('div', { class: 'meta' }, [el('span', { text: 'basis: ' + item.summary.basis })]);
    if (item.summary.note) sumMeta.appendChild(el('span', { text: item.summary.note }));
    sum.appendChild(sumMeta);
    detail.appendChild(el('section', {}, [el('h2', { text: 'AI summary' }), sum]));

    // ACTION ITEMS
    var actionCard = el('div', { class: 'card' });
    if (!item.action_items.length) {
      actionCard.appendChild(el('p', { class: 'empty', text: item.quarantine ? 'Not extracted — message is held.' : 'No action required.' }));
    } else {
      var ul = el('ul', { class: 'items' });
      item.action_items.forEach(function (a) {
        var head = el('div', {}, [el('span', { class: 'owner', text: a.owner + ' · ' + a.kind.replace(/_/g, ' ') })]);
        if (a.due) head.appendChild(el('span', { class: 'due', text: '  due ' + a.due + (a.due_precision === 'relative' ? ' (resolved from "' + a.due_expression + '")' : '') }));
        ul.appendChild(el('li', {}, [head, el('div', { text: a.text }), evidenceBlock(a.evidence.email_id + ' › ' + a.evidence.quote)]));
      });
      actionCard.appendChild(ul);
    }
    detail.appendChild(el('section', {}, [el('h2', { text: 'Action items' }), actionCard]));

    // DRAFT + APPROVE
    var draft = item.suggested_reply;
    var draftCard = el('div', { class: 'card' });
    if (!draft.available) {
      draftCard.appendChild(el('p', { class: 'empty', text: 'No draft: ' + draft.reason.replace(/_/g, ' ') + '.' }));
      detail.appendChild(el('section', {}, [el('h2', { text: 'Draft response' }), draftCard]));
    } else {
      draftCard.appendChild(draftBody(draft.body));
      if (draft.placeholders.length) {
        draftCard.appendChild(el('div', { class: 'meta' }, [
          el('span', { text: draft.placeholders.length + ' placeholder(s) a human must fill before this is sent.' })
        ]));
      }
      var call = el('details', {}, [
        el('summary', { text: 'Exact MCP call awaiting approval' }),
        el('pre', { text: JSON.stringify(draft.mcp_call, null, 2) })
      ]);
      draftCard.appendChild(call);

      var verdict = el('span', { class: 'verdict', text: decisions[item.email_id] ? 'Recorded: ' + decisions[item.email_id] : 'No decision recorded.' });
      var approve = el('button', { class: 'act primary', type: 'button', text: 'Approve save_draft' });
      var edit = el('button', { class: 'act', type: 'button', text: 'Needs edit' });
      var reject = el('button', { class: 'act', type: 'button', text: 'Discard' });
      [[approve, 'approved save_draft'], [edit, 'needs edit'], [reject, 'discarded']].forEach(function (pair) {
        pair[0].addEventListener('click', function () { decisions[item.email_id] = pair[1]; renderDetail(); });
      });
      draftCard.appendChild(el('div', { class: 'actions' }, [approve, edit, reject, verdict]));
      draftCard.appendChild(el('div', { class: 'boundary', text: 'This page holds no credentials and calls nothing. Approving records a decision for the agent to act on; the only tool it may then call is save_draft.' }));
      detail.appendChild(el('section', {}, [el('h2', { text: 'Draft response · approve / edit' }), draftCard]));
    }

    // BOUNDARIES
    var b = el('div', { class: 'card' });
    brief.boundaries.forEach(function (line) { b.appendChild(el('div', { class: 'boundary', text: line })); });
    detail.appendChild(el('section', {}, [el('h2', { text: 'Skill boundaries' }), b]));
  }

  stats();
  renderList();
  renderDetail();
})();
</script>
</body>
</html>
`;
}
