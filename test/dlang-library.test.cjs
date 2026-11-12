const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
test('365 × 3 reproducible compositions: rendered uniqueness, leveled 72-concept curriculum, all packs, varied order and safe boxes',async()=>{
  const {YEAR_LIBRARY,yearLibrary,LIBRARY_CONCEPTS,librarySVG}=await import('../public/dlang/library.mjs');
  const {LEVELS,levelForDay,poolForDay}=await import('../public/dlang/curriculum.mjs');
  const {PACKS}=await import('../public/dlang/packs.mjs');
  assert.equal(YEAR_LIBRARY.length,1095);assert.deepEqual(yearLibrary(),YEAR_LIBRARY);
  assert.ok(YEAR_LIBRARY.every(scene=>scene.id.startsWith('year-v2-')&&scene.sceneVersion===2));
  assert.equal(LIBRARY_CONCEPTS.length,72);assert.equal(LEVELS.length,6);
  assert.equal(levelForDay(0).id,1);assert.equal(levelForDay(20).id,2);assert.equal(levelForDay(62).id,5);assert.equal(levelForDay(63).id,6);
  assert.equal(poolForDay(0).length,12);assert.equal(poolForDay(7).length,36);assert.equal(poolForDay(63).length,72);
  const hashes=new Set(),designs=new Map(LIBRARY_CONCEPTS.map(id=>[id,new Set()]));
  const artifact=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../public/dlang/year-library.json')));
  assert.equal(artifact.sceneVersion,2);
  for(const [index,scene] of YEAR_LIBRARY.entries()){
    assert.equal(new Set(scene.targets.map(t=>t.concept)).size,12);
    const hash=createHash('sha256').update(librarySVG(scene)).digest('hex');hashes.add(hash);
    assert.equal(artifact.scenes[index].svgSHA256,hash);
    assert.equal(scene.level,levelForDay(Math.floor(index/3)).id);
    assert.equal(artifact.scenes[index].id,scene.id);
    const pool=new Set(poolForDay(Math.floor(index/3)));
    for(const target of scene.targets){
      assert.ok(pool.has(target.concept),`level gate: ${target.concept} before its level opens`);
      designs.get(target.concept).add(target.design);
      for(const pack of Object.values(PACKS))assert.ok(pack[target.concept].label);
      const [x,y,w,h]=target.box;assert.ok(x>=0&&y>=0&&x+w<=1000&&y+h<=600);
      for(const other of scene.targets)if(other!==target){const[a,b,c,d]=other.box;assert.ok(x+w<=a||a+c<=x||y+h<=b||b+d<=y);}
    }
  }
  // The first week repeats the same dozen home objects; the later year reaches every level.
  assert.equal(new Set(YEAR_LIBRARY.slice(0,21).flatMap(s=>s.targets.map(t=>t.concept))).size,12);
  assert.equal(new Set(YEAR_LIBRARY.flatMap(s=>s.targets.map(t=>t.concept))).size,72);
  assert.equal(hashes.size,1095);assert.ok([...designs.values()].every(s=>s.size===32));
  assert.ok(new Set(YEAR_LIBRARY.map(s=>s.targets.map(t=>t.concept).join())).size>300);
});
test('complete year of three-a-day practice: no reused composition or exemplar in 21 sessions; honest statistics',async()=>{
  const {emptyPractice,nextScene,finishPractice,practiceStats}=await import('../public/dlang/library.mjs');
  for(const mixed of [false,true]){
    let state=emptyPractice(),recent=[];
    for(let i=0;i<1095;i++){
      const now=new Date(2026,0,1+Math.floor(i/3),12,0,i%3).getTime(),scene=nextScene(state,now);
      assert.ok(scene,`fresh scene at ${i}`);const exemplars=scene.targets.map(t=>t.exemplar);
      assert.ok(!recent.flat().some(id=>exemplars.includes(id)));
      state=finishPractice(state,scene,Object.fromEntries(scene.targets.map((t,j)=>[t.concept,!mixed||j%3!==0])),'en',now);
      recent.push(exemplars);recent=recent.slice(-21);
      if(i%3===2)assert.equal(nextScene(state,now),null);
    }
    const stats=practiceStats(state,state.attempts.at(-1).at);
    assert.equal(stats.sessions,1095);assert.equal(stats.days,365);assert.equal(stats.today,3);
      assert.equal(stats.touched,13140);assert.equal(stats.remembered,mixed?8760:13140);assert.equal(stats.concepts,72);
  }
});
test('self-review intervals: early rehearsal does not postpone due date; again returns after ten minutes; invalid restore fails',async()=>{
  const {emptyPractice,nextScene,finishPractice,validatePractice}=await import('../public/dlang/library.mjs');
  const now=new Date(2026,0,1,12).getTime(),first=nextScene(emptyPractice(),now),id=first.targets[0].concept;
  let state=finishPractice(emptyPractice(),first,{[id]:true},'hi',now);
  assert.equal(state.reviews[id].due,now+86400000);
  const second=nextScene(state,now+1000);
  assert.ok(second.targets.some(t=>t.concept===id));
  state=finishPractice(state,second,{[id]:true},'hi',now+1000);
  assert.equal(state.reviews[id].stage,0);assert.equal(state.reviews[id].due,now+86400000);
  const third=nextScene(state,now+86400000);
  assert.ok(third.targets.some(t=>t.concept===id));
  state=finishPractice(state,third,{[id]:true},'hi',now+86400000);
  assert.equal(state.reviews[id].stage,1);assert.equal(state.reviews[id].due,now+4*86400000);
  const fourth=nextScene(state,now+86400001);
  assert.ok(fourth.targets.some(t=>t.concept===id));
  state=finishPractice(state,fourth,{[id]:false},'hi',now+86400001);
  assert.equal(state.reviews[id].stage,0);assert.equal(state.reviews[id].due,now+86400001+600000);
  assert.throws(()=>validatePractice({...state,reviews:[]}));
  assert.throws(()=>validatePractice({...state,attempts:[...state.attempts,state.attempts[0]]}));
});

