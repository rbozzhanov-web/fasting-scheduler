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

const Timer={dur,computeFastState};
if(typeof module!=="undefined"&&module.exports)module.exports=Timer;else window.Timer=Timer;
})();
