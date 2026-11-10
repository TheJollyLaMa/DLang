const test = require('node:test');
const assert = require('node:assert/strict');
test('five complete seed packs: Devanagari, Simplified Chinese and explicit pinyin study-only policy',async()=>{
  const {PACKS,LANGUAGE_NAMES,LANGUAGE_TAGS}=await import('../public/dlang/packs.mjs');
  const {accepted}=await import('../public/dlang/core.mjs');
  assert.deepEqual(LANGUAGE_TAGS,['en','es','fr','hi','zh-Hans']);
  for(const tag of LANGUAGE_TAGS){
    assert.ok(LANGUAGE_NAMES[tag]);
    assert.deepEqual(Object.keys(PACKS[tag]),Object.keys(PACKS.en));
    for(const entry of Object.values(PACKS[tag]))assert.match(entry.review,/pending/);
  }
  for(const entry of Object.values(PACKS.hi))assert.match(entry.label,/[\u0900-\u097f]/);
  for(const [concept,entry]of Object.entries(PACKS['zh-Hans'])){
    assert.match(entry.label,/\p{Script=Han}/u);
    assert.ok(entry.reading);assert.equal(entry.readingTag,'zh-Latn-pinyin');
    assert.equal(accepted(PACKS['zh-Hans'],concept,entry.label),true);
    assert.equal(accepted(PACKS['zh-Hans'],concept,entry.reading),false);
    assert.equal(accepted(PACKS['zh-Hans'],concept,entry.reading.normalize('NFD').replace(/\p{M}/gu,'')),false);
    assert.ok(entry.aliases.every(alias=>/^\p{Script=Han}+$/u.test(alias)));
  }
  assert.equal(accepted(PACKS.hi,'chair','कुरसी'),true);
  assert.equal(accepted(PACKS.hi,'table','मेज'),true);
  assert.equal(accepted(PACKS.hi,'table','mez'),false);
  assert.equal(accepted(PACKS['zh-Hans'],'lamp','台灯'),true);
  assert.equal(accepted(PACKS['zh-Hans'],'book','書'),false);
});
test('personal links need consent, reject secrets/unsafe URLs, never imply verification; persistence explicit',async()=>{
  const {emptyIdentity,validateIdentity,identityLinks,saveIdentity,IDENTITY_KEY}=await import('../public/dlang/identity.mjs');
  const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const profile={...emptyIdentity(),displayName:'Observer',ensName:'observer.eth',discordId:'123456789012345678',linksConsent:true};
  assert.throws(()=>validateIdentity({...profile,linksConsent:false}),/Consent/);
  for(const ensName of ['javascript:alert(1)','https://example.com','bad/path.eth','<img>.eth','name.eth.evil','é.eth','sub.name.eth'])assert.throws(()=>validateIdentity({...profile,ensName}),/ASCII/);
  for(const discordId of ['access-token','1234','https://discord.com','<script>'])assert.throws(()=>validateIdentity({...profile,discordId}),/17–20/);
  assert.throws(()=>validateIdentity({...profile,secret:'token'}),/Invalid/);
  const links=identityLinks(profile);
  assert.deepEqual(links.map(l=>l.url),['https://app.ens.domains/name/observer.eth','https://discord.com/users/123456789012345678']);
  assert.ok(links.every(l=>l.label.includes('not verified')));
  assert.deepEqual(identityLinks(emptyIdentity()),[]);
  saveIdentity(storage,profile,false);assert.equal(storage.getItem(IDENTITY_KEY),undefined);
  saveIdentity(storage,profile,true);assert.ok(storage.getItem(IDENTITY_KEY));
  saveIdentity(storage,emptyIdentity(),false);assert.equal(storage.getItem(IDENTITY_KEY),undefined);
  assert.throws(()=>saveIdentity({setItem(){throw Error('quota');}},profile,true),/quota/);
});
test('profile image whitelist forbids remote/SVG/javascript content and oversized imports',async()=>{
  const {emptyIdentity,validateIdentity}=await import('../public/dlang/identity.mjs');
  for(const avatar of ['https://example.com/avatar.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,YQ==','data:image/png;base64,%%%'])assert.throws(()=>validateIdentity({...emptyIdentity(),avatar}),/local PNG/);
  assert.throws(()=>validateIdentity({...emptyIdentity(),avatar:'a'.repeat(300000)}),/Invalid avatar/);
  assert.equal(validateIdentity({...emptyIdentity(),avatar:'data:image/png;base64,YQ=='}).avatar,'data:image/png;base64,YQ==');
});
