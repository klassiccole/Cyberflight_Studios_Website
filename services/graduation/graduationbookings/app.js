'use strict';
const C=window.BookingCore;
const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'$'+value;
const timeLabel=minutes=>`${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes<720?'AM':'PM'}`;
const formatDate=(key,options={month:'short',day:'numeric',weekday:'short'})=>new Intl.DateTimeFormat('en-US',{...options,timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
const formatInstant=date=>new Intl.DateTimeFormat('en-US',{timeZone:C.zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
const initialNow=new Date();
const state={step:0,maxStep:0,package:'standard',count:2,date:null,time:null,week:0,details:null,submittedAt:null};
const firstDay=C.addDays(C.dateKey(initialNow),5);
let drawing=false,hasDrawing=false;
const canvas=$('signature-canvas'),ctx=canvas.getContext('2d');
ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#201931';

function packageInfo(){return C.packages[state.package];}
function participantsCount(){return state.package==='group'?state.count:1;}
function total(){return C.price(state.package,state.count);}
function resetSignature(){
  $('signature-name').value='';$('typed-signature').textContent='';
  $('agreement-consent').checked=false;$('electronic-consent').checked=false;
  document.querySelectorAll('[name=promotion]').forEach(el=>el.checked=false);
  ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;
}
function resetDownstream(){state.details=null;state.submittedAt=null;resetSignature();}
function updateSummary(){
  const p=packageInfo();
  $('summary-title').textContent=p.name;
  $('summary-spec').textContent=`${p.advertised} · ${participantsCount()} graduate${participantsCount()>1?'s':''}`;
  $('summary-price').textContent=money(total());
  $('summary-date').textContent=state.date?formatDate(state.date):'Choose a date';
  $('summary-time').textContent=state.time!==null?`${timeLabel(state.time)}–${timeLabel(state.time+p.duration)}`:'Choose a time';
  $('summary-due').textContent=state.date&&state.time!==null?formatInstant(C.deadline(state.date,state.time)):'48 hours before';
  const group=state.package==='group';
  $('summary-image').src=group?'../../../images/services/graduation/graduation3.webp':'../../../images/services/graduation/graduation1.webp';
  $('summary-image').alt=group?'Group graduation portrait by Cyberflight Studios':'Graduation portrait by Cyberflight Studios';
}
function updateProgress(){
  $('change-package').disabled=Boolean(state.submittedAt);
  document.querySelectorAll('[data-step]').forEach(button=>{
    const n=Number(button.dataset.step);button.disabled=n>state.maxStep||Boolean(state.submittedAt);
    button.classList.toggle('completed',n<state.step);
    if(n===state.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
  });
}
function showStep(step, moveFocus=true){
  state.step=step;state.maxStep=Math.max(state.maxStep,step);
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=Number(el.dataset.panel)!==step);
  $('success').hidden=true;
  if(step===1)renderDates();
  if(step===2)renderParticipants();
  if(step===3)renderReview();
  updateProgress();updateSummary();
  if(moveFocus){
    $(`heading-${step}`).focus({preventScroll:true});
    document.querySelector('.steps').scrollIntoView({behavior:'auto',block:'start'});
  }
}
function selectPackage(id,count){
  if(!C.packages[id])throw new Error('Choose Mini, Standard, or Group');
  const newCount=count===undefined?state.count:Number(count);C.price(id,newCount);
  if(state.package!==id||state.count!==newCount){
    state.package=id;state.count=newCount;state.time=null;state.maxStep=0;resetDownstream();
  }
  document.querySelector(`[name=package][value=${id}]`).checked=true;
  $('group-size').value=String(state.count);$('group-options').hidden=id!=='group';
  updateSummary();updateProgress();
}
document.querySelectorAll('[name=package]').forEach(el=>el.addEventListener('change',()=>selectPackage(el.value)));
$('group-size').addEventListener('change',()=>{
  selectPackage('group',Number($('group-size').value));
  state.maxStep=1;renderDates();updateProgress();
});
document.querySelectorAll('[data-step]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.step))));
document.querySelectorAll('[data-back]').forEach(el=>el.addEventListener('click',()=>showStep(Number(el.dataset.back))));
$('choose-time').addEventListener('click',()=>showStep(1));

function slotsFor(key){return C.availableSlots({key,duration:packageInfo().duration,now:new Date()});}
function renderDates(){
  const weekStart=C.addDays(firstDay,state.week*7);
  const end=C.addDays(weekStart,6);
  $('date-range').textContent=`${formatDate(weekStart,{month:'short',day:'numeric'})} – ${formatDate(end,{month:'short',day:'numeric',year:'numeric'})}`;
  $('previous-week').disabled=state.week===0;$('next-week').disabled=state.week===3;
  const days=Array.from({length:7},(_,i)=>C.addDays(weekStart,i));
  if(!state.date)state.date=days.find(key=>slotsFor(key).length>0)||days[0];
  $('date-grid').innerHTML=days.map(key=>{
    const available=slotsFor(key).length>0;
    return `<button type="button" class="date-button" data-date="${key}" aria-label="${escapeHTML(formatDate(key,{weekday:'long',month:'long',day:'numeric'}))}${available?'':', unavailable'}" aria-pressed="${state.date===key}" ${available?'':'disabled'}><span>${formatDate(key,{weekday:'short'})}</span><strong>${Number(key.slice(-2))}</strong><small>${available?'Available':'Closed'}</small></button>`;
  }).join('');
  $('date-grid').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{
    if(state.date!==el.dataset.date){state.date=el.dataset.date;state.time=null;state.maxStep=1;resetDownstream();}
    $('time-error').textContent='';renderDates();updateSummary();updateProgress();
  }));
  renderSlots();updateSummary();
}
function renderSlots(){
  const slots=state.date?slotsFor(state.date):[];
  if(state.time!==null&&!slots.includes(state.time)){state.time=null;resetDownstream();}
  $('time-heading').textContent=state.date?formatDate(state.date,{weekday:'long',month:'short',day:'numeric'}):'Select a date above';
  $('duration-note').textContent=state.package==='mini'?'30-minute session':'90 minutes reserved';
  $('slots').innerHTML=slots.length?slots.map(t=>`<button type="button" class="slot" data-time="${t}" aria-pressed="${state.time===t}">${timeLabel(t)}</button>`).join(''):'<p class="empty">No times fit this package on this date. Choose another available day.</p>';
  $('slots').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{
    if(state.time!==Number(el.dataset.time)){state.time=Number(el.dataset.time);state.maxStep=1;resetDownstream();}
    $('time-error').textContent='';renderSlots();updateSummary();updateProgress();
  }));
  $('slot-explanation').textContent=state.time!==null?`Your session: ${timeLabel(state.time)}–${timeLabel(state.time+packageInfo().duration)}. With buffers, the calendar keeps ${timeLabel(state.time-30)}–${timeLabel(state.time+packageInfo().duration+30)} clear.`:'Choose a start time. Both 30-minute buffers are included when checking availability.';
}
function moveWeek(change){
  state.week=Math.max(0,Math.min(3,state.week+change));state.date=null;state.time=null;state.maxStep=1;resetDownstream();renderDates();updateProgress();
}
$('previous-week').addEventListener('click',()=>moveWeek(-1));$('next-week').addEventListener('click',()=>moveWeek(1));
$('enter-details').addEventListener('click',()=>{
  if(state.time===null){$('time-error').textContent='Please choose a session start time.';return;}
  if(!slotsFor(state.date).includes(state.time)){state.time=null;renderSlots();$('time-error').textContent='That sample time is no longer within the booking window. Please select another.';return;}
  showStep(2);
});

function renderParticipants(){
  const group=state.package==='group';
  $('participants-field').hidden=!group;$('individual-graduate-field').hidden=group;
  $('graduate-name').disabled=group;
  const old=[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value,email:row.querySelector('.participant-email').value}));
  $('participant-rows').innerHTML=group?Array.from({length:state.count},(_,i)=>`<div class="participant-row"><h3>GRADUATE ${i+1}</h3><div class="field-grid"><div class="field"><label for="participant-${i}-name">Full name <span>*</span></label><input class="participant-name" id="participant-${i}-name" required maxlength="100" value="${escapeHTML(old[i]?.name||'')}"></div><div class="field"><label for="participant-${i}-email">Email <span class="optional">optional</span></label><input class="participant-email" id="participant-${i}-email" type="email" maxlength="254" value="${escapeHTML(old[i]?.email||'')}"></div></div></div>`).join(''):'';
}
$('location').addEventListener('change',()=>{
  const other=$('location').value==='Another Charlotte-area location';
  $('custom-location-field').hidden=!other;$('custom-location').required=other;$('custom-location').disabled=!other;
});
$('custom-location').disabled=true;
$('sample-details').addEventListener('click',()=>{
  $('details-form').querySelectorAll('input').forEach(input=>input.setCustomValidity(''));
  $('client-name').value='Alex Morgan';$('client-email').value='alex@example.com';$('client-phone').value='704-555-0142';$('location').value='UNC Charlotte campus';$('location').dispatchEvent(new Event('change'));
  $('graduate-name').value='';$('notes').value='A few portraits near the gardens, with cap and gown.';
  const names=['Alex Morgan','Jordan Lee','Taylor Brooks','Casey Parker'];
  document.querySelectorAll('.participant-row').forEach((row,i)=>{row.querySelector('.participant-name').value=names[i];row.querySelector('.participant-email').value=names[i].split(' ')[0].toLowerCase()+'@example.com';});
  state.details=null;state.maxStep=2;resetSignature();updateProgress();
});
$('details-form').addEventListener('input',()=>{state.details=null;state.maxStep=2;resetSignature();updateProgress();});
$('details-form').addEventListener('submit',event=>{
  event.preventDefault();
  // Reject whitespace-only required text, which native required does not catch.
  const textInputs=[...$('details-form').querySelectorAll('input[required]:not([type=email])')];
  for(const input of textInputs){input.setCustomValidity(input.value.trim()?'':'Please enter this information.');if(!input.reportValidity()){input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}}
  if(!$('details-form').reportValidity())return;
  const d={name:$('client-name').value.trim(),email:$('client-email').value.trim(),phone:$('client-phone').value.trim(),location:$('location').value==='Another Charlotte-area location'?$('custom-location').value.trim():$('location').value,graduate:$('graduate-name').value.trim()||$('client-name').value.trim(),notes:$('notes').value.trim(),participants:[...document.querySelectorAll('.participant-row')].map(row=>({name:row.querySelector('.participant-name').value.trim(),email:row.querySelector('.participant-email').value.trim()}))};
  if(JSON.stringify(d)!==JSON.stringify(state.details))resetSignature();state.details=d;showStep(3);
});

