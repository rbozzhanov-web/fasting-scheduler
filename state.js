(function(){
/* Чистая логика нормализации состояния и валидации backup — вынесена из
   index.html, чтобы быть доступной и странице (через window), и тестам
   (через require()). Без обращения к localStorage/DOM: index.html сам
   решает, откуда читать и куда писать, эти функции только проверяют и
   приводят данные к ожидаемой форме. */
const MODES=["12","14","16","18"],CONTEXTS=["auto","training","recovery"],GOALS=["fat","keep"];
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

const isValidDay=d=>!!d&&typeof d==="object"&&typeof d.date==="string"&&DATE_RE.test(d.date)&&typeof d.code==="string"
  &&["rest","duty","early","night"].includes(d.kind)
  &&Array.isArray(d.times)&&d.times.every(t=>typeof t==="string")
  &&Array.isArray(d.airports)&&d.airports.every(a=>typeof a==="string")
  &&(d.report===null||typeof d.report==="string")&&(d.release===null||typeof d.release==="string");

const isValidMetric=m=>!!m&&typeof m==="object"&&typeof m.date==="string"&&!isNaN(Date.parse(m.date))
  &&Number.isFinite(m.fat)&&m.fat>=3&&m.fat<=70
  &&(m.weight==null||(Number.isFinite(m.weight)&&m.weight>=30&&m.weight<=250));

/* Повреждённый JSON целиком -> сброс на дефолты, corrupted:true (вызывающий
   код решает, показывать ли одноразовое уведомление). Отдельные испорченные
   поля в валидном JSON нормализуются тихо, без флага. */
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
  if(s.fastStart!=null&&isNaN(new Date(s.fastStart)))delete s.fastStart;
  return{state:s,corrupted};
}

/* Backup — менее доверенный источник, чем случайно повреждённый
   localStorage: любое несоответствие отклоняет файл целиком, до
   какой-либо записи, а не чинит его по частям. Отсутствие более новых
   полей (например parserWarnings) не является причиной отказа. */
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
}

const State={MODES,CONTEXTS,GOALS,DATE_RE,isValidDay,isValidMetric,normalizeState,validateBackup};
if(typeof module!=="undefined"&&module.exports)module.exports=State;else window.State=State;
})();
