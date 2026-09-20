/* Shared Google access: token decryption and bounded JSON fetching. */
export const ZONE='America/New_York';
const encoder=new TextEncoder();
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function accessToken(env,signal) {
  const email=env.GOOGLE_ALLOWED_EMAIL.toLowerCase();
  const row=await env.BOOKING_DB.prepare('SELECT encrypted_refresh_token FROM google_connections WHERE account_email = ?').bind(email).first();
  if(!row)throw new Error('not-connected');
  const keyBytes=decode(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  if(keyBytes.length!==32)throw new Error('key');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
  const [version,iv,ciphertext]=row.encrypted_refresh_token.split('.');
  if(version!=='v1')throw new Error('key');
  let refreshToken;
  try {
    refreshToken=new TextDecoder().decode(await crypto.subtle.decrypt({
      name:'AES-GCM',iv:decode(iv),additionalData:encoder.encode(`refresh:${email}`)
    },key,decode(ciphertext)));
  } catch(error) {
    console.error(JSON.stringify({event:'decrypt_failed',firstKeyBytes:Array.from(keyBytes.slice(0,4)),additionalData:new TextDecoder().decode(encoder.encode(`refresh:${email}`))}));
    throw error;
  }
  const tokens=await googleJSON('https://oauth2.googleapis.com/token',{
    method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'})
  },signal);
  if(typeof tokens.access_token!=='string'||!tokens.access_token)throw new Error('token');
  return tokens.access_token;
}
export async function googleJSON(url,options,signal) {
  const result=await fetch(url,{...options,signal,redirect:'manual'});
  if(!result.ok||!result.body)throw new Error(`http-${result.status}`);
  const reader=result.body.getReader();
  const chunks=[];let size=0;
  for(;;){
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>524288){await reader.cancel();throw new Error('response-size');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
