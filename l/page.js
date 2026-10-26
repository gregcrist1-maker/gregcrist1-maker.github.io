// Fallback for guests without the app: read the lunch from the link, let them
// RSVP and vote, and hand them a reply message to send to the organizer.
// The reply texts match src/lib/messages.ts in the app.

import { buildLink, parseLink, roundCoord } from './codec.js';

const $ = (id) => document.getElementById(id);
const host = location.host;

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
// "Wed, Oct 21, 12:00 PM, 1:00 PM; Thu, Oct 22, 12:30 PM", as in the app.
function listTimes(times) {
  const byDay = [];
  for (const t of times) {
    const day = fmtDay(t);
    if (!byDay.length || byDay[byDay.length - 1][0] !== day) byDay.push([day]);
    byDay[byDay.length - 1].push(fmtTime(t));
  }
  return byDay.map(([day, ...hours]) => `${day}, ${hours.join(', ')}`).join('; ');
}
const fmtMinutes = (s) =>`${Math.max(1, Math.round(s / 60))} min`;
const mapsLink = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.n)}%20${s.la},${s.lo}`;

// This browser's RSVP and vote for each lunch. Kept so a later ballot link
// knows who's voting. Losing it only means RSVPing again.
const store = {
  get(id) {
    try { return JSON.parse(localStorage.getItem(`lunchmate:${id}`)) || null; } catch { return null; }
  },
  set(id, value) {
    try { localStorage.setItem(`lunchmate:${id}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(bytes, (b) => alphabet[b & 63]).join('');
}

function show(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Location permission was denied. Allow it for this site in your browser settings, then try again.'
        : "Couldn't get your location. Try again.")),
      { timeout: 15000, maximumAge: 60000 },
    );
  });
}

