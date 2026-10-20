// Browser copy of src/lib/protocol.ts for the fallback page. It must produce
// and accept exactly the same links; tests/protocol.test.ts checks this.

export const FORMAT = '1';

export function encode(message) {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(data) {
  if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new Error('This link is damaged.');
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!message || !['i', 'r', 'b', 'v', 'f'].includes(message.t) || typeof message.id !== 'string') {
    throw new Error("This link isn't a Lunch Mate link, or it's damaged.");
  }
  return message;
}

export function buildLink(host, message) {
  return `https://${host}/l/#${FORMAT}.${encode(message)}`;
}

export function parseLink(text) {
  const match = text.match(/\/l\/?#(\d+)\.([A-Za-z0-9_-]+)/);
  if (!match) return null;
  if (match[1] !== FORMAT) throw new Error('This link is from a newer version of Lunch Mate.');
  return decode(match[2]);
}

export const roundCoord = (v) => Math.round(v * 1e5) / 1e5;
