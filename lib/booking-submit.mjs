import {accessToken} from './google-auth.mjs';
import {BookingError,HOLD_SECONDS,PACKAGES,ZONE,normalizeBooking,normalizeSignature,sha256} from './booking-input.mjs';
import {buildAgreement} from './booking-agreement.mjs';

const ORIGINS=new Set(['https://cyberflight.studio','https://www.cyberflight.studio']);
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
/* Tentative hold event on the Bookings Calendar. The owner manages the
   booking there: approving keeps the event, declining deletes it, which
   releases the slot on the website immediately. Failures degrade safely. */
async function createHoldEvent(env,booking,id,expiresAt) {
  try {
    const token=await accessToken(env);
    const event={summary:`HOLD — ${PACKAGES[booking.package].name} — ${booking.details.name}`,
      description:`Requested by ${booking.details.name}
Request ID: ${id}
Hold expires: ${new Date(expiresAt*1000).toISOString()}
Contact: ${booking.details.email} · ${booking.details.phone}`,
      start:{dateTime:new Date((booking.sessionStart-1800)*1000).toISOString(),timeZone:ZONE},
      end:{dateTime:new Date((booking.sessionEnd+1800)*1000).toISOString(),timeZone:ZONE},
      extendedProperties:{private:{requestId:id,kind:'hold',expiresAt:String(expiresAt)}}};
    await googleJSON(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_BOOKINGS_CALENDAR_ID)}/events`,
      {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(event)});
  } catch(error) {
    console.error(JSON.stringify({event:'hold_event_failed',reason:String(error&&error.message||'unknown').slice(0,60)}));
  }
}

async function sendOwnerNotification(env,booking,receiptRow) {
  if(typeof env.BOOKING_OWNER_EMAIL!=='string'||!env.BOOKING_OWNER_EMAIL.trim())return;
  if(typeof env.RESEND_API_KEY!=='string'||!env.RESEND_API_KEY)return;
  const d=booking.details,p=PACKAGES[booking.package];
  const money=v=>'$'+(v/100).toFixed(2);
  const date=new Date(booking.sessionStart*1000);
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,weekday:'short',month:'short',day:'numeric'});
  const fmtT=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const timeLabel=m=>`${Math.floor(m/60)%12||12}:${String(m%60).padStart(2,'0')} ${m<720?'AM':'PM'}`;
  const lines=['CYBERFLIGHT STUDIOS — NEW BOOKING REQUEST','',
    `Request ID: ${receiptRow.id}`,
    `Package: ${p.name} — ${money(booking.priceCents)}`,
    `Session: ${fmt.format(date)} · ${timeLabel(booking.time)}–${timeLabel(booking.time+p.duration)} Eastern`,
    `Held (with buffers): ${fmtT.format(new Date((booking.sessionStart-1800)*1000))} – ${fmtT.format(new Date((booking.sessionEnd+1800)*1000))}`,
    `Hold expires: ${new Date(receiptRow.expiresAt*1000).toISOString()}`,'',
    `Client: ${d.name}`,`Email: ${d.email}`,`Phone: ${d.phone}`,
    `Location: ${d.location}`,
    booking.package==='group'?`Graduates: ${d.participants.map(x=>x.name).join(', ')}`:`Graduate: ${d.graduate}`,
    `Notes: ${d.notes||'(none)'}`,'',
    'Reply directly to this customer from your mailbox.'];
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',
      signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:'Cyberflight Studios <cole@cyberflight.studio>',
        to:[env.BOOKING_OWNER_EMAIL.trim()],
        subject:`New ${p.name} request — ${d.name}`,text:lines.join('\n')})});
    if(!response.ok)console.error(JSON.stringify({event:'owner_email_rejected',status:response.status}));
  } catch(error) {
    console.error(JSON.stringify({event:'owner_email_failed'}));
  }
}

function receipt(row,replayed=false) {
  const status=row.status==='pending'&&row.expires_at<=Math.floor(Date.now()/1000)?'expired':row.status;
  return json({requestId:row.id,status,expiresAt:new Date(row.expires_at*1000).toISOString(),replayed},replayed?200:201);
}
export async function verifyTurnstile(request,env,token) {
  if(env.BOOKING_SKIP_TURNSTILE==='true')return;
  if(typeof token!=='string'||!token||token.length>2048)throw new BookingError('verification_required',403);
  if(typeof env.TURNSTILE_SECRET!=='string'||!env.TURNSTILE_SECRET)throw new BookingError('verification_not_configured',503);
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,
      ...(request.headers.get('CF-Connecting-IP')?{remoteip:request.headers.get('CF-Connecting-IP')}:{})})});
  if(!response.ok)throw new BookingError('verification_unavailable',503);
  // Bound the external response, too.
  const verification=await readJSON(response);
  if(verification.success!==true||verification.hostname!==new URL(request.url).hostname||verification.action!=='booking_submit')throw new BookingError('verification_failed',403);
}
export function createBookingHandlers({readAvailability,verify=verifyTurnstile,now=()=>Math.floor(Date.now()/1000)}) {
  async function execute(context,mode) {
    const {request,env}=context;const diagnosticId=crypto.randomUUID();
    try {
      if(env.BOOKING_SUBMISSIONS_ENABLED!=='true')return json({error:'booking_not_open_yet'},503);
      if(request.method!=='POST')return json({error:'method_not_allowed'},405);
      checkOrigin(request);
      const input=await readJSON(request);
      if(!input||typeof input!=='object'||Array.isArray(input))throw new BookingError('invalid_fields');
      const allowed=mode==='agreement'?['booking']:['booking','signature','agreementVersion','agreementHash','submissionKey','turnstileToken'];
      if(Object.keys(input).some(key=>!allowed.includes(key)))throw new BookingError('unexpected_fields');
      const booking=normalizeBooking(input.booking);
      const agreement=buildAgreement(booking);
      const agreementHash=await sha256(agreement.text);
      if(mode==='agreement')return json({...agreement,hash:agreementHash,priceCents:booking.priceCents});
      const signature=normalizeSignature(input.signature,booking);
      if(typeof input.submissionKey!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.submissionKey))throw new BookingError('invalid_submission_key');
      if(typeof input.agreementHash!=='string'||!/^[a-f0-9]{64}$/.test(input.agreementHash)||typeof input.agreementVersion!=='string'||input.agreementVersion.length>100)throw new BookingError('agreement_required');
      if(!env.BOOKING_DB)throw new BookingError('storage_not_configured',503);
      const keyHash=await sha256(input.submissionKey);
      const payloadHash=await sha256(JSON.stringify({booking,signature,version:input.agreementVersion,hash:input.agreementHash}));
      // All reads use primary D1, including retry recovery after another writer wins.
      const db=env.BOOKING_DB;
      const lookup=()=>db.prepare('SELECT id,status,expires_at,payload_hash FROM booking_requests WHERE submission_key_hash=?').bind(keyHash).first();
      const replay=row=>{
        if(row.payload_hash!==payloadHash)throw new BookingError('submission_key_reused',409);
        return receipt(row,true);
      };
      const prior=await lookup();
      if(prior)return replay(prior); // A lost response must not require a fresh Turnstile token.
      if(input.agreementVersion!==agreement.version||input.agreementHash!==agreementHash)throw new BookingError('agreement_changed_review_again',409);
      await verify(request,env,input.turnstileToken);
      const url=new URL('/api/availability',request.url);
      url.search=new URLSearchParams({start:booking.date,package:booking.package}).toString();
      const response=await readAvailability({...context,request:new Request(url)});
      if(!response.ok)throw new BookingError('availability_unavailable',503);
      const available=await response.json();
      if(available.source!=='google'||available.timeZone!==ZONE||available.start!==booking.date||available.package!==booking.package)throw new BookingError('availability_unavailable',503);
      if(!available.days?.find(day=>day.key===booking.date)?.slots?.includes(booking.time))throw new BookingError('time_unavailable',409);
      const createdAt=now();
      if(booking.sessionStart<createdAt+432000)throw new BookingError('time_unavailable',409);
      const savedSignature={...signature,capturedAt:new Date(createdAt*1000).toISOString(),agreementHash};
      const [year,month,day]=booking.date.split('-');
      const initials=(booking.details.name.match(/\b[a-z]/gi)||['X','X']).slice(0,2).map(x=>x.toUpperCase()).join('');
      const submittedAt=new Date(createdAt*1000);
      const eastern=new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(submittedAt);
      const pick=t=>eastern.find(x=>x.type===t).value;
      const idBase=`${initials}-${month}${day}${year.slice(2)}-${pick('hour')}${pick('minute')}`;
      const fallback=()=>'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[crypto.getRandomValues(new Uint8Array(1))[0]%31];
      let id=idBase;
      for(let attempt=0;attempt<5;attempt++){
        try {
          await db.prepare(`INSERT INTO booking_requests (id,submission_key_hash,payload_hash,created_at,expires_at,
          session_start,session_end,busy_start,busy_end,package_id,price_cents,customer_json,
          agreement_version,agreement_text,agreement_sha256,signature_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,keyHash,payloadHash,createdAt,createdAt+HOLD_SECONDS,
          booking.sessionStart,booking.sessionEnd,booking.sessionStart-1800,booking.sessionEnd+1800,
          booking.package,booking.priceCents,JSON.stringify({...booking.details,count:booking.count}),
          agreement.version,agreement.text,agreementHash,JSON.stringify(savedSignature)).run();
          break;
        } catch(error) {
          const existing=await lookup();if(existing)return replay(existing);
          const message=String(error?.message)+' '+String(error?.cause?.message);
          if(message.includes('booking_overlap'))throw new BookingError('time_unavailable',409);
          if(/UNIQUE/i.test(message)&&attempt<4){id=`${idBase}${fallback()}`;continue;}
          throw error;
        }
      }
      await createHoldEvent(env,booking,id,createdAt+HOLD_SECONDS);
      await sendOwnerNotification(env,booking,{id,expiresAt:createdAt+HOLD_SECONDS});
      return receipt({id,status:'pending',expires_at:createdAt+HOLD_SECONDS});
    }catch(error){
      if(error instanceof BookingError)return json({error:error.code},error.status);
      // Never log names, signatures, request bodies, authorization tokens or SQL values.
      console.error(JSON.stringify({event:'booking_request_failed',diagnosticId}));
      return json({error:'request_unavailable',diagnosticId},503);
    }
  }
  return {agreement:context=>execute(context,'agreement'),submit:context=>execute(context,'submit')};
}
