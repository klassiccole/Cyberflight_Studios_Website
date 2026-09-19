'use strict';
const C=window.BookingCore;
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'$'+value;
const timeLabel=minutes=>`${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
const formatDate=(key,options={month:'short',day:'numeric',weekday:'short'})=>new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
const formatInstant=date=>new Intl.DateTimeFormat('en-US',{timeZone:C.zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
const initialNow=new Date();
const state={step:0,maxStep:0,service:null,package:'standard',count:2,tier:'t1',length:120,date:null,time:null,week:0,details:null,submittedAt:false,gradConfirmed:false,groupConfirmed:false,eventConfirmed:false};
const firstDay=C.addDays(C.dateKey(initialNow),5);
let drawing=false,hasDrawing=false;
const canvas=$('signature-canvas'),ctx=canvas.getContext('2d');
ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#201931';

function serviceInfo(){return C.services[state.service];}
function internalPackage(){const s=serviceInfo();return s.mode==='slots'&&s.internalPackage?s.internalPackage:state.package;}
function duration(){const s=serviceInfo();return s.mode==='event'?state.length:s.mode==='wedding'?null:(s.internalPackage?s.duration:C.packages[state.package].duration);}
function total(){
  const s=serviceInfo();
  if(!s)return null;
  if(s.mode==='event'||s.mode==='wedding')return null;
  if(s.internalPackage){const t=s.tiers.find(t=>t.id===state.tier);return t?t.price:null;}
  return C.price(state.package,state.count);
}
function participantsCount(){return state.service==='graduation'&&state.package==='group'?state.count:1;}
function resetSignature(){
  $('signature-name').value='';$('typed-signature').textContent='';
  $('agreement-consent').checked=false;$('electronic-consent').checked=false;
  document.querySelectorAll('[name=promotion]').forEach(el=>el.checked=false);
  ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;
}
function resetDownstream(){state.details=null;resetSignature();}
function priceLabel(value){return value===null?'By Proposal':money(value);}
function updateSummary(){
  const s=serviceInfo();
  if(!s){
    $('summary-title').textContent='Choose a service';
    $('summary-spec').textContent='Choose a service to begin.';
    $('summary-price').textContent='—';
    $('summary-date').textContent='Choose a date';$('summary-time').textContent='Choose a time';
    return;
  }
  $('summary-title').textContent=s.label;
  if(s.mode==='slots'){
    if(state.service==='graduation')$('summary-spec').textContent=state.gradConfirmed?(state.package==='group'&&!state.groupConfirmed?'90 minutes · 2 – 4 graduates':`${C.packages[state.package].advertised} · ${participantsCount()} graduate${participantsCount()>1?'s':''}`):'30 min – 2 hours (depends on package)';
    else $('summary-spec').textContent='90 minutes · property walkthrough';
  }else if(s.mode==='event'){
    $('summary-spec').textContent=state.eventConfirmed?`${state.length/60} hour${state.length>=120?'s':''}`:'2 hours – All Day';
  }else{
    $('summary-spec').textContent='All Day · By Proposal';
  }
  const groupOpen=state.service==='graduation'&&state.package==='group'&&!state.groupConfirmed;
  $('summary-price').textContent=groupOpen?'from $280':priceLabel(total());
  $('summary-date').textContent=state.date?formatDate(state.date):'Choose a date';
  const showTime=state.time!==null&&Number.isInteger(state.time)&&s.mode!=='wedding';
  $('summary-time').textContent=showTime?`${timeLabel(state.time)}–${timeLabel(state.time+duration())}`:'—';
  $('summary-due').textContent=s.payLabel;
  $('summary-image').src=s.summaryImage.src;$('summary-image').alt=s.summaryImage.alt;
}
function hasTime(){const s=serviceInfo();return s.mode==='wedding'?false:state.time!==null&&Number.isInteger(state.time);}
function updateProgress(){
  document.querySelectorAll('[data-step]').forEach(button=>{
    const n=Number(button.dataset.step);button.disabled=n>state.maxStep||state.submittedAt;
    button.classList.toggle('completed',n<state.step);
    if(n===state.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
  });
}
function showStep(step, moveFocus=true){
  state.step=step;state.maxStep=Math.max(state.maxStep,step);
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=Number(el.dataset.panel)!==step);
  $('success').hidden=true;
  if(step===1)renderSchedule();
  if(step===2)renderDetailsMode();
  if(step===3)renderReview();
  updateProgress();updateSummary();
  if(moveFocus){
    $(`heading-${step}`).focus({preventScroll:true});
    document.querySelector('.steps').scrollIntoView({behavior:'auto',block:'start'});
  }
}
function selectService(service,opts={}){
  if(!C.services[service])throw new Error('Choose a service');
  const firstTime=state.service!==service;
  if(state.service!==service){state.service=service;state.date=null;state.time=null;state.week=0;state.maxStep=0;resetDownstream();if(service==='event')state.eventConfirmed=false;}
  document.querySelectorAll('[name=service]').forEach(el=>el.checked=el.value===service);
  document.querySelectorAll('.package.service').forEach(el=>el.classList.toggle('selected',el.dataset.service===service));
  document.querySelectorAll('.service-select').forEach(el=>el.disabled=el.closest('.package').dataset.service!==service);
  $('choose-time').disabled=false;
  $('choose-time').innerHTML=`${serviceInfo().scheduleLabel} <span aria-hidden="true">→</span>`;
  if(state.service==='graduation'){
    if(opts.package!==undefined)state.gradConfirmed=true;
    else if(firstTime)state.gradConfirmed=false;
    const grad=(opts.package&&C.packages[opts.package])?opts.package:'standard';
    if(state.package!==grad){state.package=grad;state.time=null;state.maxStep=0;resetDownstream();if(grad==='group')state.groupConfirmed=false;}
    $('grad-package').value=state.package;
    $('grad-price').textContent=state.package==='group'?'from $280':money(C.price(state.package,state.count));
  }
  if(state.service==='realestate'){const tier=serviceInfo().tiers.find(t=>t.id===state.tier);$('re-tier').value=state.tier;$('re-price').textContent=(tier.id==='t3'?'from ':'')+money(tier.price);}
  updateSummary();updateProgress();
}
document.querySelectorAll('[name=service]').forEach(el=>el.addEventListener('change',()=>selectService(el.value)));
$('grad-package').addEventListener('change',()=>{state.gradConfirmed=true;selectService('graduation',{package:$('grad-package').value});});
$('group-size').addEventListener('change',()=>{
  const value=Number($('group-size').value);
  if(!C.groupPrices[value])return;
  state.count=value;state.groupConfirmed=true;state.time=null;resetDownstream();
  renderSlots();updateSummary();updateProgress();
});
$('re-tier').addEventListener('change',()=>{state.tier=$('re-tier').value;selectService('realestate');});
document.querySelectorAll('[data-step]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.step))));
document.querySelectorAll('[data-back]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.back))));
$('choose-time').addEventListener('click',()=>{state.maxStep=1;showStep(1);});

let calendarRequest=0,calendarData=null,calendarStatus='idle',calendarController=null;
function apiPackage(){return internalPackage();}
function slotsFor(key){
  if(calendarStatus!=='ready'||calendarData?.package!==apiPackage())return [];
  return calendarData.days.find(day=>day.key===key)?.slots||[];
}
async function renderSchedule(){
  const s=serviceInfo();
  $('group-options').hidden=!(state.service==='graduation'&&state.package==='group');
  if(state.service==='graduation'&&state.package==='group')$('group-size').value=state.groupConfirmed?String(state.count):'';
  $('session-schedule').hidden=s.mode!=='slots';
  $('event-schedule').hidden=s.mode!=='event';
  $('wedding-schedule').hidden=s.mode!=='wedding';
  $('enter-details').disabled=true;
  if(s.mode==='slots')await renderDates();
  if(s.mode==='event')renderEventSchedule();
  if(s.mode==='wedding')renderWeddingSchedule();
  updateSummary();
}
async function renderDates(){
  const start=C.addDays(firstDay,state.week*7);
  const packageId=apiPackage();
  if(calendarStatus==='ready'&&calendarData?.start===start&&calendarData.package===packageId&&Date.now()-calendarData.loadedAt<30000){renderDateButtons();return;}
  const attempt=++calendarRequest;
  calendarController?.abort();
  const controller=new AbortController();calendarController=controller;
  calendarStatus='loading';calendarData=null;state.time=null;resetDownstream();
  $('time-error').textContent='';
  renderDateButtons();updateProgress();
  const timer=window.setTimeout(()=>controller.abort(),25000);
  try{
    const query=new URLSearchParams({start,package:packageId});
    const response=await fetch(`/api/availability?${query}`,{signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Availability request failed');
    const data=await response.json();
    if(data.source!=='google'||data.timeZone!==C.zone||data.start!==start||data.package!==packageId||!Array.isArray(data.days)||data.days.length!==7||!data.days.every((day,i)=>day.key===C.addDays(start,i)&&Array.isArray(day.slots)&&day.slots.every(t=>Number.isInteger(t)&&t>=0&&t<1440&&t%30===0)))throw new Error('Unexpected availability response');
    if(attempt!==calendarRequest)return;
    calendarData={...data,loadedAt:Date.now()};
    calendarStatus='ready';
    state.date=data.days.find(day=>day.key===state.date&&day.slots.length)?.key||data.days.find(day=>day.slots.length)?.key||null;
  }catch{
    if(attempt!==calendarRequest)return;
    calendarStatus='error';calendarData=null;state.date=null;
    $('time-error').textContent='Availability could not be loaded. Go back to Service and try again, or contact us.';
  }finally{
    window.clearTimeout(timer);
    if(attempt===calendarRequest){renderDateButtons();updateProgress();}
  }
}
function renderDateButtons(){
  const weekStart=C.addDays(firstDay,state.week*7);
  const end=C.addDays(weekStart,6);
  $('date-range').textContent=`${formatDate(weekStart,{month:'short',day:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  $('previous-week').disabled=state.week===0;$('next-week').disabled=state.week===3;
  const days=Array.from({length:7},(_,i)=>C.addDays(weekStart,i));
  if(!state.date)state.date=days.find(key=>slotsFor(key).length>0)||null;
  $('date-grid').innerHTML=days.map(key=>{
    const available=slotsFor(key).length>0;
    return `<button type="button" class="date-button" data-date="${key}" aria-label="${escapeHTML(formatDate(key,{weekday:'long',month:'long',day:'numeric'}))}${available?'':', unavailable'}" aria-pressed="${state.date===key}" ${available?'':'disabled'}><span>${formatDate(key,{weekday:'short'})}</span><strong>${Number(key.slice(-2))}</strong><small>${available?'Available':calendarStatus==='ready'?'Closed':'Unavailable'}</small></button>`;
  }).join('');
  $('date-grid').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{
    if(state.date!==el.dataset.date){state.date=el.dataset.date;state.time=null;resetDownstream();}
    $('time-error').textContent='';renderDates();updateSummary();updateProgress();
  }));
  renderSlots();
}
function renderSlots(){
  const p=C.packages[apiPackage()];
  $('enter-details').disabled=calendarStatus!=='ready'||state.time===null;
  if(calendarStatus!=='ready'){
    $('time-heading').textContent=calendarStatus==='loading'?'Loading availability…':'Availability unavailable';
    $('duration-note').textContent='';
    $('slots').textContent=calendarStatus==='loading'?'Checking available times…':'Unable to load times. Please try again or contact us.';
    $('slot-explanation').textContent='';
    return;
  }
  const slots=state.date?slotsFor(state.date):[];
  if(state.time!==null&&!slots.includes(state.time)){state.time=null;resetDownstream();}
  $('time-heading').textContent=state.date?formatDate(state.date,{weekday:'long',month:'short',day:'numeric'}):'Select a date above';
  $('duration-note').textContent='';
  $('slots').innerHTML=slots.length?slots.map(t=>`<button type="button" class="slot" data-time="${t}" aria-pressed="${state.time===t}">${timeLabel(t)}</button>`).join(''):'<p class="empty">No times fit this service on this date. Choose another available day.</p>';
  $('slots').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{
    if(state.time!==Number(el.dataset.time)){state.time=Number(el.dataset.time);resetDownstream();}
    $('time-error').textContent='';renderSlots();updateSummary();updateProgress();
  }));
  $('slot-explanation').textContent=state.time!==null?`Your session: ${timeLabel(state.time)}–${timeLabel(state.time+duration())}. With buffers, the calendar keeps ${timeLabel(state.time-30)}–${timeLabel(state.time+duration()+30)} clear.`:'Choose a start time. Both 30-minute buffers are included when checking availability.';
  updateSummary();
}
function moveWeek(change){state.week=Math.max(0,Math.min(3,state.week+change));state.date=null;state.time=null;resetDownstream();renderDates();updateProgress();}
$('previous-week').addEventListener('click',()=>moveWeek(-1));$('next-week').addEventListener('click',()=>moveWeek(1));

