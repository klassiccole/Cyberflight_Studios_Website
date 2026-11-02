import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBooking, emailSubject, emailText, emailHtml, phoneDigits, dateKeyPlusOne, BookingError} from '../lib/booking-form.mjs';

const grad = () => ({
  shot: 'graduation', gradPackage: 'standard', gradDate: '2099-06-14', gradTime: 'afternoon',
  gradPlace: 'unccharlotte', name: 'Jane Doe', email: 'jane@example.com',
  phone: '(704) 555-0100', contactPref: 'text', notes: 'Morning light preferred.'
});
const other = () => ({
  shot: 'other', otherTitle: 'Christmas cards', name: 'Sam', email: 'sam@example.com',
  phone: '7045550123', contactPref: 'none', notes: ''
});

test('standard graduation request validates and prices', () => {
  const b = validateBooking(grad());
  assert.equal(b.pack.priceLabel, '$200');
  assert.equal(b.place, 'UNC Charlotte campus');
  assert.equal(emailSubject(b), 'Shoot Request — Graduation Portraits — Standard Session — Jane Doe');
  const t = emailText(b);
  assert.match(t, /Name: Jane Doe/);
  assert.match(t, /Email: jane@example\.com/);
  assert.match(t, /Phone: \(704\) 555-0100 — prefers text/);
  assert.match(t, /Date: /);
  assert.match(t, /UNC Charlotte campus/);
  assert.match(t, /Morning light preferred\./);
});
test('phone digits and date arithmetic', () => {
  assert.equal(phoneDigits('(704) 555-0100'), '+17045550100');
  assert.equal(dateKeyPlusOne('2099-06-14'), '20990615');
});
test('group size rides on the chosen package', () => {
  const p = grad();
  p.gradPackage = 'group';
  assert.throws(() => validateBooking(p), /invalid_grad_count/);
  p.gradCount = '3';
  const b = validateBooking(p);
  assert.equal(b.pack.priceLabel, 'from $280');
  assert.equal(emailSubject(b), 'Shoot Request — Graduation Portraits — Group Session (3) — Jane Doe');
  p.gradCount = '9';
  assert.throws(() => validateBooking(p), /invalid_grad_count/);
});
test('custom location falls back to text field', () => {
  const p = grad();
  p.gradPlace = 'other';
  p.gradPlaceText = '  ';
  assert.throws(() => validateBooking(p), /missing_fields/);
  p.gradPlaceText = 'Freedom Park';
  assert.equal(validateBooking(p).place, 'Freedom Park');
});
test('bad email, phone, dates and unknown shots are rejected individually', () => {
  for (const [key, value] of [['email', 'nope'], ['phone', ''], ['phone', 'x.repeat(40)']]) {
    const p = grad(); p[key] = key === 'phone' ? 'x'.repeat(40) : value;
    assert.throws(() => validateBooking(p));
  }
  const past = grad(); past.gradDate = '2001-01-01';
  assert.throws(() => validateBooking(past), /invalid_date/);
  const badDate = grad(); badDate.gradDate = '2099-02-30';
  assert.throws(() => validateBooking(badDate), /invalid_date/);
  const junk = grad(); junk.shot = 'parasailing';
  assert.throws(() => validateBooking(junk), /invalid_shot/);
});
test('empty required fields say missing_fields', () => {
  const p = grad(); p.name = '   ';
  assert.throws(() => validateBooking(p), /missing_fields/);
  const q = other(); q.otherTitle = '';
  assert.throws(() => validateBooking(q), /missing_fields/);
});
test('unknown shoot requests keep the title as label, no date row', () => {
  const b = validateBooking(other());
  assert.equal(b.shotLabel, 'Christmas cards');
  assert.equal(emailSubject(b), 'Shoot Request — Christmas cards — Sam');
  assert.ok(!emailText(b).includes('Date:'));
  assert.ok(emailText(b).includes('Christmas cards'));
});
test('html email carries the tappable actions', () => {
  const b = validateBooking(grad());
  const html = emailHtml(b);
  assert.match(html, /Name: <strong>Jane Doe<\/strong><\/p><p[^>]*>Email: <strong>jane@example\.com<\/strong><\/p><p[^>]*>Phone: <strong>\(704\) 555-0100<\/strong> — prefers text/);
  assert.match(html, /sms:\+17045550100\?body=/);
  assert.match(html, /tel:\+17045550100/);
  assert.match(html, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(html, /add=jane%40example\.com|add=jane@example.com/);
  assert.match(html, /Date: <strong>Sun, Jun 14, 2099<\/strong><\/p><p[^>]*>Time of day: <strong>Afternoon<\/strong>/);
  assert.match(html, /Location: <strong>/);
  assert.match(html, /Session: <strong>/);
  assert.match(html, /Notes:<\/p><p[^>]*><strong>Morning light preferred\./);
  assert.match(html, /dates=20990614%2F20990615/);
  assert.ok(!/<script/i.test(html));
});
test('prefers tag rides on the chosen channel', () => {
  const e = grad(); e.contactPref = 'email';
  const be = validateBooking(e);
  assert.match(emailText(be), /Email: jane@example\.com — prefers email\n/);
  assert.ok(!/ — prefers (text|call)/.test(emailText(be)));
  const n = grad(); n.contactPref = 'none';
  const bn = validateBooking(n);
  assert.ok(!/— prefers/.test(emailText(bn)));
});
test('other-shoot email omits sms if phone lacks digits', () => {
  const p = other(); p.phone = 'abcdef';
  assert.throws(() => validateBooking(p), /invalid_phone/);
});
test('error class carries status', () => {
  assert.equal(new BookingError('invalid_email', 404).status, 404);
});
