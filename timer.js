(function(){
/* Чистая логика фаз таймера голодания. fastStart хранит реальное начало,
   fastEnd — только если пользователь завершил голодание раньше плана. */
const dur=ms=>[ms/36e5,ms/6e4%60,ms/1e3%60].map(x=>String(Math.max(0,Math.floor(x))).padStart(2,"0")).join(":");
const STORE_KEY="fuel-v4";

const validEarlyEnd=(start,nominalEnd,value)=>{
  if(!start||!value)return null;
  const d=new Date(value);
  return Number.isFinite(d.getTime())&&d>=start&&d<=nominalEnd?d:null;
};

function storedEarlyEnd(fastStart){
  if(typeof localStorage==="undefined"||!fastStart)return null;
  try{
    const d=JSON.parse(localStorage.getItem(STORE_KEY)||"{}");
    return d&&d.fastStart===fastStart?d.fastEnd:null;
  }catch(e){return null}
}

function resolveCycle(fastStart,mode,fastEnd){
  const start=fastStart?new Date(fastStart):null;
  const plannedFastMs=+mode*36e5,eatMs=(24-+mode)*36e5;
  const nominalEnd=start?new Date(start.getTime()+plannedFastMs):null;
  const early=start?validEarlyEnd(start,nominalEnd,fastEnd||storedEarlyEnd(fastStart)):null;
  const end=early||nominalEnd;
  const fastMs=start&&end?end-start:plannedFastMs;
  const eatEnd=end?new Date(end.getTime()+eatMs):null;
  return{start,end,eatEnd,fastMs,plannedFastMs,eatMs,endedEarly:!!early};
}

function computeFastState(fastStart,mode,now,fastEnd){
  now=now||new Date();
  const r=resolveCycle(fastStart,mode,fastEnd);
  const{start,end,eatEnd,fastMs,plannedFastMs,eatMs,endedEarly}=r;
  let phase="idle",pct=0;
  if(start&&now<end){phase="fast";pct=(now-start)/plannedFastMs*100}
  else if(start&&now<eatEnd){phase="eat";pct=(now-end)/eatMs*100}
  else if(start){phase="over"}
  return{phase,start,end,eatEnd,fastMs,plannedFastMs,eatMs,pct,endedEarly,actualFastMs:start&&end?end-start:0};
}

function cycleEventTimes(fastStart,mode,fastEnd){
  const r=resolveCycle(fastStart,mode,fastEnd);
  if(!r.start||!r.end||!r.eatEnd)return null;
  return{open:r.end.getTime(),close:r.eatEnd.getTime(),actualFastMs:r.fastMs,plannedFastMs:r.plannedFastMs,eatMs:r.eatMs,endedEarly:r.endedEarly};
}

const actionLabel=phase=>phase==="fast"?"Завершить голодание":"Начать голодание";
const closeNotificationBody=()=>"Запустите новое голодание, когда будете готовы.";

function readState(){
  try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}")||{}}catch(e){return{}}
}
function writeState(s){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(s));return true}catch(e){return false}
}

async function rescheduleFromEarlyEnd(state){
  if(typeof navigator==="undefined"||!("serviceWorker"in navigator))return;
  if(typeof Notification==="undefined"||Notification.permission!=="granted"||!state.notify)return;
  const times=cycleEventTimes(state.fastStart,state.mode,state.fastEnd);
  if(!times)return;
  try{
    const reg=await navigator.serviceWorker.ready;
    const old=await reg.getNotifications({includeTriggered:true}).catch(()=>[]);
    old.forEach(n=>{if((n.tag||"").startsWith("fw-"))n.close()});
    if(!("showTrigger"in Notification.prototype))return;
    const events=[
      {k:"close1h",at:times.close-36e5,t:"Через час окно закроется",b:"Окно питания закрывается через час."},
      {k:"close",at:times.close,t:"Окно питания закрыто",b:closeNotificationBody()}
    ];
    for(const e of events){
      if(e.at<=Date.now())continue;
      await reg.showNotification(e.t,{body:e.b,tag:"fw-"+e.k,icon:"icon.svg",badge:"icon.svg",showTrigger:new TimestampTrigger(e.at)});
    }
  }catch(e){}
}

function finishEarly(){
  const state=readState();
  if(!state.fastStart)return false;
  const now=new Date(),start=new Date(state.fastStart),nominal=new Date(start.getTime()+ +state.mode*36e5);
  if(!Number.isFinite(start.getTime())||now<=start||now>=nominal)return false;
  state.fastEnd=now.toISOString();
  state.fired={};
  state.icsStale=true;
  if(!writeState(state))return false;
  rescheduleFromEarlyEnd(state);
  return true;
}

function startFreshCycle(){
  const state=readState(),now=new Date();
  state.fastStart=now.toISOString();
  delete state.fastEnd;
  state.fired={};
  state.icsStale=true;
  try{
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||"";
    state.fastTz=zone;
    state.fastTzOff=-now.getTimezoneOffset()/60;
  }catch(e){delete state.fastTz;delete state.fastTzOff}
  return writeState(state);
}

function clearEarlyEnd(){
  const state=readState();
  if(!state.fastEnd)return;
  delete state.fastEnd;
  writeState(state);
}

