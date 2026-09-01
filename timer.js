(function(){
/* Чистая логика фаз таймера голодания, без обращения к DOM — вынесена
   из drawFast() в index.html, чтобы быть доступной и странице (через
   window), и тестам (через require()). */
const dur=ms=>[ms/36e5,ms/6e4%60,ms/1e3%60].map(x=>String(Math.floor(x)).padStart(2,"0")).join(":");

function computeFastState(fastStart,mode,now){
  now=now||new Date();
  const start=fastStart?new Date(fastStart):null;
  const fastMs=+mode*36e5,eatMs=(24-+mode)*36e5;
  const end=start?new Date(start.getTime()+fastMs):null;
  const eatEnd=end?new Date(end.getTime()+eatMs):null;
  let phase="idle",pct=0;
  if(start&&now<end){phase="fast";pct=(now-start)/fastMs*100}
  else if(start&&now<eatEnd){phase="eat";pct=(now-end)/eatMs*100}
  else if(start){phase="over"}
  return{phase,start,end,eatEnd,fastMs,eatMs,pct};
}

/* В текущей модели нажатие основной кнопки во время fast удаляет fastStart,
   то есть именно отменяет текущий цикл. Не называем это «Завершить», чтобы
   пользователь не ожидал автоматического открытия окна питания. */
const actionLabel=phase=>phase==="fast"?"Отменить голодание":"Начать голодание";

/* Закрытие окна не запускает следующий fast автоматически: после 24-часового
   цикла состояние становится over. Поэтому уведомление не должно утверждать,
   что новый цикл уже идёт. */
const closeNotificationBody=body=>/^Начинается голодание \d+ ч\.$/.test(body||"")
  ?"Запустите новое голодание, когда будете готовы."
  :body;

/* index.html остаётся единственным владельцем состояния. Этот небольшой
   браузерный адаптер только синхронизирует формулировки с реальным поведением,
   не меняя расчёты и сохранённые данные. */
function installBrowserGuards(){
  if(typeof window==="undefined"||typeof document==="undefined")return;

  const fixButton=()=>{
    const b=document.querySelector("#fastBtn");
    if(b&&b.textContent==="Завершить")b.textContent=actionLabel("fast");
  };
  document.addEventListener("DOMContentLoaded",()=>{
    fixButton();
    const b=document.querySelector("#fastBtn");
    if(b&&typeof MutationObserver!=="undefined"){
      new MutationObserver(fixButton).observe(b,{childList:true,subtree:true,characterData:true});
    }
  });

  const SR=window.ServiceWorkerRegistration;
  const p=SR&&SR.prototype;
  if(p&&typeof p.showNotification==="function"&&!p.__fuelWindowCloseCopyPatched){
    const original=p.showNotification;
    Object.defineProperty(p,"__fuelWindowCloseCopyPatched",{value:true});
    p.showNotification=function(title,options){
      if(title==="Окно питания закрыто"&&options&&typeof options.body==="string"){
        options=Object.assign({},options,{body:closeNotificationBody(options.body)});
      }
      return original.call(this,title,options);
    };
  }
}

const Timer={dur,computeFastState,actionLabel,closeNotificationBody};
if(typeof module!=="undefined"&&module.exports)module.exports=Timer;
else{window.Timer=Timer;installBrowserGuards()}
})();
