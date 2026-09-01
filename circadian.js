window.Circadian=(()=>{
const Z={
ALA:"Asia/Almaty",NQZ:"Asia/Almaty",TSE:"Asia/Almaty",AKX:"Asia/Aqtobe",GUW:"Asia/Atyrau",SCO:"Asia/Aqtau",URA:"Asia/Oral",UKK:"Asia/Almaty",KGF:"Asia/Almaty",KSN:"Asia/Almaty",PPK:"Asia/Almaty",PLX:"Asia/Almaty",CIT:"Asia/Almaty",
ICN:"Asia/Seoul",KIX:"Asia/Tokyo",NRT:"Asia/Tokyo",AYT:"Europe/Istanbul",IST:"Europe/Istanbul",FRA:"Europe/Berlin",MUC:"Europe/Berlin",AMS:"Europe/Amsterdam",LHR:"Europe/London",CDG:"Europe/Paris",FCO:"Europe/Rome",MXP:"Europe/Rome",PRG:"Europe/Prague",WAW:"Europe/Warsaw",BCN:"Europe/Madrid",ATH:"Europe/Athens",
CAN:"Asia/Shanghai",PEK:"Asia/Shanghai",PVG:"Asia/Shanghai",URC:"Asia/Urumqi",XIY:"Asia/Shanghai",HKT:"Asia/Bangkok",BKK:"Asia/Bangkok",KUL:"Asia/Kuala_Lumpur",SGN:"Asia/Ho_Chi_Minh",HAN:"Asia/Ho_Chi_Minh",
DXB:"Asia/Dubai",AUH:"Asia/Dubai",DOH:"Asia/Qatar",DEL:"Asia/Kolkata",BOM:"Asia/Kolkata",GOI:"Asia/Kolkata",MLE:"Indian/Maldives",CMB:"Asia/Colombo",
TBS:"Asia/Tbilisi",BAK:"Asia/Baku",TAS:"Asia/Tashkent",FRU:"Asia/Bishkek",DME:"Europe/Moscow",SVO:"Europe/Moscow",LED:"Europe/Moscow",
JED:"Asia/Riyadh",MED:"Asia/Riyadh",RUH:"Asia/Riyadh",TLV:"Asia/Jerusalem",CAI:"Africa/Cairo",SSH:"Africa/Cairo"
};
const home="ALA",clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const off=(zone,date)=>{const p=new Intl.DateTimeFormat("en-US",{timeZone:zone,timeZoneName:"shortOffset",hour:"2-digit"}).formatToParts(new Date(date+"T12:00:00Z")).find(x=>x.type==="timeZoneName")?.value||"GMT";const m=p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);return m?(m[1]==="-"?-1:1)*(+m[2]+(+m[3]||0)/60):0};
const dayDiff=(a,b)=>Math.max(0,Math.round((new Date(a+"T12:00")-new Date(b+"T12:00"))/864e5));
const move=(body,target,days)=>{const d=target-body;if(!d||!days)return body;const rate=d>0?1:1.5;return body+Math.sign(d)*Math.min(Math.abs(d),days*rate)};
function stateAt(day,days){
 const sorted=[...days].sort((a,b)=>a.date.localeCompare(b.date)),base=sorted[0]?.date||day.date;
 let station=home,bodyZone=off(Z[home],base),prev=base;
 for(const x of sorted){
  if(x.date>day.date)break;
  const gap=dayDiff(x.date,prev);
  if(gap)bodyZone=move(bodyZone,off(Z[station]||Z[home],x.date),gap);
  const next=x.airports?.at(-1);if(next&&Z[next])station=next;
  prev=x.date;
 }
 const zone=Z[station]||Z[home],local=off(zone,day.date),homeOff=off(Z[home],day.date);
 return{station,zone,local,homeOff,bodyZone,body:bodyZone-local,delta:local-homeOff,adapted:bodyZone-homeOff};
}
const dutyTimes=day=>{if(!day||day.kind==="rest"||!day.times?.length)return{report:null,release:null};const a=day.times.map(t=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);return m?+m[1]*60+ +m[2]:null}).filter(x=>x!=null);if(!a.length)return{report:null,release:null};let report=a[0],release=a[a.length-1];if(release<report)release+=1440;return{report,release}};
function get(day,days,ctx,fast,opts={}){
 const st=stateAt(day,days),dest=st.station,zone=st.zone,body=st.body,delta=st.delta,kind=ctx==="auto"?(day?.kind||"rest"):ctx,h=24-fast,{report,release}=dutyTimes(day);
 let start=720,note="Ровное дневное окно поддерживает режим без позднего бесконтрольного перекуса.";
 if(kind==="early"){start=report==null?540:clamp(report+90,480,660);note="Ранний duty: питание поставлено после начала работы, а сон остаётся приоритетом."}
 else if(kind==="night"){start=report==null?840:clamp(report-300,720,1080);note="Ночной duty: окно заканчивается до глубокой биологической ночи, насколько позволяет report time."}
 else if(kind==="duty"&&report!=null){start=clamp(report+60,600,780);note="Duty: начало окна привязано к распознанному report time."}
 else if(kind==="training"){start=660;note="Тренировка: окно предусматривает питание для восстановления."}
 else if(kind==="recovery"){start=630;note="Восстановление: сон и мягкое возвращение к режиму важнее строгости."}
 const shift=clamp(-body*30,-120,120);start+=shift;
 if(Math.abs(body)>=1){note+=" Время тела отличается от местного на "+Math.abs(body).toFixed(1)+" ч; применён постепенный сдвиг "+Math.abs(shift/60).toFixed(1)+" ч "+(shift<0?"раньше.":"позже.")}
 if(opts.goal==="fat"&&kind!=="night"){const close=start+h*60;if(close>1260){start-=close-1260;note+=" Для цели снижения жира окно завершено не позже 21:00 местного времени."}}
 const away=dest!==home,bf=opts.breakfast;let hotel=false;
 if(bf&&bf.on&&away){if(kind==="night"){note+=" Под гостиничный завтрак ночное окно не сдвигается: восстановительный сон важнее."}else{const latest=bf.to-60;if(start>latest){start=Math.max(latest,bf.from);hotel=true;note+=" Окно открыто к гостиничному завтраку."}}}
 start=clamp(Math.round(start),0,1439);
 return{zone,dest,delta,body,adapt:Math.abs(st.adapted),bodyZone:st.bodyZone,start,h,note,kind,away,hotel,bf:bf||null,report,release,dutyUsed:report!=null};
}
function instants(day,p){const base=Date.parse(day.date+"T00:00:00Z"),o=off(p.zone,day.date)*36e5;return{from:base+p.start*6e4-o,to:base+(p.start+p.h*60)*6e4-o}}
return{get,Z,off,instants,stateAt};
})();