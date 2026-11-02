'use strict';
/* Shoot-request form: one page, questions that reveal as you answer.
   Submit posts FormData to /api/booking/submit which emails the owner. */
const $ = id => document.getElementById(id);
const form = $('booking-form');

const state = { shot: '', gradPackage: '', count: 4 };

/* --- Progressive reveal ---------------------------------------------------
   Branches appear when the master question picks them; hidden required
   fields are disabled too, or form validation blocks submit silently on
   fields that can't be filled ("not focusable"). */
function syncGradRequired() {
  const grad = state.shot === 'graduation';
  $('grad-branch').hidden = !grad;
  document.querySelectorAll('[name=grad-package]').forEach(el => el.disabled = !grad);
  $('other-title').disabled = $('other-branch').hidden = state.shot !== 'other';
  syncPlaceRequired();
}
function syncPlaceRequired() {
  const custom = state.shot === 'graduation' && state.place === 'other';
  $('grad-place-text').disabled = $('grad-place-custom').hidden = !custom;
}
$('shot-select').addEventListener('change', () => {
  state.shot = $('shot-select').value;
  syncGradRequired();
  updateSummary();
});
document.querySelectorAll('[name=grad-package]').forEach(el => el.addEventListener('change', () => {
  if (el.disabled) return;
  state.gradPackage = el.value;
  $('grad-count-group').hidden = state.gradPackage !== 'group';
  updateSummary();
}));
$('grad-count').addEventListener('input', () => {
  if ($('grad-count-group').hidden) return;
  state.count = Number($('grad-count').value);
  $('grad-count-label').textContent = `${state.count}`;
  updateSummary();
});
$('grad-place').addEventListener('change', () => {
  state.place = $('grad-place').value;
  syncPlaceRequired();
  updateSummary();
});

/* Whole field pops the native calendar, not just the small icon. */
['grad-date'].forEach(id => $(id).addEventListener('click', () => {
  if (typeof $(id).showPicker === 'function') {
    try { $(id).showPicker(); } catch { /* picker already open is fine */ }
  }
}));

/* --- Live summary sidebar ------------------------------------------------ */
const SHOT_LABELS = { graduation: 'Graduation Portraits', other: null };
const PACKAGE_LABELS = {
  mini: { spec: '30 minutes · 10+ photos', price: '$125' },
  standard: { spec: '60 – 90 minutes · 20 – 25+ photos', price: '$200' },
  group: { spec: 'Group session · size flexible', price: 'from $280' }
};
const TIME_LABELS = { flexible: 'No preference', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const formatDate = key => key ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(key + 'T12:00:00Z')) : null;

const PACKAGE_IMAGE = {
  none: '../images/services/photography/photo1.webp',
  mini: '../images/services/graduation/graduation3.webp',
  standard: '../images/services/graduation/graduation3.webp',
  group: '../images/services/graduation/graduation4.webp'
};
function updateSummary() {
  const gradActive = state.shot === 'graduation';
  const pick = gradActive ? PACKAGE_LABELS[state.gradPackage] : null;
  $('summary-title').textContent = state.shot === 'other' && $('other-title').value.trim()
    ? $('other-title').value.trim()
    : (SHOT_LABELS[state.shot] ?? 'Choose a shoot type');
  $('summary-spec').textContent = pick ? pick.spec : 'The form adapts once you choose.';
  $('summary-package').textContent = pick ? pick.price : '—';
  $('summary-date').textContent = formatDate($('grad-date').value) ?? '—';
  $('summary-time').textContent = state.shot === 'graduation' ? TIME_LABELS[$('grad-time').value] : '—';
  const image = PACKAGE_IMAGE[gradActive ? (state.gradPackage || 'none') : 'none'];
  if ($('summary-image').src.split('/').pop() !== image.split('/').pop()) {
    $('summary-image').src = image;
    $('summary-image').alt = gradActive ? 'Graduation portraits by Cyberflight Studios' : 'Photography by Cyberflight Studios';
  }
}
['grad-date', 'grad-time'].forEach(id => $(id).addEventListener('change', updateSummary));
$('other-title').addEventListener('input', updateSummary);

/* --- Turnstile ----------------------------------------------------------- */
const TURNSTILE_SITEKEY = '0x4AAAAAAETDlK6Z2eQKAY43';
let turnstileId = null, turnstileToken = null, turnstileWait = null;
function ensureTurnstile() {
  if (turnstileId !== null) return;
  const render = () => {
    turnstileId = window.turnstile.render($('turnstile-box'), {
      sitekey: TURNSTILE_SITEKEY,
      action: 'booking_submit',
      callback: token => { turnstileToken = token; },
      'expired-callback': () => { turnstileToken = null; },
      'error-callback': () => { turnstileToken = null; }
    });
    window.clearInterval(turnstileWait);
  };
  if (window.turnstile) render();
  else turnstileWait = window.setInterval(() => { if (window.turnstile) render(); }, 200);
  window.setTimeout(() => window.clearInterval(turnstileWait), 15000);
}
ensureTurnstile();

const SUBMIT_ERRORS = {
  'time_unavailable': 'That date or details changed underneath you — please review and send again.',
  'missing_fields': 'Please fill in the required fields.',
  'invalid_email': "That email address doesn't look right.",
  'invalid_phone': 'Please enter a valid phone number.',
  'invalid_shot': 'Please choose a shoot type.',
  'invalid_grad_package': 'Please pick a graduation session.',
  'invalid_grad_count': 'Group size must be 2 – 8 graduates.',
  'invalid_date': 'Please choose a valid upcoming date.',
  'invalid_location': 'Please choose a location.',
  'send_failed': "The request couldn't be sent. Try again or reach me directly.",
  'request_unavailable': "The request couldn't be sent. Try again or reach me directly.",
  'verification_failed': 'The verification failed. Refresh the page and try again.',
  'verification_unavailable': "Verification is temporarily unavailable. Try again in a minute."
};

/* --- Submit -------------------------------------------------------------- */
async function submitForm() {
  const button = $('submit-button');
  if (!turnstileToken && window.turnstile) {
    $('form-error').textContent = 'Complete the verification box before sending.';
    return;
  }
  $('form-error').textContent = '';
  button.disabled = true;
  try {
    const data = new FormData(form);
    if (turnstileToken) data.append('cf-turnstile-response', turnstileToken);
    const response = await fetch('/api/booking/submit', { method: 'POST', body: data, cache: 'no-store' });
    if (response.ok) { location.href = '/booking/confirmed/'; return; }
    const detail = await response.json().catch(() => ({}));
    $('form-error').textContent = SUBMIT_ERRORS[detail.error] ?? detail.detail ??
      'The request could not be sent. Check your connection and try again, or reach me directly.';
  } catch {
    $('form-error').textContent = 'The request could not be sent. Check your connection and try again, or reach me directly.';
  } finally {
    button.disabled = false;
    if (window.turnstile && turnstileId !== null) {
      window.turnstile.reset(turnstileId);
      turnstileToken = null;
    }
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (form.querySelector('input[name=website]').value.trim()) return; /* honeypot */
  if (!form.reportValidity()) return;
  submitForm();
});
updateSummary();
