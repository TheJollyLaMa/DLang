const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createServer } = require('../index');
const load = async () => ({ ...await import('../public/dlang/core.mjs'), ...await import('../public/dlang/scenes.mjs'), ...await import('../public/dlang/packs.mjs') });
const BASE = Date.parse('2026-11-02T05:00:00Z');
function configuration() {
  return { id: 'test-week', timezone: 'America/New_York', enrollmentCutoff: new Date(BASE).toISOString(), dayStarts: Array.from({length:8},(_,i)=>new Date(BASE+i*86400000).toISOString()), conceptPolicy: 'recurring-12', level:1 };
}
async function fixture() {
  const m = await load(), data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value) };
  let now = BASE-1;
  const options = { config: configuration(), scenes:m.SCENES,packs:m.PACKS,storage,clock:()=>now };
  const engine = new m.Round(options);
  return { ...m, engine, options, data, setTime:value=>{now=value;} };
}
const checked = { eligible:true,authorization:false };
test('explicit configuration only; enrollment cutoff, supported pack and weekly language lock',async()=>{
  const f=await fixture();
  assert.equal(f.configuration(JSON.parse(fs.readFileSync('public/dlang/round.json'))).available,true);
  assert.equal(f.configuration({...configuration(),timezone:null}).available,false);
  assert.throws(()=>f.engine.enroll('en',null),/check required/);
  assert.throws(()=>f.engine.enroll('en',{eligible:true,authorization:true}),/check required/);
  assert.throws(()=>f.engine.enroll('ja',checked),/Unsupported/);
  f.engine.enroll('fr',checked);
  assert.throws(()=>f.engine.enroll('es',checked),/locked/);
  assert.throws(()=>f.engine.go(),/Not eligible/);
  f.setTime(BASE); assert.throws(()=>new f.Round({...f.options,storage:{getItem:()=>null,setItem:()=>{}}}).enroll('en',checked),/closed/);
  assert.equal(f.engine.read().language,'fr');
});
test('confirmed New York pilot: Monday09, Tue–Sun midnight, Sunday18, weekly Get Ready and DST-safe repetition',async()=>{
  const f=await load(),c=JSON.parse(fs.readFileSync('public/dlang/round.json'));
  const before=f.availability(c,Date.parse('2026-11-16T13:59:59Z'));
  assert.equal(before.phase,'get-ready');assert.equal(before.enrollmentOpen,true);
  const monday=f.availability(c,Date.parse('2026-11-16T14:00:00Z'));
  assert.equal(monday.day,0);assert.equal(monday.enrollmentOpen,false);
  assert.equal(monday.boundaries[7],Date.parse('2026-11-22T23:00:00Z'));
  assert.equal(f.availability(c,Date.parse('2026-11-17T04:59:59Z')).day,0);
  assert.equal(f.availability(c,Date.parse('2026-11-17T05:00:00Z')).day,1);
  assert.equal(f.availability(c,Date.parse('2026-11-22T22:59:59Z')).day,6);
  const gap=f.availability(c,Date.parse('2026-11-22T23:00:00Z'));
  assert.equal(gap.phase,'get-ready');assert.equal(gap.day,-1);assert.equal(gap.enrollmentOpen,true);
  assert.equal(gap.boundaries[0],Date.parse('2026-11-23T14:00:00Z'));
  assert.equal(gap.previousRoundId,monday.roundId);
  const spring=f.availability(c,Date.parse('2027-03-14T20:00:00Z'));
  assert.equal(spring.day,6);assert.equal(spring.boundaries[7],Date.parse('2027-03-14T22:00:00Z'));
  assert.equal(spring.boundaries[6]-spring.boundaries[5],86400000);
  assert.equal(spring.boundaries[7]-spring.boundaries[6],17*3600000);
  const next=f.availability(c,Date.parse('2027-03-15T12:59:59Z'));
  assert.equal(next.enrollmentOpen,true);
  assert.equal(next.boundaries[0],Date.parse('2027-03-15T13:00:00Z'));
});
test('Sunday end min(120sec, window end), recurring round records and language locks are separate',async()=>{
  const f=await fixture(),config=JSON.parse(fs.readFileSync('public/dlang/round.json'));
  const options={...f.options,config},r=new f.Round(options);
  f.setTime(Date.parse('2026-11-16T13:59:59Z'));r.enroll('en',checked);
  f.setTime(Date.parse('2026-11-22T22:59:30Z'));r.go();
  assert.equal(r.read().attempts[6].deadline,Date.parse('2026-11-22T23:00:00Z'));
  r.answer('d7-chair','chair');r.story(6,'Sunday observation');
  const firstId=r.roundId;
  f.setTime(Date.parse('2026-11-22T23:00:00Z'));
  assert.throws(()=>r.go(),/Not eligible/);
  assert.equal(r.context().previousState.attempts[6].status,'finished');
  assert.equal(r.context().previousState.stories[6],'Sunday observation');
  assert.notEqual(r.roundId,firstId);assert.equal(r.read().language,null);
  r.enroll('fr',checked);assert.equal(r.read().language,'fr');
  assert.equal(r.read(firstId).language,'en');
});
test('explicit Go, exact 120000ms boundary, aliases, duplicate refusal, reload and second tab recovery',async()=>{
  const f=await fixture();f.engine.enroll('en',checked);f.setTime(BASE);f.engine.go();
  const resumed=new f.Round(f.options);
  assert.equal(resumed.context().state.attempts[0].deadline,BASE+120000);
  assert.throws(()=>resumed.go(),/One attempt/);
  f.setTime(BASE+119999);
  assert.equal(resumed.answer('d1-chair',' SEAT ').correct,true);
  assert.throws(()=>resumed.answer('d1-chair','chair'),/unanswered/);
  assert.equal(resumed.answer('d1-cup','glass').correct,false);
  f.setTime(BASE+120000);
  assert.throws(()=>resumed.answer('d1-cup','cup'),/closed/);
  assert.equal(resumed.context().state.attempts[0].status,'finished');
  assert.throws(()=>resumed.go(),/One attempt/);
});
test('day rollover caps late timer, misses score zero, stories separate, week ends',async()=>{
  const f=await fixture();f.engine.enroll('es',checked);
  f.setTime(BASE+86400000-1000);f.engine.go();
  assert.equal(f.engine.read().attempts[0].deadline,BASE+86400000);
  f.setTime(BASE+86400000);f.engine.go();
  assert.equal(f.engine.read().attempts[0].status,'finished');
  f.engine.answer('d2-chair','la silla');f.engine.story(1,'A quiet story.');f.engine.finish();
  assert.equal(f.totalScore(f.engine.read()).total,1);
  assert.equal(f.engine.read().stories[1],'A quiet story.');
  f.setTime(BASE+7*86400000);
  assert.equal(f.engine.context().status.ended,true);assert.throws(()=>f.engine.go(),/Not eligible/);
  assert.deepEqual(f.totalScore(f.engine.read()).daily,[0,1,0,0,0,0,0]);
});
test('calendar configuration spans DST 25-hour and 23-hour days independent of host timezone',async()=>{
  const f=await load();
  const make=(days)=>({ ...configuration(),dayStarts:days,enrollmentCutoff:days[0] });
  const fall=['2026-10-30T00:00:00-04:00','2026-10-31T00:00:00-04:00','2026-11-01T00:00:00-04:00','2026-11-02T00:00:00-05:00','2026-11-03T00:00:00-05:00','2026-11-04T00:00:00-05:00','2026-11-05T00:00:00-05:00','2026-11-06T00:00:00-05:00'];
  assert.equal(f.configuration(make(fall)).available,true);
  assert.equal(f.availability(make(fall),Date.parse('2026-11-02T04:59:59Z')).day,2);
  assert.equal(f.availability(make(fall),Date.parse('2026-11-02T05:00:00Z')).day,3);
  const spring=['2026-03-06T00:00:00-05:00','2026-03-07T00:00:00-05:00','2026-03-08T00:00:00-05:00','2026-03-09T00:00:00-04:00','2026-03-10T00:00:00-04:00','2026-03-11T00:00:00-04:00','2026-03-12T00:00:00-04:00','2026-03-13T00:00:00-04:00'];
  assert.equal(f.configuration(make(spring)).available,true);
  assert.equal(f.availability(make(spring),Date.parse('2026-03-09T04:00:00Z')).day,3);
  assert.equal(f.configuration({...configuration(),timezone:'Not/AZone'}).available,false);
  assert.equal(f.configuration({...configuration(),dayStarts:fall.map(n=>n.slice(0,19))}).available,false);
});
test('exact 76 versus 75/84 and integer principal/forfeiture/carryover accounting never settles',async()=>{
  const f=await load();
  const state=n=>({attempts:Object.fromEntries(Array.from({length:7},(_,i)=>[i,{correct:Array(Math.max(0,Math.min(12,n-12*i))).fill('x')}]))});
  assert.equal(f.totalScore(state(75)).qualifies,false);assert.equal(f.totalScore(state(76)).qualifies,true);
  const p=f.previewAccounting([76,84,75],1);
  assert.deepEqual([p.principalCents,p.shareCents,p.unresolvedDustCents,p.carryoverCents],['100','50','1','0']);
  assert.equal(p.settlementBlocked,true);
  assert.equal(f.previewAccounting([75,0],17).carryoverCents,'217');
  assert.equal(f.previewAccounting([],17).carryoverCents,'17');
  assert.throws(()=>f.previewAccounting([84.1]),/Invalid/);
  assert.equal(f.PAYMENTS_ENABLED,false);assert.deepEqual(f.LEVELS.map(l=>l.active),[true,false,false]);
});
test('7 scenes × 12 linked unique targets, 7 distinct exemplars per concept, boxes fit and do not overlap',async()=>{
  const f=await load();
  assert.equal(f.SCENES.length,7);
  const ids=new Set();
  for(const scene of f.SCENES){
    assert.equal(scene.targets.length,12);
    assert.equal(new Set(scene.targets.map(t=>t.concept)).size,12);
    for(const t of scene.targets){
      ids.add(t.id);const[x,y,w,h]=t.box;
      assert.ok(x>=0&&y>=0&&w>=44&&h>=43&&x+w<=1000&&y+h<=600);
      assert.equal(f.studyLabels(t.concept,['en','es','fr'],f.PACKS).length,3);
      for(const other of scene.targets.filter(o=>o!==t)){
        const[a,b,c,d]=other.box;
        assert.ok(x+w<=a||a+c<=x||y+h<=b||b+d<=y,`${t.id} overlaps ${other.id}`);
      }
    }
    assert.match(f.sceneSVG(scene),/viewBox="0 0 1000 600"/);
    assert.equal((f.sceneSVG(scene).match(/data-target=/g)||[]).length,12);
  }
  assert.equal(ids.size,84);
  for(const concept of f.CONCEPTS) assert.equal(new Set(f.SCENES.map(s=>s.targets.find(t=>t.concept===concept).exemplar)).size,7);
  assert.equal(new Set(f.SCENES.map(s=>f.sceneSVG(s))).size,7);
  assert.throws(()=>f.studyLabels('chair',['en','ja','fr'],f.PACKS),/Unsupported/);
  assert.equal(f.accepted(f.PACKS.es,'tree','arbol'),true);
  assert.equal(f.accepted(f.PACKS.fr,'bicycle','bicyclette'),true);
});
test('unavailable storage and corrupt attempts fail closed, distinct84 config cannot use recurring bank',async()=>{
  const f=await fixture();
  const bad=new f.Round({...f.options,storage:{getItem:()=>'{',setItem:()=>{}}});
  assert.throws(()=>bad.go(),/corrupt/);
  const unavailable=new f.Round({...f.options,storage:{getItem:()=>null,setItem:()=>{throw Error('Storage denied');}}});
  assert.throws(()=>unavailable.enroll('en',checked),/Storage denied/);
  const distinct=new f.Round({...f.options,config:{...f.options.config,conceptPolicy:'distinct-84'}});
  assert.equal(distinct.context().status.available,false);
});
test('all twelve answers finish exactly once; pack registry accepts an explicit additional fixture pack',async()=>{
  const f=await fixture(), extra=Object.fromEntries(Object.keys(f.PACKS.en).map(concept=>[concept,{label:`fixture-${concept}`,aliases:[]}]));
  const r=new f.Round({...f.options,packs:{...f.PACKS,'x-fixture':extra}});
  r.enroll('x-fixture',checked);f.setTime(BASE);r.go();
  assert.equal(f.studyLabels('chair',['en','es','fr','x-fixture'],{...f.PACKS,'x-fixture':extra}).length,4);
  for(const target of f.SCENES[0].targets)assert.equal(r.answer(target.id,`fixture-${target.concept}`).correct,true);
  assert.equal(r.read().attempts[0].status,'finished');
  assert.equal(f.totalScore(r.read()).total,12);
  assert.throws(()=>r.go(),/One attempt/);
});
test('reviewed five-member pilot snapshot is explicit, bounded and never grants financial authority',async()=>{
  const {pilotEligibility}=await import('../public/dlang/pilot.mjs');
  const published=JSON.parse(fs.readFileSync('public/dlang/pilot-roster.json'));
  assert.equal(published.members.length,5);
  assert.ok(published.members.some(row=>row.label==='GrannyLyn'));
  assert.ok(published.members.some(row=>row.label==='Bobdub'));
  for(const row of published.members)assert.deepEqual(pilotEligibility(published,row.walletAddress),{eligible:true,authorization:false});
  const address='0x'+'1'.repeat(40);
  assert.equal(pilotEligibility(published,address).eligible,false);
  assert.throws(()=>pilotEligibility({...published,members:[published.members[0],published.members[0]]},address),/invalid/);
  assert.throws(()=>pilotEligibility(null,address),/invalid/);
});
test('static serving exposes no transaction endpoints or deployment secrets',async t=>{
  const server=createServer();server.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/contracts/dlang/DLangTrial.sol')).status,404);
});
