(function(){
const Z={
ALA:"Asia/Almaty",NQZ:"Asia/Almaty",TSE:"Asia/Almaty",AKX:"Asia/Aqtobe",GUW:"Asia/Atyrau",SCO:"Asia/Aqtau",URA:"Asia/Oral",UKK:"Asia/Almaty",KGF:"Asia/Almaty",KSN:"Asia/Almaty",PPK:"Asia/Almaty",PLX:"Asia/Almaty",CIT:"Asia/Almaty",
ICN:"Asia/Seoul",KIX:"Asia/Tokyo",NRT:"Asia/Tokyo",AYT:"Europe/Istanbul",IST:"Europe/Istanbul",FRA:"Europe/Berlin",MUC:"Europe/Berlin",AMS:"Europe/Amsterdam",LHR:"Europe/London",CDG:"Europe/Paris",FCO:"Europe/Rome",MXP:"Europe/Rome",PRG:"Europe/Prague",WAW:"Europe/Warsaw",BCN:"Europe/Madrid",ATH:"Europe/Athens",
CAN:"Asia/Shanghai",PEK:"Asia/Shanghai",PVG:"Asia/Shanghai",URC:"Asia/Urumqi",XIY:"Asia/Shanghai",HKT:"Asia/Bangkok",BKK:"Asia/Bangkok",KUL:"Asia/Kuala_Lumpur",SGN:"Asia/Ho_Chi_Minh",HAN:"Asia/Ho_Chi_Minh",
DXB:"Asia/Dubai",AUH:"Asia/Dubai",DOH:"Asia/Qatar",DEL:"Asia/Kolkata",BOM:"Asia/Kolkata",GOI:"Asia/Kolkata",MLE:"Indian/Maldives",CMB:"Asia/Colombo",
TBS:"Asia/Tbilisi",BAK:"Asia/Baku",TAS:"Asia/Tashkent",FRU:"Asia/Bishkek",DME:"Europe/Moscow",SVO:"Europe/Moscow",LED:"Europe/Moscow",
JED:"Asia/Riyadh",MED:"Asia/Riyadh",RUH:"Asia/Riyadh",TLV:"Asia/Jerusalem",CAI:"Africa/Cairo",SSH:"Africa/Cairo"
};
const home="ALA",clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const offAt=(zone,ms)=>{const p=new Intl.DateTimeFormat("en-US",{timeZone:zone,timeZoneName:"shortOffset",hour:"2-digit"}).formatToParts(new Date(ms)).find(x=>x.type==="timeZoneName")?.value||"GMT";const m=p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);return m?(m[1]==="-"?-1:1)*(+m[2]+(+m[3]||0)/60):0};
const off=(zone,date)=>offAt(zone,Date.parse(date+"T12:00:00Z"));
const zoned=(zone,ms)=>ms-offAt(zone,ms-offAt(zone,ms)*36e5)*36e5;
const dayDiff=(a,b)=>Math.max(0,Math.round((new Date(a+"T12:00")-new Date(b+"T12:00"))/864e5));
const move=(body,target,days)=>{const d=target-body;if(!d||!days)return body;const rate=d>0?1:1.5;return body+Math.sign(d)*Math.min(Math.abs(d),days*rate)};
const arrivalOf=x=>{const n=x?.airports?.at(-1);return n&&Z[n]?n:null};

/* Station is the location at the START of a roster day. A flight day's
   report time belongs to the departure station, so the final airport in
   that day's roster must only become current after that day. The previous
   implementation applied the destination timezone immediately and could
   shift an ALA→FRA recommendation by several hours. */
function stateAt(day,days){
 const sorted=[...days].sort((a,b)=>a.date.localeCompare(b.date)),base=sorted[0]?.date||day.date;
 let station=home,bodyZone=off(Z[home],base),prev=base,stationSince=base,selectedIndex=-1;
 for(let i=0;i<sorted.length;i++){
  const x=sorted[i];
  if(x.date>day.date)break;
  const gap=dayDiff(x.date,prev);
  const nextChange=sorted.slice(i).find(y=>{const n=arrivalOf(y);return n&&n!==station});
  const shortAway=station!==home&&nextChange&&dayDiff(nextChange.date,stationSince)<=2;
  if(gap&&!shortAway)bodyZone=move(bodyZone,off(Z[station]||Z[home],x.date),gap);
  selectedIndex=i;
  if(x.date===day.date)break;
  const next=arrivalOf(x);
  if(next&&next!==station){station=next;stationSince=x.date}
  prev=x.date;
 }
 const zone=Z[station]||Z[home],local=off(zone,day.date),homeOff=off(Z[home],day.date);
 const nextChange=sorted.slice(Math.max(0,selectedIndex)).find(y=>{const n=arrivalOf(y);return n&&n!==station});
 const shortStay=station!==home&&nextChange&&dayDiff(nextChange.date,stationSince)<=2;
 return{station,zone,local,homeOff,bodyZone,body:bodyZone-local,delta:local-homeOff,adapted:bodyZone-homeOff,shortStay:!!shortStay};
}

const dutyTimes=day=>{if(!day||day.kind==="rest"||!day.times?.length)return{report:null,release:null};const a=day.times.map(t=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);return m?+m[1]*60+ +m[2]:null}).filter(x=>x!=null);if(!a.length)return{report:null,release:null};let report=a[0],release=a[a.length-1];if(release<report)release+=1440;return{report,release}};
function get(day,days,ctx,fast,opts={}){
 const st=stateAt(day,days),dest=st.station,zone=st.zone,body=st.body,delta=st.delta,kind=ctx==="auto"?(day?.kind||"rest"):ctx,h=24-fast,{report,release}=dutyTimes(day);
 const isRest=kind==="rest";
 let start=720,note="Ровное дневное окно поддерживает режим без позднего бесконтрольного перекуса.";
 if(kind==="early"){start=report==null?540:clamp(report+90,480,660);note="Ранний duty: питание поставлено после начала работы, а сон остаётся приоритетом."}
 else if(kind==="night"){start=report==null?840:clamp(report-300,720,1080);note="Ночной duty: окно начинается до report time и не сдвигается под гостиничный завтрак; во время duty приоритет — безопасная работоспособность и самочувствие."}
 else if(kind==="duty"&&report!=null){start=report>=840?clamp(report-180,660,900):clamp(report+60,600,780);note="Duty: окно привязано к распознанному report time и расположено до позднего либо после раннего report."}
 else if(kind==="training"){start=660;note="Тренировка: окно предусматривает питание для восстановления."}
 else if(kind==="recovery"){start=630;note="Восстановление: сон и мягкое возвращение к режиму важнее строгости."}
 else if(isRest){
  const bodyShift=clamp(-body*60,-480,480);start=720+bodyShift;
  note=Math.abs(body)>=1?("День без duty: окно следует адаптированному телесному времени, а не жёстко привязано к полудню. Тело отличается от местного на "+Math.abs(body).toFixed(1)+" ч, поэтому окно сдвинуто "+Math.abs(bodyShift/60).toFixed(1)+" ч "+(bodyShift<0?"раньше.":"позже.")):"Окно центрировано на адаптированном телесном полудне — сейчас оно совпадает с местным, так как тело ещё не сместилось."
 }
 const shift=isRest?0:(st.shortStay?clamp(-body*60,-240,240):clamp(-body*30,-120,120));start+=shift;
 if(!isRest&&Math.abs(body)>=1){note+=" Время тела отличается от местного на "+Math.abs(body).toFixed(1)+" ч; "+(st.shortStay?"для короткой стоянки сохранено время базы, окно сдвинуто ":"применён постепенный сдвиг ")+Math.abs(shift/60).toFixed(1)+" ч "+(shift<0?"раньше.":"позже.")}
 if(opts.goal==="fat"&&kind!=="night"){const close=start+h*60;if(close>1260){start-=close-1260;note+=" Для цели снижения жира окно завершено не позже 21:00 местного времени."}}
 const away=dest!==home,bf=opts.breakfast;let hotel=false;
 if(bf&&bf.on&&away){if(kind==="night"){note+=" Под гостиничный завтрак ночное окно не сдвигается: восстановительный сон важнее."}else{const latest=bf.to-60;if(start>latest){start=Math.max(latest,bf.from);hotel=true;note+=" Окно открыто к гостиничному завтраку."}}}
 start=clamp(Math.round(start),0,1439);
 return{zone,dest,delta,body,adapt:Math.abs(st.adapted),bodyZone:st.bodyZone,shortStay:st.shortStay,start,h,note,kind,away,hotel,bf:bf||null,report,release,dutyUsed:report!=null};
}
function instants(day,p){const base=Date.parse(day.date+"T00:00:00Z");return{from:zoned(p.zone,base+p.start*6e4),to:zoned(p.zone,base+(p.start+p.h*60)*6e4)}}
const Circadian={get,Z,off,offAt,zoned,instants,stateAt};
if(typeof module!=="undefined"&&module.exports)module.exports=Circadian;else window.Circadian=Circadian;
})();