function offerToSend(heading, note, text) {
  $('sendHeading').textContent = heading;
  $('sendNote').textContent = note;
  $('sendText').value = text;
  // iPhone uses "sms:&body=", Android "sms:?body="; both accept "?&body=".
  $('smsBtn').href = `sms:?&body=${encodeURIComponent(text)}`;
  $('shareBtn').hidden = !navigator.share;
  $('send').hidden = false;
  $('send').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHeader(m) {
  $('header').hidden = false;
  $('title').textContent = m.ti;
  const when = m.ts && m.t !== 'f' ? `${m.ts.length} possible times` : fmtWhen(m.at);
  $('meta').textContent = `${when} · organized by ${m.o}`;
  document.title = `${m.ti} · Lunch Mate`;
}

function renderRsvp(m, me) {
  $('rsvp').hidden = false;
  $('rsvp').classList.toggle('highlight', !me);
  $('rsvpHeading').textContent = me ? "You're in" : 'RSVP';
  $('rsvpNote').textContent = me
    ? `${m.o} gets your RSVP when they tap the link you send. Moved? Send an updated one.`
    : `${m.o} uses everyone's location to find a spot that suits the group. Only people in this lunch see it.`;
  if (m.ts) $('rsvpNote').textContent += ` Possible times: ${listTimes(m.ts)}. You'll pick the ones that work when you vote.`;
  $('rsvpBtn').textContent = me ? 'Send updated RSVP' : 'Share my location and RSVP';
  const form = $('rsvpForm');
  if (me && !form.name.value) form.name.value = me.n;

  form.onsubmit = async (e) => {
    e.preventDefault();
    show('error', '');
    const button = $('rsvpBtn');
    button.disabled = true;
    try {
      const name = form.name.value.trim();
      if (!name) throw new Error('Add your name so the group knows who you are.');
      const here = await getLocation();
      const saved = { ...(store.get(m.id) || { g: newId() }), n: name, la: roundCoord(here.lat), lo: roundCoord(here.lng) };
      store.set(m.id, saved);
      const link = buildLink(host, { t: 'r', id: m.id, g: saved.g, n: saved.n, la: saved.la, lo: saved.lo });
      offerToSend('Send your RSVP', `Send this to ${m.o}, or to the group chat they're in.`,
        `${saved.n} is in for lunch (${m.ti}).\n${m.o}, tap to add: ${link}`);
      renderRsvp(m, saved);
      if (m.t === 'b') {
        renderTimes(m, saved);
        renderVote(m, saved);
      }
    } catch (err) {
      show('error', err.message);
    } finally {
      button.disabled = false;
    }
  };
}

// The vote message, with the times this person can make when the lunch has times.
function voteMessage(m, me, spot) {
  const avail = m.ts ? me.avail || [] : undefined;
  const link = buildLink(host, { t: 'v', id: m.id, g: me.g, n: me.n, c: spot.i, ...(avail ? { a: avail } : {}) });
  const times = !m.ts ? '' : avail.length === 0
    ? " Can't make any of the times."
    : ` Can make: ${listTimes(avail.map((k) => m.ts[k]))}.`;
  return `${me.n} votes for ${spot.n}.${times}\n${m.o}, tap to count it: ${link}`;
}

function renderTimes(m, me) {
  if (!m.ts || !me) return;
  $('times').hidden = false;
  const mine = me.avail || [];
  $('timeList').replaceChildren(...m.ts.map((t, k) => {
    const yes = mine.includes(k);
    const li = document.createElement('li');
    if (yes) li.className = 'mine';
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = fmtWhen(t);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = yes ? '✓ Yes' : 'No';
    if (yes) button.className = 'primary';
    button.onclick = () => {
      const next = (yes ? mine.filter((x) => x !== k) : [...mine, k]).sort((a, b) => a - b);
      const saved = { ...me, avail: next };
      store.set(m.id, saved);
      renderTimes(m, saved);
      renderVote(m, saved);
      // Already voted: the new times reach the organizer only in a new vote message.
      const spot = saved.vote && m.c.find((s) => s.i === saved.vote);
      if (spot) offerToSend('Send your updated times', `Send this to ${m.o}.`, voteMessage(m, saved, spot));
    };
    li.append(label, button);
    return li;
  }));
}

function renderVote(m, me) {
  $('vote').hidden = false;
  $('voteNote').textContent = me
    ? `Tap Vote, then send the message to ${m.o}. You can change your vote until they close voting.`
    : 'RSVP first, so your travel time is included.';
  const list = $('spots');
  list.replaceChildren(...m.c.map((s) => {
    const mine = me && me.vote === s.i;
    const li = document.createElement('li');
    if (mine) li.className = 'mine';
    const info = document.createElement('span');
    info.className = 'grow';
    const name = document.createElement('a');
    name.href = mapsLink(s);
    name.target = '_blank';
    name.rel = 'noopener';
    name.textContent = s.n;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = [s.a, s.r ? `★ ${s.r.toFixed(1)}` : ''].filter(Boolean).join(' · ');
    info.append(name, sub);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mine ? 'Your pick' : 'Vote';
    if (mine) button.className = 'primary';
    button.disabled = !me;
    button.onclick = () => {
      const saved = { ...me, vote: s.i };
      store.set(m.id, saved);
      offerToSend('Send your vote', `Send this to ${m.o}.`, voteMessage(m, saved, s));
      renderTimes(m, saved);
      renderVote(m, saved);
    };
    li.append(info, button);
    return li;
  }));
}

function renderPlan(m, me) {
  $('plan').hidden = false;
  const spot = $('spotLink');
  spot.textContent = m.s.n;
  spot.href = mapsLink(m.s);
  $('spotAddress').textContent = m.s.a;
  const mine = me && m.p.find((p) => p.g === me.g);
  const out = m.x || [];
  const meOut = me && out.some((p) => p.g === me.g);
  $('myLeave').innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = mine
    ? `You leave by ${fmtTime(mine.l)} (${fmtMinutes(mine.s)} away).`
    : meOut
      ? `You said you can't make this time. Everyone else leaves by ${fmtTime(m.e)}.`
      : `Everyone leaves by ${fmtTime(m.e)}.`;
  $('myLeave').append(strong);
  $('planNote').textContent = `Lunch is at ${fmtWhen(m.at)}, with ${m.bu} minutes to spare.` +
    (new Date(m.e) < new Date() ? ' The earliest leave-by time has already passed.' : '') +
    (out.length ? ` Can't make this time: ${out.map((p) => p.n).join(', ')}.` : '');
  $('planRows').replaceChildren(...m.p.map((p) => {
    const tr = document.createElement('tr');
    if (mine && p.g === mine.g) tr.className = 'mine';
    for (const text of [mine && p.g === mine.g ? `${p.n} (you)` : p.n, fmtMinutes(p.s), fmtTime(p.l)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
}

async function copyMessage() {
  const text = $('sendText').value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $('sendText').select();
    document.execCommand('copy');
  }
  $('copyBtn').textContent = 'Copied';
  setTimeout(() => { $('copyBtn').textContent = 'Copy message'; }, 1500);
}

function init() {
  // Opening another Lunch Mate link in this tab only changes the part after
  // "#", which doesn't reload the page by itself.
  window.addEventListener('hashchange', () => location.reload());
  $('copyBtn').onclick = copyMessage;
  $('shareBtn').onclick = () => navigator.share({ text: $('sendText').value }).catch(() => {});

  let m;
  try {
    m = parseLink(location.href);
  } catch (err) {
    return show('error', err.message);
  }
  if (!m) return show('error', "This link is incomplete. Ask whoever sent it to send it again.");

  const me = store.get(m.id);
  if (m.t === 'r' || m.t === 'v') {
    $('reply').hidden = false;
    return;
  }
  renderHeader(m);
  if (m.t === 'i') renderRsvp(m, me);
  if (m.t === 'b') {
    renderRsvp(m, me);
    renderTimes(m, me);
    renderVote(m, me);
  }
  if (m.t === 'f') renderPlan(m, me);
}

init();
