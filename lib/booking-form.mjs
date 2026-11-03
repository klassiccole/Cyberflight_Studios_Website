/* Pure validation + email composition for the shoot-request form.
   The handler verifies Turnstile/honeypot, then calls in here. No database,
   no calendar: the request is relayed to the owner mailbox and the real
   scheduling happens in the follow-up conversation. */

const SHOT_LABELS = { graduation: 'Graduation Portraits', 'real-estate': 'Real Estate Photography', portraits: 'Professional Portraits' };
const RE_PACKAGE_LABELS = {
  t1: { label: 'Up to 2,000 sq ft', priceLabel: '$150' },
  t2: { label: '2,000 – 3,500 sq ft', priceLabel: '$200' },
  t3: { label: 'Over 3,500 sq ft', priceLabel: 'from $250' }
};
const PACKAGE_LABELS = {
  mini: { label: 'Mini Session', price: 125, priceLabel: '$125' },
  standard: { label: 'Standard Session', price: 200, priceLabel: '$200' },
  group: { label: 'Group Session', price: 280, priceLabel: 'from $280' }
};
/* Professional Portraits mirrors the grad pricing minus the group tier. */
const PP_PACKAGE_LABELS = {
  mini: PACKAGE_LABELS.mini,
  standard: PACKAGE_LABELS.standard
};
const TIME_LABELS = { flexible: 'No preference', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const CONTACT_PREFS = { call: 'call', text: 'text', email: 'email', none: 'no preference' };

export class BookingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function text(value, max, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  const result = String(value ?? '').trim().slice(0, max);
  if (!optional && !result) throw new BookingError('missing_fields');
  return result;
}
function email(value) {
  const v = text(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new BookingError('invalid_email');
  return v;
}
/* Keep enough digits to dial; strip formatting. */
function phone(value) {
  const v = String(value ?? '').trim();
  const digits = v.replace(/\D/g, '');
  if (v.length === 0 || v.length > 30 || digits.length < 7 || digits.length > 15) throw new BookingError('invalid_phone');
  return v;
}
export function phoneDigits(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
function futureDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new BookingError('invalid_date');
  const past = [Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))];
  const year = past[0], month = past[1] - 1, day = past[2];
  const ms = Date.UTC(year, month, day, 12);
  if (Object.is(new Date(ms).getUTCMonth(), month) === false || Object.is(new Date(ms).getUTCDate(), day) === false) throw new BookingError('invalid_date');
  /* Not before today in Charlotte (owner's phone is the scheduling source of
     truth, so only obvious nonsense like yesterday is rejected). */
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const today = parts.filter(p => p.type !== 'literal').map(p => p.value).join('-');
  if (value < today) throw new BookingError('invalid_date');
  return value;
}
function enumValue(value, map, error) {
  if (!Object.hasOwn(map, value)) throw new BookingError(error);
  return value;
}
const GRAD_PLACES = { unccharlotte: 'UNC Charlotte campus', other: null };
function dateDisplay(value) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
}
export function dateKeyPlusOne(value) {
  const next = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)) + 1, 12));
  return next.toISOString().slice(0, 10).replace(/-/g, '');
}

/* Validates one FormData-like record (plain object of strings). Returns a
   normalized booking object for the email templates. */
