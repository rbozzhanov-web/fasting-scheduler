(function(){
/* Чистая логика фаз таймера голодания. fastStart хранит реальное начало,
   fastEnd — фактическое завершение пользователем. После его записи смена
   режима не должна переписывать прошлое время окончания. */
const dur=ms=>[ms/36e5,ms/6e4%60,ms/1e3%60].map(x=>String(Math.max(0,Math.floor(x))).padStart(2,"0")).join(":");
const STORE_KEY="fuel-v4";

const validEarlyEnd=(start,nominalEnd,value)=>{
  if(!start||!value)return null;
  const d=new Date(value);
  return Number.isFinite(d.getTime())&&d>=start&&d<=nominalEnd?d:null;
};
const validActualEnd=(start,value)=>{
  if(!start||!value)return null;
  const d=new Date(value);
  return Number.isFinite(d.getTime())&&d>=start&&d<=new Date(start.getTime()+864e5)?d:null;
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
  const actual=start?validActualEnd(start,fastEnd||storedEarlyEnd(fastStart)):null;
  const end=actual||nominalEnd;
  const fastMs=start&&end?end-start:plannedFastMs;
  const eatEnd=end?new Date(end.getTime()+eatMs):null;
  return{start,end,eatEnd,fastMs,plannedFastMs,eatMs,hasActualEnd:!!actual,endedEarly:!!actual&&actual<nominalEnd};
}

function computeFastState(fastStart,mode,now,fastEnd){
  now=now||new Date();
  const r=resolveCycle(fastStart,mode,fastEnd);
  const{start,end,eatEnd,fastMs,plannedFastMs,eatMs,endedEarly,hasActualEnd}=r;
  let phase="idle",pct=0;
  if(start&&now<end){phase="fast";pct=(now-start)/plannedFastMs*100}
  else if(start&&now<eatEnd){phase="eat";pct=(now-end)/eatMs*100}
  else if(start){phase="over"}
  return{phase,start,end,eatEnd,fastMs,plannedFastMs,eatMs,pct,endedEarly,hasActualEnd,actualFastMs:start&&end?end-start:0};
}

function cycleEventTimes(fastStart,mode,fastEnd){
  const r=resolveCycle(fastStart,mode,fastEnd);
  if(!r.start||!r.end||!r.eatEnd)return null;
  return{open:r.end.getTime(),close:r.eatEnd.getTime(),actualFastMs:r.fastMs,plannedFastMs:r.plannedFastMs,eatMs:r.eatMs,endedEarly:r.endedEarly,hasActualEnd:r.hasActualEnd};
}

const actionLabel=phase=>phase==="fast"?"Завершить голодание":"Начать голодание";
const closeNotificationBody=()=>"Запустите новое голодание, когда будете готовы.";

function readState(){
  try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}")||{}}catch(e){return{}}
}
function writeState(s){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(s));return true}catch(e){return false}
}
function stampCurrentZone(state,now){
  try{
    state.fastTz=Intl.DateTimeFormat().resolvedOptions().timeZone||"";
    state.fastTzOff=-now.getTimezoneOffset()/60;
  }catch(e){delete state.fastTz;delete state.fastTzOff}
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
  if(!Number.isFinite(start.getTime())||!validEarlyEnd(start,nominal,now))return false;
  state.fastEnd=now.toISOString();
  state.fired={};
  state.icsStale=true;
  if(!writeState(state))return false;
  rescheduleFromEarlyEnd(state);
  return true;
}

