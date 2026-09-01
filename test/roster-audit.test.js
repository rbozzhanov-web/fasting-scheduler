const test = require('node:test');
const assert = require('node:assert/strict');
const Circadian = require('../circadian.js');
const Parser = require('../roster-parser.js');

const day=(date,kind='rest',times=[],airports=[])=>({date,kind,times,airports});

for(const fast of [12,14,16,18]){
  test(`all modes: ${fast}:${24-fast} keeps the configured eating-window length`,()=>{
    const d=day('2026-09-01');
    const p=Circadian.get(d,[d],'auto',fast,{goal:'keep'});
    assert.equal(p.h,24-fast);
  });
}

test('fat-loss goal caps non-night windows at 21:00 local time',()=>{
  const d=day('2026-09-01');
  for(const fast of [12,14,16,18]){
    const p=Circadian.get(d,[d],'auto',fast,{goal:'fat'});
    assert.ok(p.start+p.h*60<=21*60,`${fast}:${24-fast} closes after 21:00`);
  }
});

test('maintenance goal does not impose the 21:00 cap',()=>{
  const d=day('2026-09-01');
  const p=Circadian.get(d,[d],'auto',12,{goal:'keep'});
  assert.equal(p.start,12*60);
  assert.equal(p.start+p.h*60,24*60);
});

test('night duty is intentionally exempt from the fat-loss 21:00 cap',()=>{
  const d=day('2026-09-01','night',['22:00','06:00']);
  const p=Circadian.get(d,[d],'auto',12,{goal:'fat'});
  assert.equal(p.kind,'night');
  assert.ok(p.start<22*60);
  assert.ok(p.start+p.h*60>21*60);
  assert.match(p.note,/безопасная работоспособность/);
});

test('hotel breakfast shifts an adapted away-station window early enough to catch breakfast',()=>{
  const days=[
    day('2026-09-01','duty',['09:00','17:00'],['LHR']),
    day('2026-09-08','rest',[],[]),
    day('2026-09-10','duty',['10:00','18:00'],['ALA']),
  ];
  const p=Circadian.get(days[1],days,'auto',16,{goal:'keep',breakfast:{on:true,from:390,to:600}});
  assert.equal(p.away,true);
  assert.ok(p.start<=540,'window should open by 09:00 for a breakfast ending at 10:00');
  assert.equal(p.hotel,true);
});

test('hotel breakfast never shifts a night-duty window',()=>{
  const days=[
    day('2026-09-01','duty',['09:00','17:00'],['LHR']),
    day('2026-09-02','night',['22:00','06:00'],[]),
    day('2026-09-03','duty',['10:00','18:00'],['ALA']),
  ];
  const base=Circadian.get(days[1],days,'auto',16,{goal:'keep'});
  const hotel=Circadian.get(days[1],days,'auto',16,{goal:'keep',breakfast:{on:true,from:390,to:600}});
  assert.equal(hotel.start,base.start);
  assert.equal(hotel.hotel,false);
});

test('short layover preserves home body clock and is flagged shortStay',()=>{
  const days=[day('2026-09-01','duty',['09:00','17:00'],['LHR']),day('2026-09-02'),day('2026-09-03','duty',['10:00','18:00'],['ALA'])];
  const st=Circadian.stateAt(days[1],days);
  assert.equal(st.station,'LHR');
  assert.equal(st.shortStay,true);
  assert.equal(st.bodyZone,st.homeOff);
});

test('long layover adapts body clock before return',()=>{
  const days=[day('2026-09-01','duty',['09:00','17:00'],['LHR']),day('2026-09-08'),day('2026-09-10','duty',['10:00','18:00'],['ALA'])];
  const st=Circadian.stateAt(days[1],days);
  assert.equal(st.station,'LHR');
  assert.equal(st.shortStay,false);
  assert.notEqual(st.bodyZone,st.homeOff);
});

test('flight duty uses departure station on the duty day and destination on the next roster day',()=>{
  const days=[day('2026-09-01','early',['06:00','14:00'],['FRA']),day('2026-09-02')];
  const duty=Circadian.get(days[0],days,'auto',16,{goal:'keep'});
  const layover=Circadian.get(days[1],days,'auto',16,{goal:'keep'});
  assert.equal(duty.zone,'Asia/Almaty');
  assert.equal(layover.zone,'Europe/Berlin');
});

test('report-hour boundaries stay stable: 05 night, 06-08 early, 09 duty, 18 night',()=>{
  const known=Circadian.Z;
  assert.equal(Parser.parseDutyText('951 05:00 12:00',known).kind,'night');
  assert.equal(Parser.parseDutyText('951 06:00 12:00',known).kind,'early');
  assert.equal(Parser.parseDutyText('951 08:00 15:00',known).kind,'early');
  assert.equal(Parser.parseDutyText('951 09:00 16:00',known).kind,'duty');
  assert.equal(Parser.parseDutyText('951 18:00 02:00',known).kind,'night');
});

test('overnight release is carried into the next day in planning metadata',()=>{
  const d=day('2026-09-01','night',['22:00','06:00']);
  const p=Circadian.get(d,[d],'auto',16,{goal:'keep'});
  assert.equal(p.report,22*60);
  assert.equal(p.release,30*60);
});

test('window instants preserve station-local wall clock in Frankfurt',()=>{
  const d=day('2026-09-02');
  const p={zone:'Europe/Berlin',start:12*60,h:8};
  const w=Circadian.instants(d,p);
  const fmt=ms=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
  assert.equal(fmt(w.from),'12:00');
  assert.equal(fmt(w.to),'20:00');
});
