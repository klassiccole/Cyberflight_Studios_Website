/* Contact form handler: verifies Turnstile and forwards the message to the
   owner mailbox via Resend. Reply-To is the visitor so replies land in the
   owner's mailbox addressed to them. */
function json(body,status=200) {
  return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
export async function onRequest({ request, env }) {
  const diagnosticId=crypto.randomUUID();
  try {
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const form=await request.formData();
    const name=String(form.get('name')||'').trim().slice(0,100);
    const email=String(form.get('email')||'').trim().slice(0,254);
    const message=String(form.get('message')||'').trim().slice(0,5000);
    const website=String(form.get('website')||'').trim();
    const token=String(form.get('cf-turnstile-response')||'');
    if(!name||!email||!message)return json({error:'missing_fields'},400);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'invalid_email'},400);
    // Honeypot: silently accept and discard bot submissions.
    if(website)return json({ok:true});
    if(typeof env.TURNSTILE_SECRET!=='string'||!env.TURNSTILE_SECRET)return json({error:'verification_not_configured'},503);
    if(!token||token.length>2048)return json({error:'verification_required'},400);
    const verifyResponse=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,
        ...(request.headers.get('CF-Connecting-IP')?{remoteip:request.headers.get('CF-Connecting-IP')}:{})})});
    if(!verifyResponse.ok)return json({error:'verification_unavailable'},503);
    const verification=await verifyResponse.json();
    if(verification.success!==true)return json({error:'verification_failed'},403);
    if(typeof env.RESEND_API_KEY!=='string'||!env.RESEND_API_KEY)return json({error:'delivery_not_configured'},503);
    if(typeof env.BOOKING_OWNER_EMAIL!=='string'||!env.BOOKING_OWNER_EMAIL.trim())return json({error:'delivery_not_configured'},503);
    const safeText=v=>String(v).replace(/[<>]/g,'');
    const lines=[`General question from ${safeText(name)} at ${safeText(email)}`,'',
      message,'','Reply directly to this visitor at their email address.'];
    const sendResponse=await fetch('https://api.resend.com/emails',{method:'POST',
      signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:'Cyberflight Studios <cole@cyberflight.studio>',
        to:[env.BOOKING_OWNER_EMAIL.trim()],
        reply_to:email,
        subject:`Contact Form — ${safeText(name)}`,text:lines.join('\n')})});
    if(!sendResponse.ok) {
      const body=await sendResponse.text().catch(()=>'');
      console.error(JSON.stringify({event:'contact_send_failed',status:sendResponse.status,body:body.slice(0,120)}));
      return json({error:'send_failed'},503);
    }
    return json({ok:true});
  } catch(error) {
    console.error(JSON.stringify({event:'contact_form_failed',diagnosticId}));
    return json({error:'request_unavailable'},503);
  }
}