function updateEventLengthLabel(){
  $('event-length-label').textContent=state.length>=540?'All day':`${state.length/60} hours`;
}
function renderEventSchedule(){
  const minKey=C.addDays(C.dateKey(new Date()),5);
  $('event-date').min=minKey;
  updateEventLengthLabel();
  $('event-duration-note').textContent=`${state.length} minutes reserved · 30-minute buffers included`;
  const chosen=state.date?state.date:null;
  $('event-time-heading').textContent=chosen?formatDate(chosen,{weekday:'long',month:'short',day:'numeric'}):'Start times';
  const ready=chosen&&calendarStatus==='ready'&&calendarData?.start===chosen;
  if(!ready){
    $('event-slots').innerHTML=chosen?'<p class="empty">Live event scheduling opens with the next update. For now, pick your date and length and submit — I’ll confirm times with you directly.</p>':'<p class="empty">Pick a date to see start times.</p>';
    $('event-note').textContent='';
    $('enter-details').disabled=!chosen;
    return;
  }
  renderEventSlots();
}
function renderEventSlots(){
  const chosen=state.date;
  const all=C.eventStarts({key:chosen,length:state.length,now:new Date(),busy:calendarData.busy||[]});
  if(state.time!==null&&!all.includes(state.time)){state.time=null;resetDownstream();}
  if(!state.time)state.time=all[0]??null;
  $('event-slots').innerHTML=all.length?all.map(t=>`<button type="button" class="slot" data-time="${t}" aria-pressed="${state.time===t}">${timeLabel(t)}</button>`).join(''):'<p class="empty">No clear window fits that length on this date. Try another date or a shorter length.</p>';
  $('event-slots').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{
    if(state.time!==Number(el.dataset.time)){state.time=Number(el.dataset.time);resetDownstream();}
    renderEventSlots();updateSummary();updateProgress();
  }));
  $('event-note').textContent=state.time!==null?`Your coverage: ${timeLabel(state.time)}–${timeLabel((state.time+state.length)%1440)}${state.time+state.length>=1440?' (next day)':''}.`:'Choose a start time for your coverage block.';
  $('enter-details').disabled=state.time===null;
  updateSummary();
}
$('event-date').addEventListener('change',()=>{
  const value=$('event-date').value;
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
  state.date=value;state.time=null;resetDownstream();
  loadEventDay();
});
function loadEventDay(){
  calendarStatus='pending';calendarData=null;$('time-error').textContent='';
  resetDownstream();
  renderEventSchedule();updateProgress();updateSummary();
}
$('event-length').addEventListener('input',()=>{
  state.length=Number($('event-length').value);
  state.eventConfirmed=true;
  updateEventLengthLabel();
  if(state.date&&calendarStatus==='ready'){state.time=null;renderEventSlots();}
  updateSummary();
});