test('deployed 36-concept history migrates without binding old scene IDs to new targets',async()=>{
  const {execFileSync}=require('node:child_process');
  const {YEAR_LIBRARY,PRACTICE_KEY,readPractice,nextScene,practiceStats}=await import('../public/dlang/library.mjs');
  const release=JSON.parse(execFileSync('git',['show','4f4a809:public/dlang/year-library.json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
  assert.equal(release.version,1);assert.equal(release.concepts,36);
  assert.notDeepEqual(release.scenes[0].targets.map(target=>target.concept),YEAR_LIBRARY[0].targets.map(target=>target.concept));
  const now=new Date(2026,0,1,12).getTime(),old=release.scenes[0];
  const storage=new Map([[PRACTICE_KEY,JSON.stringify({version:1,attempts:[{
    scene:old.id,day:'2026-01-01',correct:7,touched:10,language:'es',at:now
  }],reviews:{dog:{stage:1,due:now+86400000,seen:now,count:2}}})]]);
  const adapter={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const migrated=readPractice(adapter);
  assert.equal(migrated.version,2);assert.equal(migrated.attempts[0].scene,'legacy:year-0001');
  assert.equal(migrated.attempts[0].sceneVersion,1);assert.equal(migrated.reviews.dog.count,2);
  assert.equal(JSON.parse(storage.get(PRACTICE_KEY)).version,2);
  assert.equal(practiceStats(migrated,now).remembered,7);
  assert.equal(nextScene(migrated,now).id,YEAR_LIBRARY[0].id);
});

test('practice progression cannot finish a later curriculum level before the current one',async()=>{
  const {YEAR_LIBRARY,emptyPractice,nextScene,finishPractice,practiceProgress}=await import('../public/dlang/library.mjs');
  const now=new Date(2026,0,1,12).getTime();
  let state=emptyPractice();
  assert.equal(nextScene(state,now).level,1);
  assert.throws(()=>finishPractice(state,YEAR_LIBRARY[21],{},'en',now),/unavailable/);
  for(let i=0;i<21;i++){
    const at=now+i*86400000,scene=nextScene(state,at);
    assert.equal(scene.level,1);
    state=finishPractice(state,scene,Object.fromEntries(scene.targets.map(target=>[target.concept,false])),'en',at);
  }
  const progress=practiceProgress(state);
  assert.equal(progress.level,2);assert.equal(progress.completedInLevel,0);assert.equal(progress.totalInLevel,42);
  assert.equal(nextScene(state,now+21*86400000).level,2);
});

test('attempt integrity rejects changed scene mappings, forged dates and record overages',async()=>{
  const {emptyPractice,nextScene,finishPractice,validatePractice,MAX_PRACTICE_ATTEMPTS}=await import('../public/dlang/library.mjs');
  const now=new Date(2026,0,1,12).getTime(),scene=nextScene(emptyPractice(),now);
  const state=finishPractice(emptyPractice(),scene,Object.fromEntries(scene.targets.map(target=>[target.concept,false])),'en',now);
  assert.throws(()=>validatePractice({...state,attempts:[{...state.attempts[0],sceneHash:'changed'}]}),/no longer matches/);
  assert.throws(()=>validatePractice({...state,attempts:[{...state.attempts[0],day:'2026-01-02'}]}),/Invalid practice attempt/);
  assert.throws(()=>validatePractice({...state,attempts:Array(MAX_PRACTICE_ATTEMPTS+1).fill({})}),/Practice records invalid/);
});