function fact(label,value){return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;}
function bookingFacts(){return fact('Package',`${packageInfo().name} · ${money(total())}`)+fact('Requested session',`${formatDate(state.date)} · ${timeLabel(state.time)}`)+fact('Client',state.details.name)+fact('Location',state.details.location)+fact('Payment due',formatInstant(C.deadline(state.date,state.time)))+fact('Graduates',state.package==='group'?state.details.participants.map(p=>p.name).join(', '):state.details.graduate);}
function section(title,body){return `<section><h3>${escapeHTML(title)}</h3>${body}</section>`;}
function paragraph(text){return `<p>${escapeHTML(text)}</p>`;}
function agreementHTML(){
  const group=state.package==='group',p=packageInfo(),d=state.details;
  const content=[
    ['1. Parties and session',`This illustrative draft is between the Photographer, [legal contracting party to be confirmed], operating as Cyberflight Studios and represented by Daniel Cole Dorazio, and ${d.name}${group?', the Lead Client and booking organizer':''}. Requested session: ${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})}, ${timeLabel(state.time)}–${timeLabel(state.time+p.duration)} Charlotte time, at ${d.location}.`],
    ['2. Included services',`${p.name}: ${p.advertised}, ${participantsCount()} graduate${participantsCount()>1?'s':''}, ${group?'individual and group portraits, ':''}and at least ${p.minimum} professionally edited high-resolution photographs${group?' across the entire group, not per person':''}. ${state.package==='standard'?'Approximately 20–25 or more images are anticipated; 90 minutes are reserved to allow the full advertised duration. ':''}${group?'Approximately 30–40 or more images are anticipated. Equal numbers per graduate or every group combination are not guaranteed. ':''}Movement between nearby spots and outfit changes take place within the session time. Additional coverage or services require written agreement.`],
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
function renderReview(){
  if(!state.details)return;
  $('review-facts').innerHTML=bookingFacts();
  $('agreement-title').textContent=state.package==='group'?'Group graduation photography agreement':'Mini / Standard graduation photography agreement';
  $('agreement-content').innerHTML=agreementHTML();
  $('promotion-field').hidden=state.package==='group';$('group-promotion-note').hidden=state.package!=='group';
}
$('signature-name').addEventListener('input',()=>{$('typed-signature').textContent=$('signature-name').value;$('signature-name').setCustomValidity('');});
function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();hasDrawing=true;});
canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
$('clear-signature').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasDrawing=false;});
$('signature-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!$('signature-name').value.trim()){$('signature-name').setCustomValidity('Please type your full name.');$('signature-name').reportValidity();return;}
  if(!$('signature-form').reportValidity())return;
  if(!state.details||state.time===null||!slotsFor(state.date).includes(state.time)){$('sign-error').textContent='Please choose a new available time before continuing.';return;}
  state.submittedAt=new Date();
  document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=true);$('success').hidden=false;
  $('success-facts').innerHTML=bookingFacts()+fact('Example hold expires',formatInstant(new Date(state.submittedAt.getTime()+72*3600000)));
  const name=escapeHTML(state.details.name),email=escapeHTML(state.details.email),day=escapeHTML(formatDate(state.date)),time=escapeHTML(timeLabel(state.time));
  $('customer-email').innerHTML=`<p class="sample-label">EMAIL PREVIEW · NOT SENT</p><p><b>To:</b> ${email}<br><b>Subject:</b> We received your graduation session request</p><p>Hi ${name},</p><p>Thanks for requesting ${escapeHTML(packageInfo().name)} on ${day} at ${time} Charlotte time.</p><p>Your requested time would be held until ${escapeHTML(formatInstant(new Date(state.submittedAt.getTime()+72*3600000)))} while Cole reviews the details. This is not a confirmed booking.</p><p>After approval, you’d receive confirmation and a separate Zoho invoice for the agreed amount, due ${escapeHTML(formatInstant(C.deadline(state.date,state.time)))}. A copy of the signed request would accompany the live acknowledgment.</p><p>Cyberflight Studios</p>`;
  $('owner-email').innerHTML=`<p class="sample-label">EMAIL PREVIEW · NOT SENT</p><p><b>To:</b> cyberflightstudios@gmail.com<br><b>Subject:</b> New ${escapeHTML(packageInfo().name)} request — ${name}</p><p><b>Customer:</b> ${name}<br><b>Email:</b> ${email}<br><b>Phone:</b> ${escapeHTML(state.details.phone)}<br><b>Session:</b> ${day}, ${time}<br><b>Location:</b> ${escapeHTML(state.details.location)}<br><b>Package:</b> ${money(total())}<br><b>Calendar interval:</b> ${timeLabel(state.time-30)}–${timeLabel(state.time+packageInfo().duration+30)}<br><b>Payment due:</b> ${escapeHTML(formatInstant(C.deadline(state.date,state.time)))}</p><p>The live version would include a protected review link and access to the saved signed request. Approval and invoicing are not connected in this prototype.</p>`;
  updateProgress();$('success-heading').focus({preventScroll:true});$('success').scrollIntoView({behavior:'auto',block:'start'});
});
$('download-summary').addEventListener('click',()=>{
  if(!state.submittedAt)return;
  const summary=['CYBERFLIGHT STUDIOS — DEMONSTRATION ONLY','NOT A BOOKING, CONTRACT, SIGNED AGREEMENT, OR INVOICE','No data was sent to a server.','',`Package: ${packageInfo().name}`,`Package price (before unconfigured taxes/fees): ${money(total())}`,`Date: ${formatDate(state.date,{month:'long',day:'numeric',year:'numeric'})}`,`Session: ${timeLabel(state.time)}–${timeLabel(state.time+packageInfo().duration)} America/New_York`,`Buffered time: ${timeLabel(state.time-30)}–${timeLabel(state.time+packageInfo().duration+30)}`,`Client: ${state.details.name}`,`Email: ${state.details.email}`,`Phone: ${state.details.phone}`,`Location: ${state.details.location}`,`Graduates: ${state.package==='group'?state.details.participants.map(p=>p.name).join(', '):state.details.graduate}`,`Proposed payment deadline: ${formatInstant(C.deadline(state.date,state.time))}`,`Notes: ${state.details.notes}`,'','The signature and draft agreement are intentionally not exported.'].join('\r\n');
  const url=URL.createObjectURL(new Blob([summary],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='cyberflight-demo-summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('restart').addEventListener('click',()=>{
  $('details-form').reset();$('signature-form').reset();state.date=null;state.time=null;state.details=null;state.submittedAt=null;state.week=0;state.maxStep=0;
  $('participant-rows').innerHTML='';$('custom-location-field').hidden=true;$('custom-location').required=false;$('custom-location').disabled=true;
  resetSignature();selectPackage('standard',2);showStep(0);
});
// Only supported package identifiers can skip the package-selection screen.
// Prices and durations always come from BookingCore, never URL parameters.
const requestedPackage=new URLSearchParams(window.location.search).get('package');
if(['mini','standard','group'].includes(requestedPackage)){
  selectPackage(requestedPackage,2);
  showStep(1,false);
}else{
  updateSummary();updateProgress();
}

// A narrow optional tool changes the same local package selection as the UI.
// It never signs, submits, transmits, or persists customer information.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  try{Promise.resolve(document.modelContext.registerTool({
    name:'configure_demo_package',title:'Choose a demo graduation package',
    description:'Choose Mini, Standard, or Group in the local booking prototype. Resets any selected time and demonstration signature. Does not create a booking.',
    inputSchema:{type:'object',properties:{package:{type:'string',enum:['mini','standard','group']},graduates:{type:'integer',enum:[2,3,4]}},required:['package'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){
      if(!input||typeof input!=='object'||!['mini','standard','group'].includes(input.package)||Object.keys(input).some(k=>!['package','graduates'].includes(k)))throw new Error('Invalid package input');
      if(input.graduates!==undefined&&![2,3,4].includes(input.graduates))throw new Error('Choose 2, 3, or 4 graduates');
      if(state.submittedAt)throw new Error('Restart the demo before changing a completed preview');
      selectPackage(input.package,input.graduates);showStep(0);return {package:state.package,graduates:participantsCount(),price:total(),calendarMinutes:packageInfo().duration+60,demo:true};
    }
  },{signal:lifecycle.signal})).catch(()=>{});}catch{/* Unsupported optional API does not affect booking UI. */}
}
