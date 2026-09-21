// Server-owned booking values. Never accept a browser-calculated price or duration.
export const ZONE = 'America/New_York';
export const HOLD_SECONDS = 48 * 60 * 60;
export const PACKAGES = Object.freeze({
  mini: Object.freeze({name:'Grad Mini',duration:30,advertised:'30 minutes',minimum:10,price:125}),
  standard: Object.freeze({name:'Grad Standard',duration:90,advertised:'60–90 minutes',minimum:20,price:200}),
  group: Object.freeze({name:'Grad Group',duration:90,advertised:'90 minutes',minimum:30})
});
const GROUP_PRICES = {2:280,3:340,4:380};
export class BookingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookingError('invalid_fields');
  return value;
}
function fields(value, names) {
  object(value);
  if (Object.keys(value).some(key => !names.includes(key))) throw new BookingError('unexpected_fields');
}
function text(value, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new BookingError('invalid_text');
  const result = value.trim();
  if (!optional && !result) throw new BookingError('missing_fields');
  return result;
}
function email(value, optional = false) {
  const result = text(value, 254, optional);
  if (optional && result === '') return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new BookingError('invalid_email');
  return result;
}
export function sessionSeconds(date, minutes) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(minutes) || minutes < 0 || minutes >= 1440 || minutes % 30) throw new BookingError('invalid_time');
  const format = new Intl.DateTimeFormat('en-CA', {timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const candidates = [];
  for (const offset of [4,5]) {
    const ms = Date.parse(`${date}T00:00:00Z`) + (minutes + offset * 60) * 60000;
    if (!Number.isFinite(ms)) continue;
    const p = Object.fromEntries(format.formatToParts(ms).map(x => [x.type,x.value]));
    if (`${p.year}-${p.month}-${p.day}` === date && +p.hour * 60 + +p.minute === minutes) candidates.push(ms / 1000);
  }
  if (candidates.length !== 1) throw new BookingError('invalid_time');
  return candidates[0];
}
export function normalizeBooking(input) {
  // Event coverage: variable-length booking, no signed agreement (terms are
  // agreed at the in-person proposal). Same calendars and buffers as sessions.
  // Wedding: all-day booking, no time selection, no signed agreement.
  // Terms are agreed at the in-person proposal meeting.
  if (input.package === 'wedding') {
    fields(input, ['package','count','service','date','details']);
    const wStart = sessionSeconds(input.date, 0);
    const wEnd = sessionSeconds(input.date, 1439);
    fields(input.details, ['name','email','phone','location','graduate','notes','participants']);
    const wd = input.details;
    const weddingDetails = {name:text(wd.name,100),email:email(wd.email),phone:text(wd.phone,30),
      location:text(wd.location,200),graduate:text(wd.name,100),notes:text(wd.notes,1500,true),participants:[]};
    return {package:'wedding',service:'wedding',count:1,date:input.date,time:0,details:weddingDetails,
      priceCents:0,sessionStart:wStart,sessionEnd:wEnd};
  }
  if (input.package === 'event') {
    fields(input, ['package','count','service','length','date','time','details']);
    if (!Number.isInteger(input.length) || input.length < 60 || input.length > 1200 || input.length % 30) throw new BookingError('invalid_time');
    const start = sessionSeconds(input.date, input.time);
    fields(input.details, ['name','email','phone','location','graduate','notes','participants']);
    const ed = input.details;
    const eventDetails = {name:text(ed.name,100),email:email(ed.email),phone:text(ed.phone,30),
      location:text(ed.location,200),graduate:text(ed.name,100),notes:text(ed.notes,1500,true),participants:[]};
    return {package:'event',service:'event',count:1,date:input.date,time:input.time,length:input.length,details:eventDetails,
      priceCents:0,sessionStart:start,sessionEnd:start+input.length*60};
  }
  fields(input, ['package','service','count','date','time','details']);
  if (!Object.hasOwn(PACKAGES, input.package)) throw new BookingError('invalid_package');
  const group = input.package === 'group';
  if (group && ![2,3,4].includes(input.count)) throw new BookingError('invalid_group_size');
  // Existing browser state retains count=2 for individual packages; ignore it there.
  const count = group ? input.count : 1;
  const start = sessionSeconds(input.date, input.time);
  fields(input.details, ['name','email','phone','location','graduate','notes','participants']);
  const d = input.details;
  const details = {name:text(d.name,100),email:email(d.email),phone:text(d.phone,30),
    location:text(d.location,200),graduate:text(d.graduate,100,true) || text(d.name,100),
    notes:text(d.notes,1500,true),participants:[]};
  if (group) {
    if (!Array.isArray(d.participants) || d.participants.length !== count) throw new BookingError('invalid_participants');
    details.participants = d.participants.map(p => {
      fields(p,['name','email']); return {name:text(p.name,100),email:email(p.email,true)};
    });
  }
  const p = PACKAGES[input.package];
  const serviceName = input.service === 'realestate' ? 'realestate' : 'graduation';
  return {package:input.package,service:serviceName,count,date:input.date,time:input.time,details,
    priceCents:(group ? GROUP_PRICES[count] : p.price)*100,
    sessionStart:start,sessionEnd:start+p.duration*60};
}
export function normalizeSignature(input, booking) {
  fields(input,['typedName','agreementConsent','electronicConsent','promotion','drawing']);
  if (input.agreementConsent !== true || input.electronicConsent !== true) throw new BookingError('consent_required');
  const typedName = text(input.typedName,100);
  if (!['yes','no',null,undefined].includes(input.promotion)) throw new BookingError('invalid_permission');
  let promotion = input.promotion ?? null;
  // The booking organizer cannot grant portfolio permission for a different graduate.
  if (booking.package === 'group' || booking.details.name.toLowerCase() !== booking.details.graduate.toLowerCase()) {
    if (promotion === 'yes') throw new BookingError('permission_requires_graduate');
    promotion = null;
  }
  const drawing = input.drawing ?? [];
  if (!Array.isArray(drawing) || drawing.length > 100) throw new BookingError('invalid_drawing');
  let points = 0;
  const normalizedDrawing = drawing.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length) throw new BookingError('invalid_drawing');
    points += stroke.length;
    if (points > 10000) throw new BookingError('drawing_too_large');
    return stroke.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new BookingError('invalid_drawing');
      return [point[0], point[1]];
    });
  });
  return {typedName,agreementConsent:true,electronicConsent:true,promotion,drawing:normalizedDrawing};
}
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
}
