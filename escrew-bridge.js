(function(){
/* Мост к eScrew (pwaplog). Когда Fuel Window открыт с того же origin, что и
   eScrew (pwaplog.pages.dev), roster лежит в общем localStorage — читаем его
   напрямую, без сети и без кодов. Чистая логика: без DOM, тестируется в node. */
const KEY="pwaplog.aims-roster.v1";
const REST=/^(OFF|DOFF|ROFF|HOMS|HOMX|AVLB|VAC|CSH|MED\d*|SICK|UFF|CHLD)$/;
const hhmm=v=>{const m=typeof v==="string"&&/(?:T|^)([01]\d|2[0-3]):?([0-5]\d)$/.exec(v);return m?m[1]+":"+m[2]:null};

function kindOf(report){
  if(!report)return"duty";
  const h=+report.slice(0,2);
  return(h>=18||h<=5)?"night":h<=8?"early":"duty";
}

/* eScrew-roster -> дни Fuel Window той же формы, что отдаёт roster-parser.js.
   Приоритет на дату: duty с рейсами > отсутствие (VAC…) > OFF-подобная запись. */
function daysFromEscrew(roster){
  if(!roster||!Array.isArray(roster.duties))return[];
  const byDate=new Map();
  const put=(date,day)=>{if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!byDate.has(date))byDate.set(date,Object.assign({date},day))};
  for(const d of roster.duties){
    const f=(d.flights||[]).filter(x=>x&&x.origin&&x.destination);
    if(!f.length)continue;
    const report=hhmm(d.report||d.start)||hhmm(f[0].departure);
    const release=hhmm(d.release||d.end)||hhmm(f[f.length-1].arrival);
    const airports=[f[0].origin,...f.map(x=>x.destination)];
    put(d.date,{code:(f[0].flightNumber||"").replace(/^KC\s*/i,"")||"Duty",times:[report,release].filter(Boolean),
      airports,kind:kindOf(report),report,release,detail:f.map(x=>x.flightNumber+" "+x.origin+"-"+x.destination).join(" ").slice(0,350)});
  }
  for(const a of roster.absences||[])put(a.date,{code:a.code,times:[],airports:[],kind:"rest",report:null,release:null,detail:a.code});
  for(const a of roster.activities||[]){
    const code=String(a.code||"").toUpperCase();
    if(REST.test(code))put(a.date,{code,times:[],airports:[],kind:"rest",report:null,release:null,detail:code});
    else if(hhmm(a.start)&&hhmm(a.end)){
      const report=hhmm(a.start),release=hhmm(a.end);
      put(a.date,{code:code||"Duty",times:[report,release],airports:a.location?[a.location]:[],kind:kindOf(report),report,release,detail:(a.title||code).slice(0,350)});
    }
  }
  return[...byDate.values()].sort((x,y)=>x.date.localeCompare(y.date));
}

/* Отдельное приложение на экране «Домой» не видит localStorage eScrew (iOS
   даёт каждому свою копию). Поэтому eScrew кладёт roster в зашифрованный
   почтовый ящик (/api/schedule/<id>) на своём сайте: код fuel-… вставляется
   сюда один раз, ключ AES-GCM и имя ящика выводятся из него через HKDF — те
   же метки, что в pwaplog features/roster/fuelLink.ts. Сервер видит только
   байты, которые не может прочитать; код не покидает телефон. */
const LINK_KEY="fuel-escrew-link",IV=12;
function parseLinkCode(text){
  const m=/fuel-([A-Za-z0-9_-]{43})/.exec(String(text||""));
  if(!m)return null;
  const b=fromB64u(m[1]);return b&&b.length===32?m[1]:null;
}
function fromB64u(s){
  try{const bin=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(bin,c=>c.charCodeAt(0))}catch(e){return null}
}
const hkdf=info=>({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(0),info:new TextEncoder().encode(info)});
async function mailbox(secret){
  const subtle=crypto.subtle,base=await subtle.importKey("raw",fromB64u(secret),"HKDF",false,["deriveKey","deriveBits"]);
  const key=await subtle.deriveKey(hkdf("pwaplog fuel key"),base,{name:"AES-GCM",length:256},false,["decrypt"]);
  const bits=new Uint8Array(await subtle.deriveBits(hkdf("pwaplog fuel mailbox"),base,256));
  return{key,id:[...bits].map(b=>b.toString(16).padStart(2,"0")).join("")};
}
async function openSealed(bytes,key){
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,IV)},key,bytes.slice(IV));
  return JSON.parse(new TextDecoder().decode(plain));
}
/* null — eScrew ещё ничего не отправил; ошибка — нет сети или код не тот. */
async function fetchLinkedRoster(secret,fetchFn,base){
  const{key,id}=await mailbox(secret);
  const r=await(fetchFn||fetch)((base||"")+"/api/schedule/"+id,{cache:"no-store"});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("Сервер ответил "+r.status);
  let value;
  try{value=await openSealed(new Uint8Array(await r.arrayBuffer()),key)}catch(e){throw new Error("Не удалось открыть: вставьте код из eScrew заново")}
  if(!value||value.app!=="pwaplog-fuel")throw new Error("Это не roster из eScrew");
  return value;
}
function loadLink(storage){try{return(storage||localStorage).getItem(LINK_KEY)}catch(e){return null}}
function saveLink(secret,storage){try{const st=storage||localStorage;secret?st.setItem(LINK_KEY,secret):st.removeItem(LINK_KEY)}catch(e){}}

function loadEscrewRoster(storage){
  try{const raw=(storage||localStorage).getItem(KEY);return raw?JSON.parse(raw):null}catch(e){return null}
}

const EscrewBridge={KEY,daysFromEscrew,loadEscrewRoster,parseLinkCode,mailbox,openSealed,fetchLinkedRoster,loadLink,saveLink};
if(typeof module!=="undefined"&&module.exports)module.exports=EscrewBridge;else window.EscrewBridge=EscrewBridge;
})();
