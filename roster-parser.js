(function(){
const DUTY_CODE_WORDS=new Set(["OFF","DOFF","ROFF","HOMS","HOMX","AVLB","VAC","CSH","MED"]);

/* ---------- чистая логика, без PDF/DOM — тестируется напрямую ---------- */

function extractPeriod(headText){
  const range=headText.match(/(\d{2})\/(\d{2})\/(20\d{2})\s*-\s*(\d{2})\/(\d{2})\/(20\d{2})/);
  if(!range)throw new Error("Не найден период отчёта");
  const[,sd,sm,sy,ed,em,ey]=range;
  return{sd,sm,sy,ed,em,ey,start:`${sy}-${sm}-${sd}`,end:`${ey}-${em}-${ed}`};
}

const computePeriodDays=(start,end)=>Math.max(1,Math.round((new Date(end)-new Date(start))/864e5)+1);

/* Явно неполный результат не должен читаться как успех: если из
   заявленного в шапке периода распознано меньше половины дней, это
   ошибка, а не частичный успех с warnings. */
const isCompleteEnough=(recognizedCount,periodDays)=>recognizedCount/periodDays>=0.5;

/* Дата колонки по её токену "ДД/ММ" плюс перенос года из шапки периода;
   null, если получившаяся дата вне заявленного периода. */
function columnDate(dateToken,sm,sy,ey,start,end){
  const cm=dateToken.slice(3),cy=(+cm>=+sm)?sy:ey,date=`${cy}-${cm}-${dateToken.slice(0,2)}`;
  return(date<start||date>end)?null:date;
}

/* Разбор текста одной колонки duty в объект дня. knownAirports — словарь
   вида {IATA: taimzone}, передаётся снаружи (в браузере — Circadian.Z),
   чтобы эта функция не зависела от глобальных объектов. */
function parseDutyText(text,knownAirports){
  const code=(text.replace(/\[\d+\]/g,"").match(/\b(OFF|DOFF|ROFF|HOMS|HOMX|AVLB|VAC|CSH|MED\d+|\d{3,4}A?)\b/i)||["","Duty"])[1].toUpperCase();
  const times=[...text.matchAll(/\b([01]\d|2[0-3]):[0-5]\d\b/g)].map(m=>m[0]);
  const airports=[...text.matchAll(new RegExp("\\b("+Object.keys(knownAirports).join("|")+")\\b","g"))].map(m=>m[1]);
  const rest=/OFF|DOFF|ROFF|HOMS|HOMX|AVLB|VAC|CSH|MED/.test(code);
  const report=times[0]||null,release=times.at(-1)||null;
  const rh=report?+report.slice(0,2):null;
  const kind=rest?"rest":rh!=null&&(rh>=18||rh<=5)?"night":rh!=null&&rh<=8?"early":"duty";
  /* Неизвестные аэропорты: общий шаблон 3-4 заглавные буквы, за вычетом
     уже известных кодов и словаря duty-кодов — не заменяет белый список
     airports[], а только сигналит о том, чего в нём нет. */
  const unknownAirports=[...new Set([...text.matchAll(/\b[A-Z]{3,4}\b/g)].map(m=>m[0])
    .filter(t=>!knownAirports[t]&&!DUTY_CODE_WORDS.has(t)&&t!==code))];
  return{code,times,airports,kind,report,release,detail:text.slice(0,350),rest,unknownAirports};
}

/* Технические warnings по уже собранным дням: отсутствие report time у
   duty, дубликаты/нарушение порядка дат, неизвестные аэропорты. */
function collectWarnings(days){
  const warnings=[],seenAirports=new Set();
  let lastDate=null;
  for(const d of days){
    if(!d.rest&&!d.report)warnings.push({date:d.date,code:"no_report_time"});
    if(lastDate!==null){
      if(d.date===lastDate)warnings.push({date:d.date,code:"duplicate_date"});
      else if(d.date<lastDate)warnings.push({date:d.date,code:"out_of_sequence"});
    }
    lastDate=d.date;
    for(const code of d.unknownAirports||[]){
      if(!seenAirports.has(code)){seenAirports.add(code);warnings.push({date:d.date,code:"unknown_airport",value:code})}
    }
  }
  return warnings;
}

/* ---------- склейка с PDF (vendor/pdf.mjs) — вне тестового покрытия ---------- */

async function parse(file){
  const p=await import("./vendor/pdf.mjs");
  p.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
  const pdf=await p.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const page=await pdf.getPage(1);
  const c=await page.getTextContent();
  const a=c.items.map(i=>({t:i.str.trim(),x:i.transform[4],y:i.transform[5]})).filter(i=>i.t);
  const head=a.map(i=>i.t).join(" ");
  const{sm,sy,ey,start,end}=extractPeriod(head);
  const ds=a.filter(i=>/^\d{2}\/\d{2}$/.test(i.t));
  const bins={};
  ds.forEach(i=>{const k=Math.round(i.y/3)*3;(bins[k]??=[]).push(i)});
  const row=(Object.values(bins).sort((x,y)=>y.length-x.length)[0]||[]).sort((x,y)=>x.x-y.x);
  if(row.length<20)throw new Error("Не найдена строка дат Air Astana");
  const hy=row[0].y;
  const cols=row.map((d,n)=>({d:d.t,l:n?(row[n-1].x+d.x)/2:-Infinity,r:n<row.length-1?(d.x+row[n+1].x)/2:Infinity}));
  const periodDays=computePeriodDays(start,end);

  const days=cols.map(col=>{
    const date=columnDate(col.d,sm,sy,ey,start,end);
    if(!date)return null;
    const lines=a.filter(i=>i.x>=col.l&&i.x<col.r&&i.y<hy-10&&i.y>hy-300).sort((u,v)=>v.y-u.y).map(i=>i.t);
    const parsed=parseDutyText(lines.join(" "),window.Circadian.Z);
    return Object.assign({date},parsed);
  }).filter(Boolean);

  if(!isCompleteEnough(days.length,periodDays))throw new Error("Разобрано слишком мало дней: "+days.length+" из "+periodDays+" за период");

  const warnings=collectWarnings(days);
  days.forEach(d=>{delete d.rest;delete d.unknownAirports});
  return{days,warnings};
}

const FuelParser={parse,extractPeriod,computePeriodDays,isCompleteEnough,columnDate,parseDutyText,collectWarnings};
if(typeof module!=="undefined"&&module.exports)module.exports=FuelParser;else window.FuelParser=FuelParser;
})();