export function validateBooking(data, optional = {}) {
  const name = text(data.name, 100);
  const emailAddr = email(data.email);
  const phoneNo = phone(data.phone);
  const contactPref = enumValue(data.contactPref || 'none', CONTACT_PREFS, 'invalid_shot');
  const notes = text(data.notes, 1500, true);
  const shot = data.shot;
  if (shot === 'graduation') {
    const gradPackage = enumValue(data.gradPackage ?? 'standard', PACKAGE_LABELS, 'invalid_grad_package');
    const pack = PACKAGE_LABELS[gradPackage];
    let count = null;
    if (gradPackage === 'group') {
      count = Number(data.gradCount);
      if (!Number.isInteger(count) || count < 2 || count > 8) throw new BookingError('invalid_grad_count');
    }
    const gradDate = futureDate(data.gradDate);
    const gradTime = enumValue(data.gradTime || 'flexible', TIME_LABELS, 'invalid_fields');
    if (!Object.hasOwn(GRAD_PLACES, data.gradPlace ?? '')) throw new BookingError('invalid_location');
    const place = GRAD_PLACES[data.gradPlace] ?? text(data.gradPlaceText, 200);
    if (!place) throw new BookingError('invalid_location');
    return {
      shot: 'graduation', shotLabel: SHOT_LABELS[shot], gradPackage, pack, count,
      name, email: emailAddr, phone: phoneNo, contactPref, notes,
      date: gradDate, dateShort: dateDisplay(gradDate), timeLabel: TIME_LABELS[gradTime],
      place, otherTitle: null
    };
  }
  if (shot === 'portraits') {
    /* Mini and Standard only for now; group portraits go through Other. */
    const ppPackage = enumValue(data.ppPackage ?? 'standard', PP_PACKAGE_LABELS, 'invalid_portraits_package');
    const pack = PP_PACKAGE_LABELS[ppPackage];
    const ppDate = futureDate(data.ppDate);
    const ppTime = enumValue(data.ppTime || 'flexible', TIME_LABELS, 'invalid_fields');
    /* Checked = the visitor wants Cole to suggest the location.
       (Checkboxes submit 'on' across browsers unless given an explicit value.) */
    const unsure = data.ppPlaceUnsure === 'on' || data.ppPlaceUnsure === 'true';
    const place = unsure ? 'I\'ll let you suggest a few places. I can\'t think of any.' : text(data.ppPlace, 200);
    return {
      shot: 'portraits', shotLabel: SHOT_LABELS['portraits'], gradPackage: ppPackage, pack, count: null,
      name, email: emailAddr, phone: phoneNo, contactPref, notes,
      date: ppDate, dateShort: dateDisplay(ppDate), timeLabel: TIME_LABELS[ppTime],
      place, otherTitle: null
    };
  }
  if (shot === 'real-estate') {
    const tierId = enumValue(data.rePackage ?? 't1', RE_PACKAGE_LABELS, 'invalid_re_tier');
    const tier = RE_PACKAGE_LABELS[tierId];
    const street = text(data.reAddress, 200);
    const unit = text(data.reUnit, 40, true);
    const city = text(data.reCity, 60);
    /* ZIP required for a deliverable listing address. */
    const zip = text(data.reZip, 10);
    /* One composed, mailer-ready property address line. */
    const address = `${street}${unit ? ' · ' + unit : ''}, ${city}, NC${zip ? ' ' + zip : ''}`;
    const reDate = futureDate(data.reDate);
    const reTime = enumValue(data.reTime || 'flexible', TIME_LABELS, 'invalid_fields');
    return {
      shot: 'real-estate', shotLabel: SHOT_LABELS['real-estate'], gradPackage: tierId, pack: tier, count: null,
      name, email: emailAddr, phone: phoneNo, contactPref, notes,
      date: reDate, dateShort: dateDisplay(reDate), timeLabel: TIME_LABELS[reTime],
      place: null, address, otherTitle: null
    };
  }
  if (shot === 'other') {
    const title = text(data.otherTitle, 80);
    return {
      shot: 'other', shotLabel: title, gradPackage: null, pack: null, count: null,
      name, email: emailAddr, phone: phoneNo, contactPref, notes,
      date: null, dateShort: null, timeLabel: null, place: null, otherTitle: title
    };
  }
  throw new BookingError('invalid_shot');
}

function stepLabel(b) {
  if (!b.gradPackage) return null;
  return (b.shot === 'real-estate' ? RE_PACKAGE_LABELS[b.gradPackage].label : PACKAGE_LABELS[b.gradPackage].label);
}
function countNoun(b) {
  return b.shot === 'graduation' ? 'graduates' : 'people';
}

export function emailSubject(b) {
  const parts = ['Shoot Request', b.shotLabel];
  if (b.gradPackage) parts.push(stepLabel(b) + (b.count ? ` (${b.count} ${countNoun(b)})` : ''));
  parts.push(b.name);
  return parts.join(' — ');
}

