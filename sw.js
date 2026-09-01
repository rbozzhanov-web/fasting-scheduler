const P="fuel-window-",C=P+"v28";
const A=["./","./index.html","./roster-parser.js","./circadian.js","./timer.js","./state.js","./icon.svg","./icon-180.png","./icon-512.png","./manifest.webmanifest","./vendor/pdf.mjs","./vendor/pdf.worker.mjs","./vendor/PDFJS-LICENSE.txt","./sw.js"];

self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A))));

/* Cache Storage общий на весь origin: на rbozzhanov-web.github.io рядом
   живут другие проекты. Удаляем только свои прошлые версии по префиксу, а
   не всё чужое — за вычетом двух известных имён. Все кэши приложения за всю
   его историю называются fuel-window-v* либо fuel-ics, так что ничего
   своего этот фильтр не оставляет. */
self.addEventListener("activate",e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith(P)&&k!==C).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting()});

self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const c of list)if("focus"in c)return c.focus();
    return self.clients.openWindow("./");
  }));
});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  if(new URL(e.request.url).pathname.endsWith("/reminders.ics")){
    e.respondWith(caches.open("fuel-ics").then(c=>c.match(e.request,{ignoreSearch:true}))
      .then(r=>r||new Response("Напоминания ещё не сформированы",{status:404})));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{
    /* Кэшируем только собственные успешные ответы приложения — не 404,
       не редиректы и не сторонние (opaque) запросы, чтобы офлайн-режим
       не начал отдавать их как валидные. */
    if(r.ok&&r.type==="basic"){
      const copy=r.clone();
      caches.open(C).then(c=>c.put(e.request,copy));
    }
    return r;
  }).catch(()=>caches.match(e.request)));
});