function startFreshCycle(at){
  const state=readState(),now=new Date(),requested=at?new Date(at):now;
  if(!Number.isFinite(requested.getTime()))return false;
  const start=requested>now?now:requested;
  state.fastStart=start.toISOString();
  delete state.fastEnd;
  state.fired={};
  state.icsStale=true;
  stampCurrentZone(state,now);
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
  if(!times||!times.hasActualEnd)return text;
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

function installGoalControl(){
  const select=document.querySelector("#goal");
  if(!select||document.querySelector("#goalSeg"))return;
  const row=select.closest(".row")||select.parentElement;
  const label=row&&row.querySelector(".rl");
  const hint=label&&label.querySelector("small");

  /* Старый select остаётся источником истины для существующего index.js.
     Визуально прячем его, но не удаляем: обработчик onchange продолжает
     выполнять все пересчёты roster/ICS без дублирования бизнес-логики. */
  Object.assign(select.style,{position:"absolute",opacity:"0",pointerEvents:"none",width:"1px",height:"1px",minWidth:"1px",padding:"0",border:"0"});
  select.setAttribute("aria-hidden","true");
  select.tabIndex=-1;

  const seg=document.createElement("div");
  seg.id="goalSeg";
  seg.className="goal-seg";
  seg.setAttribute("role","group");
  seg.setAttribute("aria-label","Цель питания");
  seg.innerHTML='<button type="button" data-goal="fat">Снижение</button><button type="button" data-goal="keep">Поддержание</button>';
  select.insertAdjacentElement("afterend",seg);

  const style=document.createElement("style");
  style.textContent=`
    .goal-seg{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:0;width:100%;padding:4px;border-radius:22px;background:var(--sunken);border:1px solid var(--sunken-line);box-shadow:0 1px 0 rgba(255,255,255,.05) inset;overflow:hidden}
    .goal-seg::before{content:"";position:absolute;z-index:0;top:4px;bottom:4px;left:4px;width:calc((100% - 8px)/2);border-radius:18px;background-color:var(--glass-control);background-image:var(--glass-spec);box-shadow:var(--glass-control-shadow);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
    .goal-seg.keep::before{transform:translateX(100%)}
    .goal-seg button{position:relative;z-index:1;min-width:0;height:42px;border:0;border-radius:18px;background:transparent!important;background-image:none!important;box-shadow:none!important;color:var(--dim);font-weight:650;font-size:14px;white-space:nowrap;padding:0 10px;transition:color .18s ease,transform .12s ease}
    .goal-seg button:active{transform:scale(.97)}
    .goal-seg button.on{color:var(--text)}
    .goal-row{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:12px!important;align-items:start!important}
    .goal-row .rl{width:100%;max-width:none}
    .goal-row .rl small{display:block;max-width:34em;line-height:1.4;margin-top:4px;min-height:2.8em}
    .goal-row .goal-seg{justify-self:stretch;width:100%;max-width:none}
    @media(max-width:430px){
      .sheet-body{padding-left:16px!important;padding-right:16px!important}
      .sheet .card{padding:14px!important}
      .sheet .row>*{min-width:0}
      .goal-seg button{font-size:13.5px;padding-inline:8px}
    }
  `;
  document.head.appendChild(style);
  if(row)row.classList.add("goal-row");

  const render=()=>{
    const value=select.value||readState().goal||"fat";
    seg.classList.toggle("keep",value==="keep");
    seg.querySelectorAll("button").forEach(b=>{
      const on=b.dataset.goal===value;
      b.classList.toggle("on",on);
      b.setAttribute("aria-pressed",on?"true":"false");
    });
    if(hint)hint.textContent=value==="fat"
      ?"Окно питания по возможности закрывается не позже 21:00."
      :"Без жёсткого ограничения на закрытие окна в 21:00.";
  };

  seg.addEventListener("click",e=>{
    const b=e.target.closest("[data-goal]");if(!b)return;
    if(select.value===b.dataset.goal){render();return}
    select.value=b.dataset.goal;
    select.dispatchEvent(new Event("change",{bubbles:true}));
    render();
  });
  select.addEventListener("change",render);
  render();
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
    if(state.fastEnd&&(r.phase==="eat"||r.phase==="over")){
      e.preventDefault();e.stopImmediatePropagation();
      if(startFreshCycle())setTimeout(()=>location.reload(),40);
      return;
    }
    clearEarlyEnd();
  },true);

  /* Ручное новое начало выполняем сами, а не сначала удаляем fastEnd из
     localStorage: старый index.html держит свою копию state в памяти и мог
     тут же записать прежний fastEnd обратно уже с новым fastStart. */
  document.addEventListener("click",e=>{
    const b=e.target&&e.target.closest&&e.target.closest("#applyStart");
    if(!b)return;
    const input=document.querySelector("#startAt"),value=input&&input.value;
    if(!value)return;
    const requested=new Date(value);
    if(!Number.isFinite(requested.getTime()))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(startFreshCycle(requested))setTimeout(()=>location.reload(),40);
  },true);

  document.addEventListener("DOMContentLoaded",()=>{
    fixButton();
    const b=document.querySelector("#fastBtn");
    if(b&&typeof MutationObserver!=="undefined")new MutationObserver(fixButton).observe(b,{childList:true,subtree:true,characterData:true});
    const ver=document.querySelector("#ver");if(ver)ver.textContent="v31";
    const hdr=document.querySelector(".hdr");if(hdr)hdr.style.borderBottom="none";
    const fat=document.querySelector("#fat");if(fat)fat.removeAttribute("placeholder");
    const weight=document.querySelector("#weight");if(weight)weight.removeAttribute("placeholder");
    installGoalControl();

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

    if(typeof window.buildIcs==="function"&&!window.buildIcs.__fuelEarlyEndPatched){
      const originalBuild=window.buildIcs;
      const patched=function(){return patchActiveIcs(originalBuild(),readState())};
      patched.__fuelEarlyEndPatched=true;
      window.buildIcs=patched;
    }

    /* После зафиксированного окончания подпись шкалы показывает фактическую
       длительность, а не прежнюю цель режима. */
    if(typeof window.drawFast==="function"&&!window.drawFast.__fuelActualLabelPatched){
      const originalDraw=window.drawFast;
      const patchedDraw=function(){
        originalDraw();
        const state=readState(),r=computeFastState(state.fastStart,state.mode,new Date(),state.fastEnd);
        if(r.hasActualEnd){
          const label=document.querySelector("#labFast");
          if(label){const h=Math.round(r.actualFastMs/36e5*10)/10;label.textContent="Голодание "+h+" ч";}
        }
      };
      patchedDraw.__fuelActualLabelPatched=true;
      window.drawFast=patchedDraw;
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

const Timer={dur,computeFastState,resolveCycle,cycleEventTimes,actionLabel,closeNotificationBody,validEarlyEnd,validActualEnd,patchActiveIcs};
if(typeof module!=="undefined"&&module.exports)module.exports=Timer;
else{window.Timer=Timer;installBrowserGuards()}
})();
