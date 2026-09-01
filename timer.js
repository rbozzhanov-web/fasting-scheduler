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

/* В браузере index.html пока передаёт только fastStart/mode/now. Читаем
   сохранённый fastEnd как дополнительный факт цикла. В тестах и в будущей
   версии index.html его можно передать четвёртым аргументом напрямую. */
function storedEarlyEnd(fastStart){
  if(typeof localStorage==="undefined"||!fastStart)return null;
  try{
    const d=JSON.parse(localStorage.getItem(STORE_KEY)||"{}");
    return d&&d.fastStart===fastStart?d.fastEnd:null;
  }catch(e){return null}
}

function computeFastState(fastStart,mode,now,fastEnd){
  now=now||new Date();
  const start=fastStart?new Date(fastStart):null;
  const plannedFastMs=+mode*36e5,eatMs=(24-+mode)*36e5;
  const nominalEnd=start?new Date(start.getTime()+plannedFastMs):null;
  const early=start?validEarlyEnd(start,nominalEnd,fastEnd||storedEarlyEnd(fastStart)):null;
  const end=early||nominalEnd;
  const fastMs=start&&end?end-start:plannedFastMs;
  const eatEnd=end?new Date(end.getTime()+eatMs):null;
  let phase="idle",pct=0;
  if(start&&now<end){phase="fast";pct=(now-start)/plannedFastMs*100}
  else if(start&&now<eatEnd){phase="eat";pct=(now-end)/eatMs*100}
  else if(start){phase="over"}
  return{phase,start,end,eatEnd,fastMs,plannedFastMs,eatMs,pct,endedEarly:!!early,actualFastMs:start&&end?end-start:0};
}

const actionLabel=phase=>phase==="fast"?"Завершить голодание":"Начать голодание";
const closeNotificationBody=()=>"Запустите новое голодание, когда будете готовы.";

function readState(){
  try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}")||{}}catch(e){return{}}
}
function writeState(s){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(s));return true}catch(e){return false}
}

/* Пересоздаём уведомления от фактического окончания. Это важно: после
   досрочного завершения старые уведомления на плановое открытие окна уже
   неверны. */
async function rescheduleFromEarlyEnd(state){
  if(typeof navigator==="undefined"||!("serviceWorker"in navigator))return;
  if(typeof Notification==="undefined"||Notification.permission!=="granted"||!state.notify)return;
  const start=new Date(state.fastStart),end=new Date(state.fastEnd);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))return;
  const close=end.getTime()+(24-+state.mode)*36e5;
  try{
    const reg=await navigator.serviceWorker.ready;
    const old=await reg.getNotifications({includeTriggered:true}).catch(()=>[]);
    old.forEach(n=>{if((n.tag||"").startsWith("fw-"))n.close()});
    if(!("showTrigger"in Notification.prototype))return;
    const events=[
      {k:"close1h",at:close-36e5,t:"Через час окно закроется",b:"Окно питания закрывается через час."},
      {k:"close",at:close,t:"Окно питания закрыто",b:closeNotificationBody()}
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

function clearEarlyEnd(){
  const state=readState();
  if(!state.fastEnd)return;
  delete state.fastEnd;
  writeState(state);
}

function installBrowserGuards(){
  if(typeof window==="undefined"||typeof document==="undefined")return;

  /* Сохраняем fastEnd при последующих save() старого index.html, который
     ещё не знает об этом поле и иначе затёр бы его следующим изменением. */
  try{
    const proto=Storage.prototype,original=proto.setItem;
    if(!proto.__fuelFastEndMerge){
      Object.defineProperty(proto,"__fuelFastEndMerge",{value:true});
      proto.setItem=function(key,value){
        if(key===STORE_KEY){
          try{
            const incoming=JSON.parse(value),current=JSON.parse(original.call?this.getItem(key):null||"{}");
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
      if(finishEarly()){
        /* Сам index обновит экран на ближайшем секундном тике; перезагрузка
           синхронизирует его in-memory state и делает fastEnd частью backup. */
        setTimeout(()=>location.reload(),40);
      }
    }else{
      /* Новый цикл не должен унаследовать окончание предыдущего. */
      clearEarlyEnd();
    }
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
  });

  /* Любое закрывающее уведомление формулируем в соответствии с реальной
     моделью: следующий fast запускается вручную. */
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

const Timer={dur,computeFastState,actionLabel,closeNotificationBody,validEarlyEnd};
if(typeof module!=="undefined"&&module.exports)module.exports=Timer;
else{window.Timer=Timer;installBrowserGuards()}
})();
