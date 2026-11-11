const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
test('365 × 3 reproducible compositions: rendered uniqueness, 36 concepts, all packs, varied order and safe boxes',async()=>{
  const {YEAR_LIBRARY,yearLibrary,LIBRARY_CONCEPTS,librarySVG}=await import('../public/dlang/library.mjs');
  const {PACKS}=await import('../public/dlang/packs.mjs');
  assert.equal(YEAR_LIBRARY.length,1095);assert.deepEqual(yearLibrary(),YEAR_LIBRARY);
  const hashes=new Set(),designs=new Map(LIBRARY_CONCEPTS.map(id=>[id,new Set()]));
  const artifact=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../public/dlang/year-library.json')));
  for(const [index,scene] of YEAR_LIBRARY.entries()){
    assert.equal(new Set(scene.targets.map(t=>t.concept)).size,12);
    const hash=createHash('sha256').update(librarySVG(scene)).digest('hex');hashes.add(hash);
    assert.equal(artifact.scenes[index].svgSHA256,hash);
    for(const target of scene.targets){
      designs.get(target.concept).add(target.design);
      for(const pack of Object.values(PACKS))assert.ok(pack[target.concept].label);
      const [x,y,w,h]=target.box;assert.ok(x>=0&&y>=0&&x+w<=1000&&y+h<=600);
      for(const other of scene.targets)if(other!==target){const[a,b,c,d]=other.box;assert.ok(x+w<=a||a+c<=x||y+h<=b||b+d<=y);}
    }
    if(index%3===0)assert.equal(new Set(YEAR_LIBRARY.slice(index,index+3).flatMap(s=>s.targets.map(t=>t.concept))).size,36);
  }
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
    assert.equal(stats.touched,13140);assert.equal(stats.remembered,mixed?8760:13140);assert.equal(stats.concepts,36);
  }
});
test('self-review intervals: early rehearsal does not postpone due date; again returns after ten minutes; invalid restore fails',async()=>{
  const {emptyPractice,YEAR_LIBRARY,finishPractice,validatePractice}=await import('../public/dlang/library.mjs');
  const now=new Date(2026,0,1,12).getTime(),first=YEAR_LIBRARY[0],id=first.targets[0].concept;
  let state=finishPractice(emptyPractice(),first,{[id]:true},'hi',now);
  assert.equal(state.reviews[id].due,now+86400000);
  const second=YEAR_LIBRARY.find(s=>s!==first&&s.targets.some(t=>t.concept===id));
  state=finishPractice(state,second,{[id]:true},'hi',now+1000);
  assert.equal(state.reviews[id].stage,0);assert.equal(state.reviews[id].due,now+86400000);
  const third=YEAR_LIBRARY.find(s=>s!==first&&s!==second&&s.targets.some(t=>t.concept===id));
  state=finishPractice(state,third,{[id]:true},'hi',now+86400000);
  assert.equal(state.reviews[id].stage,1);assert.equal(state.reviews[id].due,now+4*86400000);
  const fourth=YEAR_LIBRARY.find(s=>![first,second,third].includes(s)&&s.targets.some(t=>t.concept===id));
  state=finishPractice(state,fourth,{[id]:false},'hi',now+86400001);
  assert.equal(state.reviews[id].stage,0);assert.equal(state.reviews[id].due,now+86400001+600000);
  assert.throws(()=>validatePractice({...state,reviews:[]}));
  assert.throws(()=>validatePractice({...state,attempts:[...state.attempts,state.attempts[0]]}));
});
