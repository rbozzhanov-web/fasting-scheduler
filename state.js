(function(){
/* Чистая логика нормализации состояния и валидации backup — вынесена из
   index.html, чтобы быть доступной и странице (через window), и тестам
   (через require()). Без обращения к localStorage/DOM: index.html сам
   решает, откуда читать и куда писать, эти функции только проверяют и
   приводят данные к ожидаемой форме. */
const MODES=["12","14","16","18"],CONTEXTS=["auto","training","recovery"],GOALS=["fat","keep"];
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

const isRealDate=v=>{
  if(typeof v!=="string"||!DATE_RE.test(v))return false;
  const t=Date.parse(v+"T00:00:00Z");
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;
};

const isValidDay=d=>!!d&&typeof d==="object"&&isRealDate(d.date)&&typeof d.code==="string"
  &&["rest","duty","early","night"].includes(d.kind)
  &&Array.isArray(d.times)&&d.times.every(t=>typeof t==="string")
  &&Array.isArray(d.airports)&&d.airports.every(a=>typeof a==="string")
  &&(d.report===null||typeof d.report==="string")&&(d.release===null||typeof d.release==="string");

const isValidMetric=m=>!!m&&typeof m==="object"&&typeof m.date==="string"&&!isNaN(Date.parse(m.date))
  &&Number.isFinite(m.fat)&&m.fat>=3&&m.fat<=70
  &&(m.weight==null||(Number.isFinite(m.weight)&&m.weight>=30&&m.weight<=250));

/* fastEnd — исторический факт завершения текущего цикла. Он не должен
   становиться невалидным только потому, что пользователь потом поменял
   режим. Ограничиваем его сутками от старта: это покрывает все режимы и
   отсекает повреждённые/чужие даты. */
const validFastEnd=(start,mode,end)=>{
  if(start==null||end==null)return false;
  const a=new Date(start),b=new Date(end);
  if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))return false;
  return b.getTime()>=a.getTime()&&b.getTime()<=a.getTime()+864e5;
};

function normalizeState(raw){
  let s,corrupted=false;
  try{
    s=JSON.parse(raw||"{}");
    if(!s||typeof s!=="object"||Array.isArray(s))throw new Error("bad shape");
  }catch(e){
    s={};
    corrupted=true;
  }
  s.mode=MODES.includes(s.mode)?s.mode:"16";
  s.context=CONTEXTS.includes(s.context)?s.context:"auto";
  s.goal=GOALS.includes(s.goal)?s.goal:"fat";
  s.days=Array.isArray(s.days)?s.days.filter(isValidDay):[];
  s.metrics=Array.isArray(s.metrics)?s.metrics.filter(isValidMetric):[];
  s.bf=Object.assign({on:true,from:"06:30",to:"10:00"},(s.bf&&typeof s.bf==="object"&&!Array.isArray(s.bf))?s.bf:{});
  s.notify=!!s.notify;
  s.fired=(s.fired&&typeof s.fired==="object"&&!Array.isArray(s.fired))?s.fired:{};
  s.parserWarnings=Array.isArray(s.parserWarnings)?s.parserWarnings:[];
  if(s.date!=null&&!isRealDate(s.date))delete s.date;
  if(s.fastStart!=null&&isNaN(new Date(s.fastStart)))delete s.fastStart;
  if(s.fastEnd!=null&&!validFastEnd(s.fastStart,s.mode,s.fastEnd))delete s.fastEnd;
  return{state:s,corrupted};
}

function validateBackup(d){
  if(!d||typeof d!=="object")throw new Error("файл повреждён");
  if(d.app!=="fuel-window")throw new Error("это не копия Fuel Window");
  if(d.v!==1)throw new Error("неподдерживаемая версия резервной копии");
  const st=d.state;
  if(!st||typeof st!=="object")throw new Error("отсутствуют данные состояния");
  if(!MODES.includes(st.mode))throw new Error("некорректный режим голодания");
  if(!CONTEXTS.includes(st.context))throw new Error("некорректный контекст");
  if(!GOALS.includes(st.goal))throw new Error("некорректная цель");
  if(!Array.isArray(st.days)||!st.days.every(isValidDay))throw new Error("повреждён ростер в копии");
  if(!Array.isArray(st.metrics)||!st.metrics.every(isValidMetric))throw new Error("повреждены замеры в копии");
  if(st.fastStart!=null&&isNaN(new Date(st.fastStart)))throw new Error("некорректное начало голодания");
  if(st.fastEnd!=null&&!validFastEnd(st.fastStart,st.mode,st.fastEnd))throw new Error("некорректное окончание голодания");
}

/* Локальная календарная дата устройства, без UTC-сдвига. Она нужна для
   автоматического выбора сегодняшнего roster-дня: toISOString() около
   полуночи в некоторых поясах даёт соседнюю дату. */
const localDay=d=>{
  d=d||new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
};

/* Выбираем сегодняшний roster через уже существующую кнопку дня. Так
   index.html сам обновляет s.date, сбрасывает ручной context в auto,
   сохраняет state и перерисовывает карточку — второго источника состояния
   здесь не появляется. Ручной просмотр другого дня в течение тех же суток
   не сбрасываем; автопереход срабатывает один раз при запуске/импорте и
   снова только после смены календарной даты. */
function installRosterTodaySync(){
  if(typeof document==="undefined")return;
  let seenDay=null,syncedDay=null,timer=null,observer=null;
  const sync=force=>{
    const t=localDay(),changed=seenDay!==null&&seenDay!==t;
    seenDay=t;
    if(!force&&!changed&&syncedDay===t)return false;
    const button=[...document.querySelectorAll("#days [data-d]")].find(b=>b.dataset.d===t);
    if(!button)return false;
    if(!button.classList.contains("on"))button.click();
    syncedDay=t;
    return true;
  };
  const start=()=>{
    setTimeout(()=>sync(true),0);
    const days=document.querySelector("#days");
    if(days&&typeof MutationObserver!=="undefined"){
      observer=new MutationObserver(()=>{if(syncedDay!==localDay())sync(false)});
      observer.observe(days,{childList:true});
    }
    timer=setInterval(()=>sync(false),30000);
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)sync(false)});
  return()=>{if(timer)clearInterval(timer);if(observer)observer.disconnect()};
}

const State={MODES,CONTEXTS,GOALS,DATE_RE,isRealDate,isValidDay,isValidMetric,validFastEnd,normalizeState,validateBackup,localDay};
if(typeof module!=="undefined"&&module.exports)module.exports=State;else{window.State=State;installRosterTodaySync()}
})();
