'use strict';
const C=window.BookingCore;
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'$'+value;
const timeLabel=minutes=>`${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
const formatDate=(key,options={month:'short',day:'numeric',weekday:'short'})=>new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
const formatInstant=date=>new Intl.DateTimeFormat('en-US',{timeZone:C.zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
const initialNow=new Date();
// Clicking anywhere on a date box opens the browser's calendar picker
// (showPicker is unsupported in some browsers, which fall back to default
// click behavior).
['event-date','wedding-date'].forEach(id=>{
  $(id).addEventListener('click',()=>{try{$(id).showPicker();}catch{/* older browsers open the picker natively */}});
});
const state={step:0,maxStep:0,service:null,package:'standard',count:2,tier:'t1',length:120,date:null,time:null,week:0,details:null,submittedAt:false,groupConfirmed:false,eventConfirmed:false,agreement:null,submissionKey:null,turnstileToken:null,turnstileId:null,turnstileWait:null,drawStrokes:[]};
const firstDay=C.addDays(C.dateKey(initialNow),5);
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
  if(step===1)renderSchedule();
  if(step===2)renderDetailsMode();
  if(step===3){renderReview();loadServerAgreement();ensureTurnstile();}
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
function renderReview(){
  if(!state.details)return;
  $('review-facts').innerHTML=bookingFacts();
  $('promotion-field').hidden=state.service==='graduation'&&state.package==='group';
  $('group-promotion-note').hidden=!(state.service==='graduation'&&state.package==='group');
}
async function loadServerAgreement(){
  if(state.service!=='graduation'){
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
  return {package:apiPackage(),service:state.service,count:state.service==='graduation'&&state.package==='group'?state.count:2,
    date:state.date,time:state.time,details};
}
function ensureTurnstile(){
  if(state.turnstileId!==null)return;
  const render=()=>{state.turnstileId=window.turnstile.render($('turnstile-box'),{sitekey:'0x4AAAAAAETDlK6Z2eQKAY43',
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
const SUBMIT_ERRORS={'time_unavailable':'That time was just taken. Go back and choose another available time.',
  'agreement_changed_review_again':'The agreement changed. The current version has loaded below — review it and submit again.',
  'consent_required':'Both consent boxes must be checked before submitting.',
  'invalid_submission_key':'Something went wrong with the request. Refresh the page and try again.',
  'request_too_large':'The drawn signature is too complex. Clear it and submit with your typed name.',
  'booking_not_open_yet':'Booking requests are not open yet. Contact us directly.',
  'booking_overlap':'That time was just taken. Go back and choose another available time.'};
$('signature-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('signature-form').querySelector('.primary');
  if(!$('signature-name').value.trim()){$('signature-name').setCustomValidity('Please type your full name.');$('signature-name').reportValidity();return;}
  if(!$('signature-form').reportValidity())return;
  const s=serviceInfo();
  if(state.service==='wedding'){$('sign-error').textContent='Submissions for this service open with the next update. Contact us meanwhile.';return;}
  if(s.mode==='slots'&&(state.time===null||!slotsFor(state.date).includes(state.time))){$('sign-error').textContent='Please choose a new available time before continuing.';return;}
  if(s.mode==='event'&&state.time===null){$('sign-error').textContent='Please choose a start time before continuing.';return;}
  if(state.service!=='event'&&!state.agreement){$('sign-error').textContent='The agreement has not loaded yet. Give it a moment and try again.';return;}
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
      location.href=`/booking/confirmed/?id=${encodeURIComponent(receipt.requestId)}&expires=${encodeURIComponent(receipt.expiresAt)}`;
      return;
    }
    $('sign-error').textContent=SUBMIT_ERRORS[receipt.error]||'The request could not be submitted. Try again or contact us.';
    if(receipt.error==='agreement_changed_review_again')await loadServerAgreement();
  }catch{
    $('sign-error').textContent='The request could not be submitted. Check your connection and try again, or contact us.';
  }finally{
    button.disabled=false;
    if(window.turnstile&&state.turnstileId!==null){window.turnstile.reset(state.turnstileId);state.turnstileToken=null;}
  }
});
// Within the booking flow the arrow steps back through the form; from the
// first step it leaves the page, returning to wherever the visitor came from.
(function(){
  $('nav-back').addEventListener('click',event=>{
    if(state.step>0){
      event.preventDefault();
      showStep(state.step-1);
      return;
    }
    const sameOrigin=document.referrer&&new URL(document.referrer,location.href).origin===location.origin;
    if(sameOrigin&&history.length>1){
      event.preventDefault();
      history.back();
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
