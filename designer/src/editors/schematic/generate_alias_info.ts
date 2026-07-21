/**
 * Generates the HTML for the chooser's details pane from a library symbol.
 * Mirrors kicad/eeschema/generate_alias_info.cpp (GenerateAliasInfo): bold
 * name, "Derived from", description, keywords, then an <hr> and a field table
 * with the datasheet rendered as a (truncated) link.
 */
import type { LibSymbol } from '@ziroeda/eeschema';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** LinkifyHTML — turn bare http(s) URLs in the description into links. */
function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
  );
}

function linkRow(text: string): string {
  const shown = text.length > 75 ? `${text.slice(0, 72)}...` : text;
  return `<a href="${escapeHtml(text)}" target="_blank" rel="noreferrer">${escapeHtml(shown)}</a>`;
}

function fieldRow(name: string, valueHtml: string): string {
  return `<tr><td><b>${escapeHtml(name)}</b></td><td>${valueHtml}</td></tr>`;
}

export function generateAliasInfo(symbol: LibSymbol): string {
  const prop = (key: string): string => symbol.properties.find((p) => p.key === key)?.value ?? '';

  const name = symbol.libId.split(':').pop() ?? symbol.libId;
  let html = `<b>${escapeHtml(name)}</b>`;

  if (symbol.extends) html += `<br><i>Derived from ${escapeHtml(symbol.extends)}</i>`;

  const desc = prop('Description');
  if (desc) html += `<br>${linkify(escapeHtml(desc)).replace(/\n/g, '<br>')}`;

  const keywords = prop('ki_keywords');
  if (keywords) html += `<br>Keywords: ${escapeHtml(keywords)}`;

  html += '<hr><table border="0">';

  for (const field of symbol.properties) {
    switch (field.key) {
      case 'Value':
        // Showing the value just repeats the name, so that's not much use.
        break;
      case 'Description':
      case 'ki_keywords':
      case 'ki_fp_filters':
        // Rendered above / internal — not part of the field table upstream.
        break;
      case 'Datasheet': {
        const text = field.value;
        html += fieldRow(field.key, !text || text === '~' ? escapeHtml(text) : linkRow(text));
        break;
      }
      default:
        html += fieldRow(
          field.key,
          /^https?:\/\//.test(field.value) ? linkRow(field.value) : escapeHtml(field.value),
        );
    }
  }

  html += '</table>';
  return html;
}
