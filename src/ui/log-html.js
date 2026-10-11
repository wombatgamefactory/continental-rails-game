// log-html.js - one log entry as HTML.

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** @param {object} entry from log.js entriesFromEvents; @param {object} state for the player colour */
export function entryHtml(entry, state) {
  const colour = entry.colour || '#888888';
  if (entry.turn !== null) {
    return `<li class="log__turn" style="--pc:${colour}"><span class="score__dot"></span> ${esc(entry.text)} - ${esc(entry.name)}</li>`;
  }
  const details = entry.details.length
    ? `<ul class="log__details">${entry.details.map((d) => `<li class="log__d log__d--${d.kind}">${esc(d.text)}</li>`).join('')}</ul>`
    : '';
  const tag = entry.auto ? ' <span class="log__auto" title="This was the only legal choice, so the game made it for you">automatic</span>' : '';
  const src = entry.source === 'bot' ? ' <span class="log__bot">bot</span>' : '';
  return `<li class="log__entry${entry.auto ? ' is-auto' : ''}${entry.kind ? ` log__entry--${entry.kind}` : ''}" data-auto="${entry.auto ? 1 : 0}" style="--pc:${colour}" data-seq="${entry.seq}"><span class="score__dot"></span> <b>${esc(entry.name)}</b> ${esc(entry.text)}${tag}${src}${details}</li>`;
}