function weddingBounds(){
  const min=C.addDays(C.dateKey(new Date()),C.services.wedding.minDaysAhead);
  const max=C.addDays(C.dateKey(new Date()),C.services.wedding.maxDaysAhead);
  return {min,max};
}
function renderWeddingSchedule(){
  const {min,max}=weddingBounds();
  $('wedding-date').min=min;$('wedding-date').max=max;
  $('wedding-date').value=state.date||'';
  $('enter-details').disabled=!state.date;
}
$('wedding-date').addEventListener('change',()=>{
  const value=$('wedding-date').value;
  if(!value)return;
  const {min,max}=weddingBounds();
  if(value<min||value>max){$('wedding-date').value=state.date||'';$('time-error').textContent='Weddings need at least one month of lead time.';return;}
  state.date=value;state.time=null;resetDownstream();
  $('time-error').textContent='';updateSummary();updateProgress();
  $('enter-details').disabled=!state.date;
});
$('enter-details').addEventListener('click',()=>{
  const s=serviceInfo();
  if(s.mode==='wedding'){if(!state.date){$('time-error').textContent='Please choose a wedding date.';return;}showStep(2);return;}
  if(s.mode==='event'){
    if(!state.date){$('time-error').textContent='Please choose an event date.';return;}
    if(calendarStatus==='ready'&&state.time===null){$('time-error').textContent='Please choose a start time.';return;}
    showStep(2);return;
  }
  if(state.time===null){$('time-error').textContent='Please choose a session start time.';return;}
  if(!slotsFor(state.date).includes(state.time)){state.time=null;renderSlots();$('time-error').textContent='That time is no longer within the booking window. Please select another.';return;}
  showStep(2);
});

