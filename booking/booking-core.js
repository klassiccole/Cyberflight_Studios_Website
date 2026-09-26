'use strict';
// Pure scheduling functions shared by the universal booking page and its checks.
(function (root) {
  const packages = {
    mini: { name: 'Grad Mini', duration: 30, advertised: '30 minutes', minimum: 10, photos: '10+ photos', price: 125 },
    standard: { name: 'Grad Standard', duration: 90, advertised: '60 – 90 minutes', minimum: 20, photos: '20 – 25+ photos', price: 200 },
    group: { name: 'Grad Group', duration: 90, advertised: '90 minutes', minimum: 30, photos: '30 – 40+ photos total' }
  };
  const groupPrices = { 2: 280, 3: 340, 4: 380 };
  const zone = 'America/New_York';
  const services = {
    graduation: {
      label: 'Graduation Portraits', mode: 'slots', scheduleLabel: 'Choose a time',
      summaryImage: { src: '../images/services/graduation/graduation1.webp', alt: 'Graduation portrait by Cyberflight Studios' }
    },
    event: {
      label: 'Event Coverage', mode: 'event', scheduleLabel: 'Choose a date',
      summaryImage: { src: '../images/gallery/events/events_cover.webp', alt: 'Event coverage by Cyberflight Studios' },
      minLength: 120, maxLength: 1140, startEarliest: 480, startLatest: 1410, buffer: 30,
      payLabel: 'Retainer at booking, balance 7 days before'
    },
    wedding: {
      label: 'Wedding', mode: 'wedding', scheduleLabel: 'Choose a date',
      summaryImage: { src: '../images/services/photography/phototile.webp', alt: 'Wedding photography placeholder for Cyberflight Studios' },
      minDaysAhead: 7, maxDaysAhead: 540,
      payLabel: 'Retainer at signing, balance 2 weeks before'
    },
    realestate: {
      label: 'Real Estate', mode: 'slots', scheduleLabel: 'Choose a time',
      internalPackage: 'standard', duration: 90,
      summaryImage: { src: '../images/services/photography/photo1.webp', alt: 'Real estate photography placeholder for Cyberflight Studios' },
      tiers: [
        { id: 't1', label: 'Up to 2,000 sq ft', price: 150 },
        { id: 't2', label: '2,000–3,500 sq ft', price: 200 },
        { id: 't3', label: 'Over 3,500 sq ft', price: 250 }
      ],
      payLabel: 'Full payment by shoot day'
    }
  };
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
    const dayShift = Math.floor(minutes / 1440);
    const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
    const targetKey = dayShift ? addDays(key, dayShift) : key;
    const [y,m,d] = targetKey.split('-').map(Number);
    const wall = Date.UTC(y,m-1,d,Math.floor(minuteOfDay/60),minuteOfDay%60);
    for (const offset of [4,5]) {
      const candidate = new Date(wall + offset*3600000);
      const parts = new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(candidate);
      const actual = Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
      if (dateKey(candidate)===targetKey && actual===minuteOfDay) return candidate;
    }
    throw new Error('Invalid Charlotte local time');
  }
  function availableSlots({key, duration, now=new Date(), blocks, busy}) {
    // Show no openings until availability and busy data are provided.
    if (!Array.isArray(blocks) || !Array.isArray(busy)) return [];
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
  function eventStarts({key, length, now=new Date(), busy}) {
    // Events ignore the openings calendar: any start in the daily window whose
    // buffered block avoids busy time. Blocks may run past midnight.
    if (!Array.isArray(busy)) return [];
    const candidates = [];
    for (let t=480;t<=1410;t+=30) {
      const startInstant=sessionInstant(key,t), endInstant=sessionInstant(key,t+length);
      if (startInstant.getTime()<now.getTime()+120*3600000) continue;
      const blockedStart=startInstant.getTime()-30*60000, blockedEnd=endInstant.getTime()+30*60000;
      if (busy.some(([a,b])=>blockedStart<b && blockedEnd>a)) continue;
      candidates.push(t);
    }
    return candidates;
  }
  function deadline(key, minutes) { return new Date(sessionInstant(key,minutes).getTime()-48*3600000); }
  const api = {packages,groupPrices,services,zone,price,dateKey,addDays,sessionInstant,availableSlots,eventStarts,deadline};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.BookingCore=api;
})(typeof window!=='undefined'?window:globalThis);
