// Everything that knows about Gmail's DOM lives here, so a Gmail redesign
// means touching one file.

const BLOCK = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'HR']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'IMG', 'SVG', 'BUTTON', 'NOSCRIPT', 'HEAD', 'TITLE']);
const DROP_SELECTORS = '.gmail_quote, .gmail_signature, blockquote, .gmail_extra, [data-smartmail="gmail_signature"], .yj6qo';

// innerText doesn't lay out detached nodes, so we walk the clone ourselves.
function nodeToText(root) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return;
    const block = BLOCK.has(node.tagName);
    if (block) parts.push('\n');
    if (node.tagName === 'TD') parts.push(' ');
    for (const child of node.childNodes) walk(child);
    if (block) parts.push('\n');
  };
  walk(root);
  return parts.join('');
}

const isVisible = (el) => !!el && el.offsetParent !== null;

// The message the user is looking at = the last expanded message of the thread.
export function getOpenEmail() {
  const subjectEl = document.querySelector('h2.hP');
  if (!isVisible(subjectEl)) return null;

  const bodies = [...document.querySelectorAll('div.a3s')].filter(isVisible);
  const body = bodies[bodies.length - 1];
  if (!body) return null;

  const message = body.closest('div.adn') || body.closest('[data-message-id]') || document;
  const senderEl = message.querySelector('span.gD') || document.querySelector('span.gD');
  const idEl = body.closest('[data-message-id]') || message.querySelector('[data-legacy-message-id]');

  const clone = body.cloneNode(true);
  clone.querySelectorAll(DROP_SELECTORS).forEach((n) => n.remove());

  return {
    id: idEl?.getAttribute('data-message-id') || idEl?.getAttribute('data-legacy-message-id') || null,
    subject: subjectEl.textContent.trim(),
    fromName: (senderEl?.getAttribute('name') || senderEl?.textContent || '').trim(),
    fromEmail: senderEl?.getAttribute('email') || '',
    rawText: nodeToText(clone),
  };
}

const REPLY_LABEL = /^(rispondi|reply|responder|répondre|antworten)$/i;

function findReplyButton() {
  const candidates = document.querySelectorAll('[role="button"][aria-label], [role="button"][data-tooltip], span.ams.bkH');
  for (const el of candidates) {
    const label = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.textContent || '').trim();
    if (REPLY_LABEL.test(label) && isVisible(el)) return el;
  }
  return null;
}

function findComposeBox() {
  const boxes = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div.Am.Al.editable')].filter(isVisible);
  return boxes[boxes.length - 1] || null;
}

function waitFor(fn, timeout = 4000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const v = fn();
      if (v || performance.now() - start > timeout) resolve(v || null);
      else setTimeout(tick, 100);
    };
    tick();
  });
}

// Opens Gmail's reply box and types the draft into it. Never sends.
export async function insertReply(text) {
  let box = findComposeBox();
  if (!box) {
    const btn = findReplyButton();
    if (!btn) throw new Error('Pulsante "Rispondi" non trovato');
    btn.click();
    box = await waitFor(findComposeBox);
  }
  if (!box) throw new Error('Casella di risposta non trovata');

  box.focus();
  // execCommand keeps Gmail's editor state (undo, draft autosave) in sync;
  // the fallback covers browsers that drop it.
  const html = text
    .split('\n')
    .map((l) => l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) || '<br>')
    .map((l) => `<div>${l}</div>`)
    .join('');
  if (!document.execCommand('insertHTML', false, html)) {
    box.innerHTML = html + box.innerHTML;
    box.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}