const icsStamp=ms=>new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
function patchActiveIcs(text,state){
  const times=cycleEventTimes(state.fastStart,state.mode,state.fastEnd);
  if(!times||!times.endedEarly)return text;
  const keep=times.close>Date.now();
  return String(text).replace(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT\r?\n?/g,block=>{
    const isOpen=block.includes("UID:fw-active-open@fuelwindow");
    const isClose=block.includes("UID:fw-active-close@fuelwindow");
    if(!isOpen&&!isClose)return block;
    if(!keep)return "";
    const at=isOpen?times.open:times.close;
    const end=at+15*60e3;
    let out=block.replace(/DTSTART:\d{8}T\d{6}Z/,"DTSTART:"+icsStamp(at))
      .replace(/DTEND:\d{8}T\d{6}Z/,"DTEND:"+icsStamp(end));
    if(isOpen)out=out.replace(/Окно питания открыто, голодание \d+ ч завершено/g,"Окно питания открыто, голодание завершено");
    if(isClose)out=out.replace(/Окно питания закрыто, начинается голодание \d+ ч/g,"Окно питания закрыто, запустите новое голодание");
    return out;
  });
}

function installBrowserGuards(){
  if(typeof window==="undefined"||typeof document==="undefined")return;

  try{
    const proto=Storage.prototype,original=proto.setItem;
    if(!proto.__fuelFastEndMerge){
      Object.defineProperty(proto,"__fuelFastEndMerge",{value:true});
      proto.setItem=function(key,value){
        if(key===STORE_KEY){
          try{
            const incoming=JSON.parse(value),current=JSON.parse(this.getItem(key)||"{}");
            if(current&&current.fastEnd&&incoming&&incoming.fastStart===current.fastStart&&!incoming.fastEnd)incoming.fastEnd=current.fastEnd;
            value=JSON.stringify(incoming);
          }catch(e){}
        }
        return original.call(this,key,value);
      };
    }
  }catch(e){}

  const fixButton=()=>{
    const b=document.querySelector("#fastBtn");
    if(b&&(b.textContent==="Завершить"||b.textContent==="Отменить голодание"))b.textContent="Завершить голодание";
  };

  document.addEventListener("click",e=>{
    const b=e.target&&e.target.closest&&e.target.closest("#fastBtn");
    if(!b)return;
    const state=readState();
    const r=computeFastState(state.fastStart,state.mode,new Date(),state.fastEnd);
    if(r.phase==="fast"){
      e.preventDefault();e.stopImmediatePropagation();
      if(finishEarly())setTimeout(()=>location.reload(),40);
      return;
    }
    /* После досрочного завершения старый index.html всё ещё сравнивает now
       с nominalEnd и может принять кнопку «Начать» за отмену старого fast.
       Здесь новый цикл запускается явно и атомарно. */
    if(state.fastEnd&&(r.phase==="eat"||r.phase==="over")){
      e.preventDefault();e.stopImmediatePropagation();
      if(startFreshCycle())setTimeout(()=>location.reload(),40);
      return;
    }
    clearEarlyEnd();
  },true);

  document.addEventListener("click",e=>{
    if(e.target&&e.target.closest&&e.target.closest("#applyStart"))clearEarlyEnd();
  },true);

  document.addEventListener("DOMContentLoaded",()=>{
    fixButton();
    const b=document.querySelector("#fastBtn");
    if(b&&typeof MutationObserver!=="undefined")new MutationObserver(fixButton).observe(b,{childList:true,subtree:true,characterData:true});
    const ver=document.querySelector("#ver");if(ver)ver.textContent="v31";
    const hdr=document.querySelector(".hdr");if(hdr)hdr.style.borderBottom="none";
    const fat=document.querySelector("#fat");if(fat)fat.removeAttribute("placeholder");
    const weight=document.querySelector("#weight");if(weight)weight.removeAttribute("placeholder");

    /* Fallback-уведомления старого index.html тоже должны считать от
       фактического fastEnd, иначе после раннего завершения они приходили в
       исходно запланированный момент. */
    if(typeof window.fastEvents==="function"){
      window.fastEvents=function(){
        const state=readState(),times=cycleEventTimes(state.fastStart,state.mode,state.fastEnd);
        if(!times)return[];
        const at=ms=>new Date(ms).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
        const actual=Math.max(0,Math.round(times.actualFastMs/36e5*10)/10);
        return[
          {k:"open1h",at:times.open-36e5,t:"Через час — окно питания",b:"Окно питания откроется в "+at(times.open)+"."},
          {k:"open",at:times.open,t:"Окно питания открыто",b:"Голодание "+actual+" ч завершено. Окно закроется в "+at(times.close)+"."},
          {k:"close1h",at:times.close-36e5,t:"Через час окно закроется",b:"Окно питания закрывается в "+at(times.close)+"."},
          {k:"close",at:times.close,t:"Окно питания закрыто",b:closeNotificationBody()}
        ];
      };
    }

    /* Календарный экспорт строится старым кодом, затем только активная пара
       событий сдвигается на фактические open/close. Roster-события не
       трогаются. Если фактическое окно уже закрыто, активная пара удаляется. */
    if(typeof window.buildIcs==="function"&&!window.buildIcs.__fuelEarlyEndPatched){
      const originalBuild=window.buildIcs;
      const patched=function(){return patchActiveIcs(originalBuild(),readState())};
      patched.__fuelEarlyEndPatched=true;
      window.buildIcs=patched;
    }

    if(typeof window.drawFast==="function")window.drawFast();
  });

  const SR=window.ServiceWorkerRegistration,p=SR&&SR.prototype;
  if(p&&typeof p.showNotification==="function"&&!p.__fuelWindowCloseCopyPatched){
    const original=p.showNotification;
    Object.defineProperty(p,"__fuelWindowCloseCopyPatched",{value:true});
    p.showNotification=function(title,options){
      if(title==="Окно питания закрыто")options=Object.assign({},options,{body:closeNotificationBody()});
      return original.call(this,title,options);
    };
  }
}

const Timer={dur,computeFastState,resolveCycle,cycleEventTimes,actionLabel,closeNotificationBody,validEarlyEnd,patchActiveIcs};
if(typeof module!=="undefined"&&module.exports)module.exports=Timer;
else{window.Timer=Timer;installBrowserGuards()}
})();