export function emailText(b) {
  const pref = CONTACT_PREFS[b.contactPref];
  const emailTag = pref === 'email' ? ' — prefers email' : '';
  const phoneTag = pref === 'text' || pref === 'call' ? ` — prefers ${pref}` : '';
  const lines = [
    `${b.name} (${b.shotLabel}${b.gradPackage ? ' — ' + stepLabel(b) + (b.count ? `, ~${b.count} ${countNoun(b)}` : '') : ''})`,
    `Name: ${b.name}`,
    `Email: ${b.email}${emailTag}`,
    `Phone: ${b.phone}${phoneTag}`,
    ''
  ];
  if (b.date) lines.push(`Date: ${b.dateShort}`, `Time of day: ${b.timeLabel}`);
  if (b.place) lines.push(`Location: ${b.place}`);
  if (b.address) lines.push(`Address: ${b.address}`);
  if (b.pack) lines.push(b.shot === 'real-estate'
    ? `Square footage: ${RE_PACKAGE_LABELS[b.gradPackage].label} (${b.pack.priceLabel})`
    : `Session: ${PACKAGE_LABELS[b.gradPackage].label} (${b.pack.priceLabel})`);
  if (b.notes) lines.push('', `Notes: ${b.notes}`);
  lines.push('', `Reply directly to this visitor at ${b.email}, or call/text ${b.phone} (tappable buttons in the HTML version of this email).`);
  return lines.join('\n');
}

export function emailHtml(b) {
  const clean = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const to = phoneDigits(b.phone);
  const buttons = [];
  if (to.length > 7) {
    /* One button, both channels: it dials the client's number; the text
       thread is one forward-press away from wherever the dialer opened. */
    buttons.push(`<a href="tel:${to}" style="display:inline-block;padding:9px 16px;background:#b9a7ff;color:#201931;font-weight:bold;text-decoration:none;border-radius:5px">Text / Call</a>`);
  }
  if (b.address) {
    /* Mail-ready map link: normal Google Maps deep-link by address text. */
    buttons.push(`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}" style="display:inline-block;padding:9px 16px;margin-right:10px;background:#b9a7ff;color:#201931;font-weight:bold;text-decoration:none;border-radius:5px">Open on Google Maps</a>`);
  }
  if (b.date) {
    const query = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${b.shotLabel}${b.gradPackage ? ' — ' + stepLabel(b) : ''} — ${b.name}`,
      dates: `${b.date.replace(/-/g, '')}/${dateKeyPlusOne(b.date)}`,
      details: `Shoot request from ${b.name} · ${b.email} · ${b.phone}${b.notes ? '\n\n' + b.notes : ''}`,
      location: b.place ?? b.address ?? ''
    });
    if (b.email) query.set('add', b.email);
    buttons.push(`<a href="https://calendar.google.com/calendar/render?${query.toString()}" style="display:inline-block;padding:9px 16px;background:#b9a7ff;color:#201931;font-weight:bold;text-decoration:none;border-radius:5px">Add to my calendar</a>`);
  }
  const pref = CONTACT_PREFS[b.contactPref];
  const emailTag = pref === 'email' ? ' — prefers email' : '';
  const phoneTag = pref === 'text' || pref === 'call' ? ` — prefers ${pref}` : '';
  /* Every information tag gets the same one-line gap below it (1em), and
     every content VALUE is bold while the tag labels stay plain. */
  const P = 'margin:0 0 1em';
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">` +
    `<p style="${P}"><strong>${clean(b.shotLabel)}${b.gradPackage ? ' — ' + clean(stepLabel(b)) : ''}</strong>${b.count ? ` · ~${b.count} ${countNoun(b)}` : ''}</p>` +
    `<p style="${P}">Name: <strong>${clean(b.name)}</strong></p>` +
    `<p style="${P}">Email: <strong>${clean(b.email)}</strong>${emailTag}</p>` +
    `<p style="${P}">Phone: <strong>${clean(b.phone)}</strong>${phoneTag}</p>` +
    (b.date ? `<p style="${P}">Date: <strong>${clean(b.dateShort)}</strong></p><p style="${P}">Time of day: <strong>${clean(b.timeLabel)}</strong></p>` : '') +
    (b.place ? `<p style="${P}">Location: <strong>${clean(b.place)}</strong></p>` : '') +
    (b.address ? `<p style="${P}">Address: <strong>${clean(b.address)}</strong></p>` : '') +
    (b.pack ? `<p style="${P}">${b.shot === 'real-estate' ? 'Square footage' : 'Session'}: <strong>${clean(b.pack.label)} (${b.pack.priceLabel})</strong></p>` : '') +
    (b.notes ? `<p style="margin:0 0 0">Notes:</p><p style="margin:1em 0 1em"><strong>${clean(b.notes).replace(/\n/g, '<br>')}</strong></p>` : '') +
    (buttons.length ? `<p style="${P}">${buttons.join('\n')}</p>` : '') +
    `</div>`;
}
