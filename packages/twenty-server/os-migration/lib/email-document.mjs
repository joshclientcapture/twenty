// Turns the HTML our email builders write (one wrapper div, paragraphs, bold, links, line
// breaks and {{variables}}) into the editor's native email document, so the workflow builder
// shows the email the way it sends and saving it keeps the styling.
//   import { htmlEmailToDocument, serializeEmailDocument } from './lib/email-document.mjs';

const SCHEMA_VERSION = 1;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') return String.fromCodePoint(parseInt(name.slice(1).replace(/^x/i, ''), name[1]?.toLowerCase() === 'x' ? 16 : 10));
    return ENTITIES[name.toLowerCase()] ?? match;
  });

const cssToStyle = (css) => {
  const style = {};
  for (const declaration of (css ?? '').split(';')) {
    const [property, ...rest] = declaration.split(':');
    if (!property || rest.length === 0) continue;
    const key = property.trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    style[key] = rest.join(':').trim();
  }
  return style;
};

const attribute = (tag, name) => {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag) ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return match ? decodeEntities(match[1]) : null;
};

// Inline text with marks; {{variables}} become chips the editor understands.
const inlineNodes = (text, marks) => {
  const nodes = [];
  const withMarks = (node) => (marks.length > 0 ? { ...node, marks: marks.map((mark) => ({ ...mark })) } : node);
  for (const part of decodeEntities(text).split(/(\{\{[^{}]+\}\})/)) {
    if (part === '') continue;
    if (/^\{\{[^{}]+\}\}$/.test(part)) nodes.push(withMarks({ type: 'variableTag', attrs: { variable: part } }));
    else nodes.push(withMarks({ type: 'text', text: part }));
  }
  return nodes;
};

const normaliseStyle = (style) => {
  const out = {};
  if (style.fontFamily) out.fontFamily = style.fontFamily;
  if (style.fontSize) out.fontSize = style.fontSize;
  if (style.lineHeight) out.lineHeight = style.lineHeight;
  if (style.color) out.color = style.color.length === 4 && style.color[0] === '#' ? `#${[...style.color.slice(1)].map((c) => c + c).join('')}` : style.color;
  if (style.maxWidth) out.maxWidth = style.maxWidth;
  return out;
};

export const htmlEmailToDocument = (html) => {
  const tokens = html.split(/(<[^>]+>)/).filter((token) => token !== '');
  let wrapper = {};
  const paragraphs = [];
  let current = null;
  const marks = [];
  const flush = () => {
    if (!current) return;
    // Whitespace-only paragraphs never appear in the builders; keep a real one even if empty.
    paragraphs.push(current);
    current = null;
  };
  for (const token of tokens) {
    if (token.startsWith('<')) {
      const tag = token.slice(1, -1).trim();
      const name = tag.replace(/^\//, '').split(/[\s/]/)[0].toLowerCase();
      const closing = tag.startsWith('/');
      if (name === 'div') {
        if (!closing && Object.keys(wrapper).length === 0) wrapper = normaliseStyle(cssToStyle(attribute(token, 'style')));
        continue;
      }
      if (name === 'p') {
        if (closing) flush();
        else { flush(); current = { style: normaliseStyle(cssToStyle(attribute(token, 'style'))), content: [] }; }
        continue;
      }
      if (name === 'br') { if (current) current.content.push({ type: 'hardBreak' }); continue; }
      if (name === 'strong' || name === 'b') { if (closing) marks.splice(marks.findIndex((mark) => mark.type === 'bold'), 1); else marks.push({ type: 'bold' }); continue; }
      if (name === 'em' || name === 'i') { if (closing) marks.splice(marks.findIndex((mark) => mark.type === 'italic'), 1); else marks.push({ type: 'italic' }); continue; }
      if (name === 'a') {
        if (closing) marks.splice(marks.findIndex((mark) => mark.type === 'link'), 1);
        else marks.push({ type: 'link', attrs: { href: attribute(token, 'href') ?? '', target: '_blank', rel: 'noopener noreferrer' } });
        continue;
      }
      throw new Error(`email html: unsupported tag <${name}>`);
    }
    if (!current) { if (token.trim() === '') continue; current = { style: {}, content: [] }; }
    current.content.push(...inlineNodes(token.replace(/\n/g, ' '), marks));
  }
  flush();

  // Paragraphs with the same look share a section; a blank line between paragraphs stands in
  // for the browser's default paragraph gap the raw HTML relied on.
  const sections = [];
  for (const paragraph of paragraphs) {
    // Left-aligned like the original wrapper div; the email renderer reads these margins as "hug the left edge".
    const style = { ...wrapper, ...paragraph.style, paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', marginLeft: '0px', marginRight: 'auto' };
    const key = JSON.stringify(style);
    const node = { type: 'paragraph', content: paragraph.content };
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.content.push({ type: 'paragraph' }, node);
    else {
      if (last) last.content.push({ type: 'paragraph' });
      sections.push({ key, style, content: [node] });
    }
  }
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION },
    content: sections.map((section) => ({ type: 'section', attrs: { style: section.style }, content: section.content })),
  };
};

export const serializeEmailDocument = (document) => JSON.stringify(document);

// Plain-text rendering, handy for eyeballing a conversion.
export const documentToText = (document) =>
  document.content
    .flatMap((section) => section.content)
    .map((paragraph) => (paragraph.content ?? []).map((node) => (node.type === 'text' ? node.text : node.type === 'variableTag' ? node.attrs.variable : node.type === 'hardBreak' ? '\n' : '')).join(''))
    .join('\n');
