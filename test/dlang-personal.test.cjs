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
test('clean profile migration, ENS artwork ownership, image overrides and local persistence',async()=>{
  const {emptyIdentity,validateIdentity,migrateIdentity,resolveArtwork,saveIdentity,IDENTITY_KEY,imageURL}=await import('../public/dlang/identity.mjs');
  const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  const profile={...emptyIdentity(),displayName:'Observer',ensName:'observer.eth'};
  for(const ensName of ['javascript:alert(1)','https://example.com','bad/path.eth','<img>.eth','name.eth.evil','é.eth'])assert.throws(()=>validateIdentity({...profile,ensName}),/ASCII/);
  assert.throws(()=>validateIdentity({...profile,secret:'token'}),/Invalid/);
  saveIdentity(storage,profile);assert.ok(storage.getItem(IDENTITY_KEY));
  assert.throws(()=>saveIdentity({setItem(){throw Error('quota');}},profile),/quota/);
  assert.equal(migrateIdentity({version:1,displayName:'Old',ensName:'old.eth',linksConsent:true,avatar:''}).version,2);
  assert.equal(imageURL('ipfs://bafyexample/a.png'),'https://ipfs.io/ipfs/bafyexample/a.png');
  for(const value of ['javascript:alert(1)','http://evil.test/image','https://user:secret@example.com/p'])assert.throws(()=>imageURL(value));
  const wallet='0x'+'1'.repeat(40);
  const provider={lookupAddress:async()=> 'observer.eth',resolveName:async()=>wallet,getResolver:async()=>({getAvatar:async()=> 'https://example.org/avatar.png',getText:async key=>key==='banner'?'ipfs://bafyexample/banner.png':''})};
  assert.deepEqual(await resolveArtwork(wallet,'',provider),{ensName:'observer.eth',avatar:'https://example.org/avatar.png',banner:'https://ipfs.io/ipfs/bafyexample/banner.png'});
  await assert.rejects(resolveArtwork('0x'+'2'.repeat(40),'observer.eth',provider),/connected wallet/);
});
test('profile image whitelist forbids remote/SVG/javascript content and oversized imports',async()=>{
  const {emptyIdentity,validateIdentity}=await import('../public/dlang/identity.mjs');
  for(const avatar of ['https://example.com/avatar.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,YQ==','data:image/png;base64,%%%'])assert.throws(()=>validateIdentity({...emptyIdentity(),avatar}),/local PNG/);
  assert.throws(()=>validateIdentity({...emptyIdentity(),avatar:'a'.repeat(300000)}),/Invalid avatar/);
  assert.equal(validateIdentity({...emptyIdentity(),avatar:'data:image/png;base64,YQ=='}).avatar,'data:image/png;base64,YQ==');
});
