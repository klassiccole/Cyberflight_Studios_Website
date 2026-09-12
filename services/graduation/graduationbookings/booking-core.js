'use strict';
// Pure scheduling functions shared by the prototype and its checks.
(function (root) {
  const packages = {
    mini: { name: 'Grad Mini', duration: 30, advertised: '30 minutes', minimum: 10, photos: '10+ photos', price: 125 },
    standard: { name: 'Grad Standard', duration: 90, advertised: '60–90 minutes', minimum: 20, photos: '20–25+ photos', price: 200 },
    group: { name: 'Grad Group', duration: 90, advertised: '90 minutes', minimum: 30, photos: '30–40+ photos total' }
  };
  const groupPrices = { 2: 280, 3: 340, 4: 380 };
  const zone = 'America/New_York';
  function price(id, count) {
    if (!packages[id]) throw new Error('Unknown package');
    if (id === 'group' && !groupPrices[count]) throw new Error('Group must have 2–4 graduates');
    return id === 'group' ? groupPrices[count] : packages[id].price;
  }
  function dateKey(date) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const find = type => p.find(x => x.type === type).value;
    return `${find('year')}-${find('month')}-${find('day')}`;
  }
  function addDays(key, days) {
    const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
  }
  function sessionInstant(key, minutes) {
    const [y,m,d] = key.split('-').map(Number);
    const wall = Date.UTC(y,m-1,d,Math.floor(minutes/60),minutes%60);
    for (const offset of [4,5]) {
      const candidate = new Date(wall + offset*3600000);
      const parts = new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(candidate);
      const actual = Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
      if (dateKey(candidate)===key && actual===minutes) return candidate;
    }
    throw new Error('Invalid Charlotte local time');
  }
  function sampleAvailability(key) {
    const weekday = new Date(key+'T12:00:00Z').getUTCDay();
    return { blocks: [0,3].includes(weekday) ? [] : [[780,1080]], busy: weekday===2 ? [[900,960]] : [] };
  }
  function availableSlots({key, duration, now=new Date(), blocks, busy}) {
    const sample = sampleAvailability(key);
    blocks = blocks || sample.blocks; busy = busy || sample.busy;
    const candidates = new Set();
    for (const [start,end] of blocks) {
      for (let t=Math.ceil((start+30)/30)*30;t+duration+30<=end;t+=30) {
        const blockedStart=t-30, blockedEnd=t+duration+30;
        if (busy.some(([a,b])=>blockedStart<b && blockedEnd>a)) continue;
        if (sessionInstant(key,t).getTime()<now.getTime()+120*3600000) continue;
        candidates.add(t);
      }
    }
    return [...candidates].sort((a,b)=>a-b);
  }
  function deadline(key, minutes) { return new Date(sessionInstant(key,minutes).getTime()-48*3600000); }
  const api = {packages,groupPrices,zone,price,dateKey,addDays,sessionInstant,sampleAvailability,availableSlots,deadline};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.BookingCore=api;
})(typeof window!=='undefined'?window:globalThis);
