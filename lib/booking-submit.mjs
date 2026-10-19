import {accessToken,googleJSON} from './google-auth.mjs';
import {BookingError,PACKAGES,ZONE,normalizeBooking} from './booking-input.mjs';

const ORIGINS=new Set(['https://cyberflight.studio','https://www.cyberflight.studio','http://localhost:8788','http://127.0.0.1:8788']);
export function json(body,status=200) {
  return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
async function readJSON(request) {
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')throw new BookingError('json_required',415);
  if(!request.body)throw new BookingError('invalid_json');
  const reader=request.body.getReader(),chunks=[];let length=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>350000){await reader.cancel();throw new BookingError('request_too_large',413);}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new BookingError('invalid_json');}
}
function checkOrigin(request) {
  const url=new URL(request.url);
  if(!ORIGINS.has(url.origin)||request.headers.get('Origin')!==url.origin)throw new BookingError('origin_not_allowed',403);
}
/* Real booking event on the Bookings Calendar. This is the booking: the
   owner manages it there (delete = cancel), and availability follows. */
async function createBookingEvent(env,booking,id) {
  try {
    const token=await accessToken(env);
    const label=bookingServiceLabel(booking);
    const isAllDay=booking.package==='wedding'||booking.allDay===true;
    const eventDef=isAllDay?{date:booking.date}:{dateTime:new Date((booking.sessionStart-1800)*1000).toISOString(),timeZone:ZONE};
    const eventEndDef=isAllDay?{date:(function(){const d=new Date(booking.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)})()}:{dateTime:new Date((booking.sessionEnd+1800)*1000).toISOString(),timeZone:ZONE};
    const event={summary:`${label} — ${booking.details.name}`,
      description:`Requested by ${booking.details.name}
Request ID: ${id}
Contact: ${booking.details.email} · ${booking.details.phone}
Location: ${booking.details.location}${booking.details.graduate&&booking.details.graduate!==booking.details.name?`
Graduate: ${booking.details.graduate}`:''}${booking.details.participants.length?`
Participants: ${booking.details.participants.map(x=>x.name).join(', ')}`:''}${booking.details.notes?`
Notes: ${booking.details.notes}`:''}`,
      start:eventDef,
      end:eventEndDef,
      extendedProperties:{private:{requestId:id}}};
    await googleJSON(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_BOOKINGS_CALENDAR_ID)}/events`,
      {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(event)});
    return null;
  } catch(error) {
    const reason=String(error&&error.message||'unknown').slice(0,60);
    console.error(JSON.stringify({event:'booking_event_failed',reason,stack:String(error&&error.stack||'').split('\n').slice(1,20).join(' | ').slice(0,1200)}));
    return reason;
  }
}
function bookingServiceLabel(booking) {
  if(booking.package==='event')return 'Event Coverage';
  if(booking.package==='wedding')return 'Wedding';
  if(booking.service==='realestate')return 'Real Estate';
  return PACKAGES[booking.package].name;
}
async function sendOwnerNotification(env,booking,id,promotion,conflict=false) {
  if(typeof env.BOOKING_OWNER_EMAIL!=='string'||!env.BOOKING_OWNER_EMAIL.trim())return;
  if(typeof env.RESEND_API_KEY!=='string'||!env.RESEND_API_KEY)return;
  const isEvent=booking.package==='event',isProposal=booking.package==='event'||booking.package==='wedding';
  const serviceLabel=bookingServiceLabel(booking);
  const money=v=>'$'+(v/100).toFixed(2);
  const date=new Date(booking.sessionStart*1000);
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,weekday:'short',month:'short',day:'numeric'});
  const fmtT=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const timeLabel=m=>`${Math.floor(m/60)%12||12}:${String(m%60).padStart(2,'0')} ${m<720?'AM':'PM'}`;
  const sessionText=isEvent
    ? booking.allDay
      ? `${fmt.format(date)} · all day (entire date)`
      : `${fmt.format(date)} · ${booking.length/60} hour${booking.length>=120?'s':''} · ${timeLabel(booking.time)} start (Eastern)`
    : isProposal
    ? `${fmt.format(date)} · full day`
    : `${fmt.format(date)} · ${timeLabel(booking.time)}–${timeLabel(booking.time+PACKAGES[booking.package].duration)} Eastern`;
  const permissionText=promotion==='yes'?'GRANTED — may use identifiable photos in the portfolio and promotions'
    :promotion==='no'?'NOT GRANTED — keep identifiable photos out of public promotions'
    :`to be collected at the session${booking.package==='group'?' from each graduate':''}`;
  const preface=conflict?['⚠ SCHEDULING CONFLICT — this all-day request overlaps existing commitments on your calendar. Open the Bookings/Personal calendar and resolve before confirming with the client.','']:[];
  const lines=['CYBERFLIGHT STUDIOS — NEW BOOKING REQUEST','',...preface,
    `Request ID: ${id}`,
    `Service: ${serviceLabel}${booking.package==='event'?' — quoted by proposal':isProposal?'':' — '+money(booking.priceCents)}`,
    `Session: ${sessionText}`,
    `Blocked (with 30 min. buffers): ${fmtT.format(new Date((booking.sessionStart-1800)*1000))} – ${fmtT.format(new Date((booking.sessionEnd+1800)*1000))}`,'',
    `Client: ${booking.details.name}`,`Email: ${booking.details.email}`,`Phone: ${booking.details.phone}`,
    `Location: ${booking.details.location}`,
    booking.package==='group'?`Graduates: ${booking.details.participants.map(x=>x.name).join(', ')}`:`Graduate: ${booking.details.graduate}`,
    `Portfolio permission: ${permissionText}`,
    `Notes: ${booking.details.notes||'(none)'}`,'',
    'Reply directly to this customer from your mailbox.'];
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',
      signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:'Cyberflight Studios <cole@cyberflight.studio>',
        to:[env.BOOKING_OWNER_EMAIL.trim()],
        subject:`${conflict?'CONFLICT — ':''}New ${serviceLabel} Request — ${booking.details.name}`,text:lines.join('\n')})});
    if(!response.ok)console.error(JSON.stringify({event:'owner_email_rejected',status:response.status}));
  } catch(error) {
    console.error(JSON.stringify({event:'owner_email_failed'}));
  }
}
const receipt=id=>json({requestId:id,status:'approved'},201);
export async function verifyTurnstile(request,env,token) {
  if(env.BOOKING_SKIP_TURNSTILE==='true')return;
  if(typeof token!=='string'||!token||token.length>2048)throw new BookingError('verification_required',403);
  if(typeof env.TURNSTILE_SECRET!=='string'||!env.TURNSTILE_SECRET)throw new BookingError('verification_not_configured',503);
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,
      ...(request.headers.get('CF-Connecting-IP')?{remoteip:request.headers.get('CF-Connecting-IP')}:{})})});
  if(!response.ok) {
    const body=await response.text().catch(()=> '');
    let codes=body.slice(0,120);
    try{const parsed=JSON.parse(body);if(Array.isArray(parsed['error-codes']))codes=parsed['error-codes'].join(',');}catch{}
    console.error(JSON.stringify({event:'siteverify_failed',status:response.status,codes}));
    return json({error:'verification_unavailable',detail:codes},503);
  }
  // Bound the external response, too.
  const verification=await readJSON(response);
  if(verification.success!==true||verification.hostname!==new URL(request.url).hostname||verification.action!=='booking_submit')throw new BookingError('verification_failed',403);
}
export function createBookingHandlers({readAvailability,verify=verifyTurnstile,now=()=>Math.floor(Date.now()/1000)}) {
  /* Every service follows the same request path as event and wedding
     coverage: no signed agreement on the website. Terms and portfolio
     consent are confirmed with the client directly (proposal meeting,
     session, or invoice); the request record is the Bookings Calendar
     event plus the owner email. */
  async function execute(context) {
    const {request,env}=context;const diagnosticId=crypto.randomUUID();
    try {
      if(env.BOOKING_SUBMISSIONS_ENABLED!=='true')return json({error:'booking_not_open_yet'},503);
      if(request.method!=='POST')return json({error:'method_not_allowed'},405);
      checkOrigin(request);
      const input=await readJSON(request);
      if(!input||typeof input!=='object'||Array.isArray(input))throw new BookingError('invalid_fields');
      if(Object.keys(input).some(key=>!['booking','promotion','submissionKey','turnstileToken'].includes(key)))throw new BookingError('unexpected_fields');
      const booking=normalizeBooking(input.booking);
      const promotion=input.promotion===undefined?null:input.promotion;
      if(!['yes','no',null].includes(promotion))throw new BookingError('invalid_fields');
      await verify(request,env,input.turnstileToken);
      const createdAt=now();
      // Lead times are advisory, not code (see availability.js): any future
      // time that is free may be requested. Slots-mode bookings are
      // filtered by the availability check below; this only rejects
      // times already begun.
      if(booking.sessionStart<=createdAt)throw new BookingError('time_unavailable',409);
      const [year,month,day]=booking.date.split('-');
      const initials=(booking.details.name.match(/\b[a-z]/gi)||['X','X']).slice(0,2).map(x=>x.toUpperCase()).join('');
      const submittedAt=new Date(createdAt*1000);
      const eastern=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(submittedAt);
      const pick=t=>eastern.find(x=>x.type===t).value;
      const id=`${initials}-${month}${day}${year.slice(2)}-${pick('hour')}${pick('minute')}`;

      let conflict=false;
      if(booking.package==='event'){
        const url=new URL('/api/availability',request.url);
        url.search=new URLSearchParams({start:booking.date,package:'event'}).toString();
        const response=await readAvailability({...context,request:new Request(url)});
        if(!response.ok)throw new BookingError('availability_unavailable',503);
        const available=await response.json();
        if(available.source!=='google'||available.timeZone!==ZONE||available.start!==booking.date||available.package!=='event')throw new BookingError('availability_unavailable',503);
        const busyOverlap=available.busy?.some(([a,b])=>booking.sessionStart*1000-30000<b&&booking.sessionEnd*1000+30000>a)??false;
        // All-day override: the request is never rejected for busy time.
        // Conflicts are flagged to the owner in the notification email so
        // the calendar can be reviewed before confirming.
        if(booking.allDay)conflict=busyOverlap;
        else if(busyOverlap)throw new BookingError('time_unavailable',409);
      } else if(booking.package!=='wedding'){
        const url=new URL('/api/availability',request.url);
        url.search=new URLSearchParams({start:booking.date,package:booking.package}).toString();
        const response=await readAvailability({...context,request:new Request(url)});
        if(!response.ok)throw new BookingError('availability_unavailable',503);
        const available=await response.json();
        if(available.source!=='google'||available.timeZone!==ZONE||available.start!==booking.date||available.package!==booking.package)throw new BookingError('availability_unavailable',503);
        if(!available.days?.find(x=>x.key===booking.date)?.slots?.includes(booking.time))throw new BookingError('time_unavailable',409);
      }
      const eventFailure=await createBookingEvent(env,booking,id);
      if(eventFailure)throw new BookingError('calendar_unavailable',503);
      try { await sendOwnerNotification(env,booking,id,promotion,conflict); } catch(e) {
        console.error(JSON.stringify({event:'notify_failed',reason:String(e&&e.message||'unknown').slice(0,60)}));
      }
      return receipt(id);
    }catch(error){
      if(error instanceof BookingError)return json({error:error.code},error.status);
      // Never log names, request bodies, authorization tokens or SQL values.
      const errDetail=String(error&&error.message||'unknown').slice(0,120);
      console.error(JSON.stringify({event:'booking_request_failed',diagnosticId,reason:errDetail}));
      return json({error:'request_unavailable',diagnosticId,detail:errDetail},503);
    }
  }
  return {submit:context=>execute(context)};
}