function renderDetailsMode(){
  const grad=state.service==='graduation';
  $('participants-field').hidden=!(grad&&state.package==='group');
  $('individual-graduate-field').hidden=!grad||state.package==='group';
  $('graduate-name').disabled=grad&&state.package==='group';
  const useAddress=state.service!=='graduation';
  $('grad-location-group').hidden=useAddress;
  $('address-field').hidden=!useAddress;
  $('address').required=useAddress;
  $('address-label').firstChild.textContent=state.service==='realestate'?'Property address ':'Venue or location ';
  const old=[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value,email:row.querySelector('.participant-email').value}));
  $('participant-rows').innerHTML=(grad&&state.package==='group')?Array.from({length:state.count},(_,i)=>`<div class="participant-row"><h3>GRADUATE ${i+1}</h3><div class="field-grid"><div class="field"><label for="participant-${i}-name">Full name <span>*</span></label><input class="participant-name" id="participant-${i}-name" required maxlength="100" value="${escapeHTML(old[i]?.name||'')}"></div><div class="field"><label for="participant-${i}-email">Email <span class="optional">optional</span></label><input class="participant-email" id="participant-${i}-email" type="email" maxlength="254" value="${escapeHTML(old[i]?.email||'')}"></div></div></div>`).join(''):'';
}
$('address').disabled=false;
$('details-form').addEventListener('input',()=>{state.details=null;state.maxStep=2;resetSignature();updateProgress();});
$('details-form').addEventListener('submit',event=>{
  event.preventDefault();
  const textInputs=[...$('details-form').querySelectorAll('input[required]:not([type=email])')];
  for(const input of textInputs){input.setCustomValidity(input.value.trim()?'':'Please enter this information.');if(!input.reportValidity()){input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}}
  if(!$('details-form').reportValidity())return;
  const grad=state.service==='graduation';
  const location=grad?($('location').value==='Another Charlotte-area location'?$('custom-location').value.trim():$('location').value):$('address').value.trim();
  const d={name:$('client-name').value.trim(),email:$('client-email').value.trim(),phone:$('client-phone').value.trim(),location,graduate:$('graduate-name').value.trim()||$('client-name').value.trim(),notes:$('notes').value.trim(),participants:[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value.trim(),email:row.querySelector('.participant-email').value.trim()}))};
  if(JSON.stringify(d)!==JSON.stringify(state.details))resetSignature();state.details=d;showStep(3);
});

