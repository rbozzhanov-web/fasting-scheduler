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

function loadEscrewRoster(storage){
  try{const raw=(storage||localStorage).getItem(KEY);return raw?JSON.parse(raw):null}catch(e){return null}
}

const EscrewBridge={KEY,daysFromEscrew,loadEscrewRoster};
if(typeof module!=="undefined"&&module.exports)module.exports=EscrewBridge;else window.EscrewBridge=EscrewBridge;
})();
