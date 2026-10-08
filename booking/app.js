'use strict';
const C=window.BookingCore;
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'$'+value;
const timeLabel=minutes=>`${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
const formatDate=(key,options={month:'short',day:'numeric',weekday:'short'})=>new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
const formatInstant=date=>new Intl.DateTimeFormat('en-US',{timeZone:C.zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
const state={step:0,maxStep:0,service:null,package:'standard',count:2,tier:'t1',length:120,date:null,time:null,details:null,submittedAt:false,groupConfirmed:false,eventConfirmed:false,agreement:null,submissionKey:null,turnstileToken:null,turnstileId:null,turnstileWait:null,drawStrokes:[]};
let drawing=false,hasDrawing=false;const drawStrokes=state.drawStrokes;
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
  ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;drawStrokes.length=0;
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
    if(state.service==='graduation')$('summary-spec').textContent=state.package==='group'&&!state.groupConfirmed?'90 minutes · 2 – 4 graduates':`${C.packages[state.package].advertised} · ${participantsCount()} graduate${participantsCount()>1?'s':''}`;
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
function updateProgress(){}
function showStep(step, moveFocus=true){
  const signedFlow=state.service==='graduation'||state.service==='realestate';
  state.step=step;state.maxStep=Math.max(state.maxStep,step);
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=Number(el.dataset.panel)!==step);
  if(step===1)renderSchedule();
  if(step===2)renderDetailsMode();
  if(step===3){renderReview();if(state.service!=='event')loadServerAgreement();ensureTurnstile();}
  updateProgress();updateSummary();
  if(moveFocus){
    $(`heading-${step}`).focus({preventScroll:true});
  }
}
function selectService(service,opts={}){
  if(!C.services[service])throw new Error('Choose a service');
  const firstTime=state.service!==service;
  if(state.service!==service){state.service=service;state.date=null;state.time=null;state.maxStep=0;resetDownstream();if(service==='event')state.eventConfirmed=false;}
  document.querySelectorAll('[name=service]').forEach(el=>el.checked=el.value===service);
  document.querySelectorAll('.package.service').forEach(el=>el.classList.toggle('selected',el.dataset.service===service));
  document.querySelectorAll('.service-select').forEach(el=>el.disabled=el.closest('.package').dataset.service!==service);
  if(state.service==='graduation'){
    const grad=(opts.package&&C.packages[opts.package])?opts.package:'standard';
    if(state.package!==grad){state.package=grad;state.time=null;state.maxStep=0;resetDownstream();if(grad==='group')state.groupConfirmed=false;}
    $('grad-package').value=state.package;
    $('grad-price').textContent=state.package==='group'?'from $280':money(C.price(state.package,state.count));
  }
  if(state.service==='realestate'){
    if(opts.tier&&serviceInfo().tiers.some(t=>t.id===opts.tier)){state.tier=opts.tier;}
    const tier=serviceInfo().tiers.find(t=>t.id===state.tier);$('re-tier').value=state.tier;$('re-price').textContent=(tier.id==='t3'?'from ':'')+money(tier.price);}
  updateSummary();updateProgress();
}
document.querySelectorAll('[name=service]').forEach(el=>el.addEventListener('change',()=>selectService(el.value)));
$('grad-package').addEventListener('change',()=>{selectService('graduation',{package:$('grad-package').value});});
$('group-size').addEventListener('change',()=>{
  const value=Number($('group-size').value);
  if(!C.groupPrices[value])return;
  state.count=value;state.groupConfirmed=true;state.time=null;resetDownstream();
  renderSlots();updateSummary();updateProgress();
});
$('re-tier').addEventListener('change',()=>{state.tier=$('re-tier').value;selectService('realestate');});
document.querySelectorAll('[data-step]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.step))));
document.querySelectorAll('[data-back]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.back))));
/* One continue button per service tile (visible only on the selected
   tile via CSS :has). Each button carries its service's own schedule
   label from booking-core, so no text swapping is needed. */
document.querySelector('.package-options').addEventListener('click',event=>{
  if(event.target.closest('button[data-service]')){state.maxStep=1;showStep(1);}
});

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
  $('lead-hint').textContent=s.mode==='wedding'
    ?'Please choose a date at least 1 month in advance; earlier requests may be subject to higher cost.'
    :'Please choose a date at least 3 days in advance.';
  $('session-schedule').hidden=s.mode!=='slots';
  $('event-schedule').hidden=s.mode!=='event';
  $('wedding-schedule').hidden=s.mode!=='wedding';
  $('enter-details').disabled=true;
  if(s.mode==='slots')await renderDates();
  if(s.mode==='event')renderEventSchedule();
  if(s.mode==='wedding')renderWeddingSchedule();
  updateSummary();
}
function renderDates(){
  /* Slots-mode date picking uses the same native date input as the event
     and wedding flows: the browser/OS supplies the pop-out calendar on
     desktop and the platform picker on mobile. Bounds mirror the server:
     3-day lead, one-year ceiling. */
  const {min,max}=slotsBounds();
  $('session-date').min=min;$('session-date').max=max;
  $('session-date').value=state.date||'';
  if(state.date)loadDateSlots();else{calendarStatus='idle';calendarData=null;renderSlots();}
}
function renderSlots(){

  // No date chosen yet: prompt for the picker instead of reporting a failure.
  if(!state.date){
    $('enter-details').disabled=true;
    $('time-heading').textContent='Pick a date above';
    $('duration-note').textContent='';
    $('slots').innerHTML='<p class="empty">Choose your session date, then your start time.</p>';
    $('slot-explanation').textContent='';
    updateSummary();
    return;
  }
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
/* Slots-mode date bounds: 3-day lead (managed by the server), one-year
   ceiling — same window every service shares. The native date input gets
   min/max attributes so the pop-out calendar dims unbookable days. */
function slotsBounds(){
  const today=C.dateKey(new Date());
  return {min:C.addDays(today,3),max:C.addDays(today,365)};
}
/* Desktop nicety: clicking anywhere in a date field pops the calendar,
   not just the small calendar icon at the field's right edge. Modern
   desktop browsers expose showPicker() on date inputs; feature-guarded so
   browsers without it simply keep their default behavior. */
['session-date','event-date','wedding-date'].forEach(id=>{
  $(id).addEventListener('click',()=>{
    if(typeof $(id).showPicker==='function'){
      try{$(id).showPicker();}catch{/* Some browsers throw if the picker is
          already open from the same gesture; the click still opens it. */}
    }
  });
});
$('session-date').addEventListener('change',()=>{
  const value=$('session-date').value;
  if(!value)return;
  const {min,max}=slotsBounds();
  if(value<min||value>max){
    $('session-date').value=state.date||'';
    $('time-error').textContent='Sessions can be booked from 3 days out to one year ahead.';
    return;
  }
  state.date=value;state.time=null;resetDownstream();
  $('time-error').textContent='';
  updateSummary();updateProgress();
  loadDateSlots();
});
/* Fetch availability for the chosen date. The response covers the chosen
   date through the end of its calendar month; the client reads slot times
   for the selected day only. */
function loadDateSlots(){
  const chosen=state.date;
  if(!chosen){calendarStatus='idle';calendarData=null;return;}
  const attempt=++calendarRequest;
  calendarController?.abort();
  const controller=new AbortController();calendarController=controller;
  calendarStatus='loading';calendarData=null;$('time-error').textContent='';
  renderSlots();updateProgress();
  const timer=window.setTimeout(()=>controller.abort(),25000);
  (async()=>{
    try{
      const query=new URLSearchParams({start:chosen,package:apiPackage()});
      const response=await fetch(`/api/availability?${query}`,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error('Availability request failed');
      const data=await response.json();
      const monthEndDay=new Date(Date.UTC(Number(chosen.slice(0,4)),Number(chosen.slice(5,7)),0)).getUTCDate();
      const expectedDays=monthEndDay-Number(chosen.slice(8,10))+1;
      if(data.source!=='google'||data.timeZone!==C.zone||data.start!==chosen||data.package!==apiPackage()||!Array.isArray(data.days)||data.days.length!==expectedDays||!data.days.every((day,i)=>day.key===C.addDays(chosen,i)&&Array.isArray(day.slots)&&day.slots.every(t=>Number.isInteger(t)&&t>=0&&t<1440&&t%30===0)))throw new Error('Unexpected availability response');
      if(attempt!==calendarRequest)return;
      calendarData={...data,loadedAt:Date.now()};
      calendarStatus='ready';
    }catch{
      if(attempt!==calendarRequest)return;
      calendarStatus='error';calendarData=null;state.date=null;
      $('time-error').textContent='Availability could not be loaded. Please try again or contact us.';
    }finally{
      window.clearTimeout(timer);
      if(attempt===calendarRequest){renderSlots();updateProgress();}
    }
  })();
}

function updateEventLengthLabel(){
  $('event-length-label').textContent=state.length>=840?'All day':`${state.length/60} hours`;
}
function renderEventSchedule(){
  const minKey=C.addDays(C.dateKey(new Date()),3);
  $('event-date').min=minKey;
  updateEventLengthLabel();
  $('event-duration-note').textContent='';
  const chosen=state.date?state.date:null;
  $('event-time-heading').textContent=chosen?formatDate(chosen,{weekday:'long',month:'short',day:'numeric'}):'Start times';
  const ready=chosen&&calendarStatus==='ready'&&calendarData?.start===chosen;
  if(!ready){
    $('event-slots').innerHTML=chosen?'<p class="empty">No clear window fits that length on this date. Try another date or a shorter length.</p>':'<p class="empty">Pick a date to see start times.</p>';
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
  const chosen=state.date;
  if(!chosen){calendarStatus='idle';calendarData=null;renderEventSchedule();return;}
  const attempt=++calendarRequest;
  calendarController?.abort();
  const controller=new AbortController();calendarController=controller;
  calendarStatus='loading';calendarData=null;$('time-error').textContent='';
  resetDownstream();renderEventSchedule();updateProgress();
  const timer=window.setTimeout(()=>controller.abort(),25000);
  (async()=>{
    try{
      const query=new URLSearchParams({start:chosen,package:'event'});
      const response=await fetch(`/api/availability?${query}`,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error('Availability request failed');
      const data=await response.json();
      if(data.source!=='google'||data.timeZone!==C.zone||data.start!==chosen||data.package!=='event'||!Array.isArray(data.busy)||!data.busy.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n))))throw new Error('Unexpected availability response');
      if(attempt!==calendarRequest)return;
      calendarData={package:'event',busy:data.busy,start:chosen,loadedAt:Date.now()};
      calendarStatus='ready';
    }catch{
      if(attempt!==calendarRequest)return;
      calendarStatus='error';calendarData=null;
      $('time-error').textContent='Availability could not be loaded. Please try again or contact us.';
    }finally{
      window.clearTimeout(timer);
      if(attempt===calendarRequest){renderEventSchedule();updateProgress();}
    }
  })();
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
  if(value<min||value>max){$('wedding-date').value=state.date||'';$('time-error').textContent='Weddings need at least 1 week of lead time; earlier requests may be subject to higher cost.';return;}
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
  const event=state.service==='event';
  $('details-submit').innerHTML=(event||state.service==='wedding')?'Book It <span aria-hidden="true">→</span>':'Review agreement <span aria-hidden="true">→</span>';
  if(event||state.service==='wedding'){$('details-turnstile-box').hidden=false;ensureTurnstile('details-turnstile-box');state.submissionKey=state.submissionKey||crypto.randomUUID();}
  $('participants-field').hidden=!(grad&&state.package==='group');
  $('individual-graduate-field').hidden=!grad||state.package==='group';
  $('graduate-name').disabled=grad&&state.package==='group';
  const useAddress=state.service!=='graduation';
  $('grad-location-group').hidden=useAddress;
  // Hidden required fields must be disabled, or form validation blocks the
  // submit silently ("not focusable") because they can't be filled.
  $('location').required=!useAddress;
  $('location').disabled=useAddress;
  $('address-field').hidden=!useAddress;
  $('address').required=useAddress;
  $('address-label').firstChild.textContent=state.service==='realestate'?'Property address ':'Venue or location ';
  const old=[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value,email:row.querySelector('.participant-email').value}));
  $('participant-rows').innerHTML=(grad&&state.package==='group')?Array.from({length:state.count},(_,i)=>`<div class="participant-row"><h3>GRADUATE ${i+1}</h3><div class="field-grid"><div class="field"><label for="participant-${i}-name">Full name <span>*</span></label><input class="participant-name" id="participant-${i}-name" required maxlength="100" value="${escapeHTML(old[i]?.name||'')}"></div><div class="field"><label for="participant-${i}-email">Email <span class="optional">optional</span></label><input class="participant-email" id="participant-${i}-email" type="email" maxlength="254" value="${escapeHTML(old[i]?.email||'')}"></div></div></div>`).join(''):'';
}
$('address').disabled=false;
$('details-form').addEventListener('input',()=>{state.details=null;state.maxStep=2;resetSignature();updateProgress();});
async function submitEventBooking(){
  const button=$('details-submit');
  if(!state.turnstileToken&&window.turnstile){$('details-error').textContent='Complete the verification box before submitting.';return;}
  $('details-error').textContent='';
  button.disabled=true;
  try{
    const response=await fetch('/api/booking/submit',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({booking:submissionBooking(),
        submissionKey:state.submissionKey||crypto.randomUUID(),turnstileToken:state.turnstileToken||undefined})});
    const receipt=await response.json().catch(()=>({}));
    if(response.status===201||(response.status===200&&receipt.replayed)){
      location.href=`/booking/confirmed/?id=${encodeURIComponent(receipt.requestId)}`;
      return;
    }
    $('details-error').textContent=SUBMIT_ERRORS[receipt.error]||receipt.detail||'The request could not be submitted. Try again or contact us.';
  }catch{
    $('details-error').textContent='The request could not be submitted. Check your connection and try again, or contact us.';
  }finally{
    button.disabled=false;
    if(window.turnstile&&state.turnstileId!==null){window.turnstile.reset(state.turnstileId);state.turnstileToken=null;}
  }
}
$('details-form').addEventListener('submit',event=>{
  event.preventDefault();
  const textInputs=[...$('details-form').querySelectorAll('input[required]:not([type=email])')];
  for(const input of textInputs){input.setCustomValidity(input.value.trim()?'':'Please enter this information.');if(!input.reportValidity()){input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}}
  if(!$('details-form').reportValidity())return;
  const grad=state.service==='graduation';
  const location=grad?($('location').value==='Another Charlotte-area location'?$('custom-location').value.trim():$('location').value):$('address').value.trim();
  const d={name:$('client-name').value.trim(),email:$('client-email').value.trim(),phone:$('client-phone').value.trim(),location,graduate:$('graduate-name').value.trim()||$('client-name').value.trim(),notes:$('notes').value.trim(),participants:[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value.trim(),email:row.querySelector('.participant-email').value.trim()}))};
  if(JSON.stringify(d)!==JSON.stringify(state.details))resetSignature();state.details=d;
  if(state.service==='event'||state.service==='wedding'){submitEventBooking();return;}
  showStep(3);
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
function renderReview(){
  if(!state.details)return;
  $('review-facts').innerHTML=bookingFacts();
  $('promotion-field').hidden=state.service==='graduation'&&state.package==='group';
  $('group-promotion-note').hidden=!(state.service==='graduation'&&state.package==='group');
}
async function loadServerAgreement(){
  if(!['graduation','realestate'].includes(state.service)){
    state.agreement=null;
    $('agreement-title').textContent=`${serviceInfo().label} services agreement`;
    $('agreement-content').innerHTML='<p class="draft-notice"><strong>Submissions for this service open with the next update.</strong> Contact us meanwhile and I will set everything up with you directly.</p>';
    return;
  }
  try{
    const response=await fetch('/api/booking/agreement',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({booking:submissionBooking()})});
    if(!response.ok)throw new Error('unavailable');
    const agreement=await response.json();
    state.agreement={version:agreement.version,hash:agreement.hash};
    $('agreement-title').textContent=agreement.title;
    $('agreement-content').innerHTML=agreement.html;
  }catch{
    state.agreement=null;
    $('agreement-content').innerHTML='<p class="form-error">The agreement could not be loaded. Refresh the page or contact us.</p>';
  }
}
function submissionBooking(){
  const details={name:state.details.name,email:state.details.email,phone:state.details.phone,
      location:state.details.location,graduate:state.details.graduate,
      notes:state.details.notes,participants:state.details.participants};
  if(state.service==='event')return {package:'event',service:'event',count:1,length:state.length,
    date:state.date,time:state.time,details};
  if(state.service==='wedding')return {package:'wedding',service:'wedding',count:1,
    date:state.date,details};
  return {package:apiPackage(),service:state.service,count:state.service==='graduation'&&state.package==='group'?state.count:2,
    date:state.date,time:state.time,details};
}
function ensureTurnstile(container){
  if(state.turnstileId!==null)return;
  const render=()=>{state.turnstileId=window.turnstile.render($(typeof container==='string'?container:'turnstile-box'),{sitekey:'0x4AAAAAAETDlK6Z2eQKAY43',
    action:'booking_submit',
    callback:token=>{state.turnstileToken=token;},
    'expired-callback':()=>{state.turnstileToken=null;},
    'error-callback':()=>{state.turnstileToken=null;}});
    window.clearInterval(state.turnstileWait);};
  if(window.turnstile)render();
  else state.turnstileWait=window.setInterval(()=>{if(window.turnstile)render();},200);
  window.setTimeout(()=>window.clearInterval(state.turnstileWait),15000);
}
$('signature-name').addEventListener('input',()=>{$('typed-signature').textContent=$('signature-name').value;$('signature-name').setCustomValidity('');});
function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);drawStrokes.push([[+(p.x/canvas.width).toFixed(4),+(p.y/canvas.height).toFixed(4)]]);});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);drawStrokes[drawStrokes.length-1].push([+(p.x/canvas.width).toFixed(4),+(p.y/canvas.height).toFixed(4)]);});
canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
$('clear-signature').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;});
const SUBMIT_ERRORS={'time_unavailable':'That time is no longer available. Go back and choose another time.',
  'agreement_changed_review_again':'The agreement changed. The current version has loaded below — review it and submit again.',
  'consent_required':'Both consent boxes must be checked before submitting.',
  'invalid_submission_key':'Something went wrong with the request. Refresh the page and try again.',
  'request_too_large':'The drawn signature is too complex. Clear it and submit with your typed name.',
  'booking_not_open_yet':'Booking requests are not open yet. Contact us directly.',
  'booking_overlap':'That time is no longer available. Go back and choose another time.',
  'calendar_unavailable':'We could not reach the booking calendar. Try again in a minute — if it keeps failing, contact us directly.',
  'send_failed':'The booking was received but the confirmation email failed. Try again or contact us.',
  'request_unavailable':'The request could not be completed. Try again or contact us.',
  'verification_failed':'The verification failed. Refresh the page and try again.',
  'verification_unavailable':'Verification is temporarily unavailable. Try again in a minute.',
  'invalid_fields':'Some booking details were invalid. Refresh the page and try again.',
  'signature_name_mismatch':'Your signature must match the name you entered on the booking form.'};
$('signature-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('signature-form').querySelector('.primary');
  if(!$('signature-name').value.trim()){$('signature-name').setCustomValidity('Please type your full name.');$('signature-name').reportValidity();return;}
  const sigName=$('signature-name').value.trim().replace(/\s+/g,' ').toLowerCase();
  if(sigName!==String(state.details&&state.details.name||'').trim().replace(/\s+/g,' ').toLowerCase()){$('sign-error').textContent='Your signature must match the first and last name you entered on the booking form.';return;}
  if(!$('signature-form').reportValidity())return;
  const s=serviceInfo();

  if(s.mode==='slots'&&(state.time===null||!slotsFor(state.date).includes(state.time))){$('sign-error').textContent='Please choose a new available time before continuing.';return;}
  if(s.mode==='event'&&state.time===null){$('sign-error').textContent='Please choose a start time before continuing.';return;}
  if(!['event','wedding'].includes(state.service)&&!state.agreement){$('sign-error').textContent='The agreement has not loaded yet. Give it a moment and try again.';return;}
  if(!state.turnstileToken&&window.turnstile){$('sign-error').textContent='Complete the verification checkbox before submitting.';return;}
  button.disabled=true;$('sign-error').textContent='';
  try{
    const response=await fetch('/api/booking/submit',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({booking:submissionBooking(),
        signature:{typedName:$('signature-name').value.trim(),agreementConsent:true,electronicConsent:true,
          promotion:document.querySelector('[name=promotion]:checked')?.value??null,drawing:drawStrokes.slice(-100)},
        submissionKey:state.submissionKey||crypto.randomUUID(),turnstileToken:state.turnstileToken||undefined},
        state.service==='event'?{}:{agreementVersion:state.agreement.version,agreementHash:state.agreement.hash}))});
    const receipt=await response.json().catch(()=>({}));
    if(response.status===201||(response.status===200&&receipt.replayed)){
      location.href=`/booking/confirmed/?id=${encodeURIComponent(receipt.requestId)}`;
      return;
    }
    $('sign-error').textContent=SUBMIT_ERRORS[receipt.error]||receipt.detail||'The request could not be submitted. Try again or contact us.';
    if(receipt.error==='agreement_changed_review_again')await loadServerAgreement();
  }catch{
    $('sign-error').textContent='The request could not be submitted. Check your connection and try again, or contact us.';
  }finally{
    button.disabled=false;
    if(window.turnstile&&state.turnstileId!==null){window.turnstile.reset(state.turnstileId);state.turnstileToken=null;}
  }
});
// Within the booking flow the arrow steps back through the form; from the
// first step it returns to the page the visitor came from (same-site history),
// falling back to the services hub when there is nowhere to go back to.
(function(){
  $('nav-back').addEventListener('click',event=>{
    if(state.step>0){
      event.preventDefault();
      showStep(state.step-1);
      return;
    }
    if(document.referrer){
      try{
        const from=new URL(document.referrer);
        if(from.origin===location.origin&&from.pathname!==location.pathname){
          event.preventDefault();
          history.back();
        }
      }catch(e){/* unparseable referrer: follow the services fallback */}
    }
  });
})();
const params=new URLSearchParams(window.location.search);
const requestedService=params.get('service');
const requestedPackage=params.get('package');
const requestedTier=params.get('tier');
if(requestedService&&C.services[requestedService]){
  selectService(requestedService,{package:requestedPackage,tier:requestedTier});
  if((requestedService==='graduation'&&C.packages[requestedPackage])||(requestedService==='realestate'&&serviceInfo().tiers.some(t=>t.id===requestedTier)))showStep(1,false);
}
updateSummary();updateProgress();