function fact(label,value){return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;}
function sessionText(){
  const s=serviceInfo();
  if(s.mode==='wedding')return `${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})} · full day`;
  if(s.mode==='event'&&state.time===null)return `${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})} · ${state.length/60} hour${state.length>=120?'s':''} · start time to be confirmed`;
  return `${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})} · ${timeLabel(state.time)}–${timeLabel((state.time+duration())%1440)}${s.mode==='event'&&state.time+duration()>=1440?' (next day)':''}`;
}
function bookingFacts(){
  const s=serviceInfo(),grad=state.service==='graduation';
  const rows=[fact('Service',`${s.label} · ${priceLabel(total())}`),fact('Requested session',sessionText()),fact('Client',state.details.name),fact('Location',state.details.location)];
  if(grad)rows.push(fact('Payment due',formatInstant(C.deadline(state.date,state.time))));
  if(grad&&state.package==='group')rows.push(fact('Graduates',state.details.participants.map(p=>p.name).join(', ')));
  if(grad&&state.package!=='group')rows.push(fact('Graduate',state.details.graduate));
  return rows.join('');
}
function section(title,body){return `<section><h3>${escapeHTML(title)}</h3>${body}</section>`;}
function paragraph(text){return `<p>${escapeHTML(text)}</p>`;}
function graduationAgreement(){
  const group=state.package==='group',p=C.packages[state.package],d=state.details;
  const content=[
    ['1. Parties and session',`This illustrative draft is between the Photographer, [legal contracting party to be confirmed], operating as Cyberflight Studios and represented by Daniel Cole Dorazio, and ${d.name}${group?', the Lead Client and booking organizer':''}. Requested session: ${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})}, ${timeLabel(state.time)}–${timeLabel(state.time+p.duration)} Charlotte time, at ${d.location}.`],
    ['2. Included services',`${p.name}: ${p.advertised}, ${participantsCount()} graduate${participantsCount()>1?'s':''}, ${group?'individual and group portraits, ':''}and at least ${p.minimum} professionally edited high-resolution photographs${group?' across the entire group, not per person':''}. ${state.package==='standard'?'Approximately 20 – 25 or more images are anticipated; 90 minutes are reserved to allow the full advertised duration. ':''}${group?'Approximately 30 – 40 or more images are anticipated. Equal numbers per graduate or every group combination are not guaranteed. ':''}Movement between nearby spots and outfit changes take place within the session time. Additional coverage or services require written agreement.`],
    ['3. Price and payment',`The selected package price is ${money(total())}. ${group?'The Lead Client is responsible for the entire amount. Reimbursement arrangements among friends are separate; other graduates do not owe the Photographer merely by being listed. ':''}No payment is collected by this form. If the request is accepted, an invoice will be sent separately through Zoho. Full payment is due by ${formatInstant(C.deadline(state.date,state.time))}, 48 hours before the requested session. Any applicable tax, travel fee, or other charge must be disclosed and accepted before a live agreement is signed; this prototype does not calculate them.`],
    ['4. Request, hold, and confirmation','A submitted request is not a confirmed booking. In the proposed live flow, a time would be held for 72 hours from successful submission while the Photographer reviews the location and availability. Written approval within that period converts the request into a confirmed reservation with the stated payment deadline. If declined or not approved within 72 hours, the hold expires and the customer is notified. An expired request must not be approved without checking availability again. Material changes to date, price, or other terms require written acceptance.'],
    ['5. Cancellation, rescheduling, and attendance','DRAFT POLICY TO COMPLETE BEFORE LAUNCH: cancellation and refund terms, rescheduling notice, late-arrival and nonattendance treatment, and consequences of missed payment have not yet been finalized. No automatic forfeiture or cancellation fee is established here. Notify the Photographer promptly about any requested change. Rescheduling depends on availability.'],
    ...(group?[['6. Group changes','DRAFT POLICY TO COMPLETE BEFORE LAUNCH: participant withdrawals, substitutions, reduced group size, and any repricing deadline. The Lead Client coordinates changes, which require written confirmation. More than four graduates require a separate quote. Each participant provides their own promotional-use choice; the organizer does not grant permission for other adults.']]:[]),
    [group?'7. Cooperation and access':'6. Cooperation and access','The Client provides accurate session information and arranges required private-property or restricted-location access unless otherwise agreed. Participants should arrive prepared and cooperate reasonably. Unsafe activities and photography prohibited by venue rules may be declined. Reduced coverage resulting from access restrictions, interference, or lack of reasonable cooperation is outside the Photographer’s responsibility.'],
    [group?'8. Style, selection, and editing':'7. Style, selection, and editing','The Client has an opportunity to review the Photographer’s style. The Photographer retains reasonable creative discretion over posing, composition, lighting, selection, cropping, and normal editing. Particular expressions, poses, photographs, or backgrounds are not guaranteed unless accepted in writing. Duplicate, test, unsuitable, and rejected images are excluded. Extensive retouching, compositing, or additional work requires a separate agreement and may carry additional fees.'],
    [group?'9. RAW and working files':'8. RAW and working files','RAW files, unedited photographs, rejected images, project files, and intermediate versions are not included unless expressly agreed. The Photographer is not obligated to retain or provide them after final delivery.'],
    [group?'10. Delivery and backups':'9. Delivery and backups',`Included photographs are delivered through a high-resolution digital gallery within seven calendar days after the completed session. ${group?'Shared versus individual gallery access must be agreed before a live booking is signed. Individual contact details and signature records are not included in shared galleries. ':''}Past-due payment may delay release, with a release date provided after payment. Additional work may have a separate agreed schedule. Emergencies or technical delays will be communicated with a revised expected delivery date. Downloads remain available for at least 60 days after delivery. Recipients are responsible for backups; later redelivery, if available, may carry a separately disclosed fee.`],
    [group?'11. Copyright and personal use':'10. Copyright and personal use','The Photographer retains copyright. Full payment grants the Client and listed graduates a nonexclusive license to download, store, display, share, and print delivered photographs for personal, noncommercial use. Sale, licensing, commercial exploitation, or claiming authorship requires written permission. Payment does not transfer copyright or authorize someone to grant rights over another person’s likeness.'],
    [group?'12. Equipment and inability to perform':'11. Equipment and inability to perform','The Photographer takes reasonable equipment and image-protection precautions. If equipment failure or file loss prevents delivery, reasonable efforts will be made to recover material or arrange an appropriate remedy. If illness, injury, emergency, or another circumstance prevents performance, the Client will be notified promptly. A replacement or rescheduled session may be mutually agreed but is not guaranteed. If no acceptable alternative is reached, payments for services that cannot be performed will be refunded.'],
    [group?'13. Weather and events beyond control':'12. Weather and events beyond control','Severe weather, venue closures, government restrictions, and similar events may require an alternate date or location. The parties will seek a reasonable alternative or resolution regarding payments, services already performed, and reasonably incurred nonrecoverable expenses. This does not reduce the preceding refund obligation where the Photographer cannot perform and no mutually acceptable alternative is reached.'],
    [group?'14. Limitation of liability':'13. Limitation of liability',`To the fullest extent permitted by applicable law, the Photographer’s total liability ${group?'to the Lead Client ':''}for the affected services will not exceed the amount actually paid for them, and excludes indirect, incidental, consequential, special, or punitive damages. Liability that cannot legally be excluded or limited remains unaffected. ${group?'The Lead Client’s signature does not waive other participants’ independent rights. ':''}This provision is a draft requiring legal review.`],
    [group?'15. Portfolio and promotional use':'14. Portfolio and promotional use',`${group?'Every graduate makes a separate choice. The organizer’s booking signature does not grant permission on behalf of others. ':'The photographed graduate or an appropriately authorized guardian makes the choice below; a different paying client does not grant permission merely by signing. '}Permission is optional and does not affect price, services, or deliverables. Missing permission is treated as not granted. The Photographer will only publicly use images where all identifiable participants have granted applicable permission. Permission covers the Photographer’s own portfolio, website, social media, samples, exhibitions, competitions, and reasonable promotional materials, not unrelated third-party advertising. Reasonable privacy concerns will be considered in good faith.`],
    [group?'16. Agreement and signatures':'15. Agreement and signatures','The completed agreement and identified accepted booking details form the session agreement. Invoices bill the agreed terms and do not independently change them. Material changes require written acceptance. North Carolina law governs. Electronic signing requires the parties’ agreement and copies they can retain. The proposed live flow records the exact accepted terms and signing details and supplies copies to the parties. The Photographer’s acceptance/countersignature process and final legal business name must be settled before launch. THIS DEMONSTRATION DOES NOT CREATE A CONTRACT.']
  ];
  return '<p class="draft-notice"><strong>Prototype agreement — not ready for signing.</strong> This demonstration adapts the earlier drafts to the proposed booking flow. Cancellation, group changes, legal business name, taxes, and final acceptance wording still need review.</p>'+content.map(([title,body])=>section(title,paragraph(body))).join('');
}
function generalAgreement(){
  const s=serviceInfo(),d=state.details;
  const payment={
    realestate:`The quoted price for the selected property tier is ${money(total())}. No payment is collected by this form. If the request is accepted, an invoice will be sent separately through Zoho, due before the shoot. Full payment is required before the session begins.`,
    event:`Event coverage is priced by proposal based on the requested length (${state.length/60} hour${state.length>=120?'s':''}). No payment is collected by this form. If the proposal is accepted, a retainer is due at signing to secure the date, with the balance due seven days before the event. For bookings made less than two weeks out, the full amount is due before the session.`,
    wedding:`Wedding coverage is priced by proposal agreed at the proposal meeting. No payment is collected by this form. A retainer is due at signing to secure the date, with the balance due two weeks before the wedding. For bookings made within one month of the date, the full amount is due at signing.`
  };
  const content=[
    ['1. Parties and booking',`This illustrative draft is between the Photographer, [legal contracting party to be confirmed], operating as Cyberflight Studios and represented by Daniel Cole Dorazio, and ${d.name}. Requested booking: ${sessionText()}, at ${d.location}${s.mode==='event'?`, approximately ${state.length/60} hour${state.length>=120?'s':''} of coverage`:''}.`],
    ['2. Included services',`${s.label} coverage as described in the accepted proposal or selected tier. Deliverables, galleries, and timelines are confirmed in writing before the session. Additional coverage or services require written agreement.`],
    ['3. Price and payment',payment[state.service]],
    ['4. Request and confirmation','A submitted request is not a confirmed booking. The Photographer reviews the request and confirms in writing. Material changes to date, price, or other terms require written acceptance.'],
    ['5. Cancellation, rescheduling, and attendance','DRAFT POLICY TO COMPLETE BEFORE LAUNCH: cancellation and refund terms, rescheduling notice, late-arrival and nonattendance treatment, and consequences of missed payment have not yet been finalized. Notify the Photographer promptly about any requested change.'],
    ['6. Cooperation and access','The Client provides accurate location information and arranges required private-property or restricted-location access unless otherwise agreed. Reduced coverage resulting from access restrictions, interference, or lack of reasonable cooperation is outside the Photographer’s responsibility.'],
    ['7. Style, selection, and editing','The Client has an opportunity to review the Photographer’s style. The Photographer retains reasonable creative discretion over coverage, composition, lighting, selection, and normal editing. RAW files and unedited images are not included unless expressly agreed.'],
    ['8. Delivery and backups','Deliverables are provided on the schedule stated in the accepted proposal. Past-due payment may delay release. Downloads remain available for at least 60 days after delivery. Recipients are responsible for backups.'],
    ['9. Copyright and personal use','The Photographer retains copyright. Full payment grants the Client a nonexclusive license to download, store, display, share, and print delivered photographs for personal, noncommercial use. Commercial use requires written permission.'],
    ['10. Limitation of liability','To the fullest extent permitted by applicable law, the Photographer’s total liability for the affected services will not exceed the amount actually paid for them, and excludes indirect, incidental, consequential, special, or punitive damages. This provision is a draft requiring legal review.'],
    ['11. Agreement and signatures','The completed agreement and identified accepted booking details form the session agreement. Material changes require written acceptance. North Carolina law governs. Electronic signing requires the parties’ agreement and copies they can retain. THIS DEMONSTRATION DOES NOT CREATE A CONTRACT.']
  ];
  return '<p class="draft-notice"><strong>Draft agreement — not ready for signing.</strong> Cancellation policy, legal business name, taxes, and final acceptance wording still need review.</p>'+content.map(([title,body])=>section(title,paragraph(body))).join('');
}
function renderReview(){
  if(!state.details)return;
  const grad=state.service==='graduation';
  $('review-facts').innerHTML=bookingFacts();
  $('agreement-title').textContent=grad?(state.package==='group'?'Group graduation photography agreement':'Graduation photography agreement'):`${serviceInfo().label} services agreement`;
  $('agreement-content').innerHTML=grad?graduationAgreement():generalAgreement();
  $('promotion-field').hidden=grad&&state.package==='group';
  $('group-promotion-note').hidden=!(grad&&state.package==='group');
}
$('signature-name').addEventListener('input',()=>{$('typed-signature').textContent=$('signature-name').value;$('signature-name').setCustomValidity('');});
function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);});
canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
$('clear-signature').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;});
$('signature-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!$('signature-name').value.trim()){$('signature-name').setCustomValidity('Please type your full name.');$('signature-name').reportValidity();return;}
  if(!$('signature-form').reportValidity())return;
  const s=serviceInfo();
  if(s.mode==='slots'&&(state.time===null||!slotsFor(state.date).includes(state.time))){$('sign-error').textContent='Please choose a new available time before continuing.';return;}
  if(s.mode==='event'&&calendarStatus==='ready'&&state.time===null){$('sign-error').textContent='Please choose a start time before continuing.';return;}
  state.submittedAt=true;
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=true);
  $('success-facts').innerHTML=bookingFacts();
  updateProgress();
  $('success-heading').focus({preventScroll:true});$('success').scrollIntoView({behavior:'auto',block:'start'});
});
$('nav-back').href=/[?&]service=graduation/.test(window.location.search)?'/services/graduation/':'/services/';
const params=new URLSearchParams(window.location.search);
const requestedService=params.get('service');
const requestedPackage=params.get('package');
if(requestedService&&C.services[requestedService]){
  selectService(requestedService,{package:requestedPackage});
  if(requestedService==='graduation'&&C.packages[requestedPackage])showStep(1,false);
}
updateSummary();updateProgress();
