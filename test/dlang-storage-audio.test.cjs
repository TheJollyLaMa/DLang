const test=require('node:test');
const assert=require('node:assert/strict');
const CID='bafy'+'a'.repeat(52),CID2='bafy'+'b'.repeat(52);
function memory(){const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),data};}
test('shared upload uses exact Decent authorization protocol, trusted Pinata URL, public form and byte-checked recovery',async()=>{
  const {createStorage,digest}=await import('../public/dlang/storage.mjs');
  const blob=new Blob(['public acceptance fixture'],{type:'application/json'}),calls=[];let message;
  const ipfs=createStorage({storage:memory(),origin:'https://thejollylama.github.io',signer:async()=>({getAddress:async()=>'0x'+'A'.repeat(40),signMessage:async text=>{message=text;return'fixture-signature';}}),fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/health'))return Response.json({ok:true,ipfsProvider:'pinata'});
    if(url.endsWith('/upload-url'))return Response.json({url:'https://uploads.pinata.cloud/v3/files/fixture'});
    if(url.includes('uploads.pinata.cloud')){assert.equal(options.body.get('network'),'public');assert.equal(await options.body.get('file').text(),await blob.text());return Response.json({data:{cid:CID}});}
    return new Response(blob);
  }});
  assert.match((await ipfs.check()).detail,/No write has been tested/);
  const result=await ipfs.upload(blob,'fixture.json');
  assert.equal(result.cid,CID);assert.equal(result.sha256,await digest(await ipfs.read(CID)));
  const body=JSON.parse(calls.find(c=>c.url.endsWith('/upload-url')).options.body);
  assert.equal(message,['DecentBusking IPFS upload authorization',`Wallet: ${body.address.toLowerCase()}`,`Origin: ${body.origin}`,'File: fixture.json',`Size: ${blob.size}`,'Type: application/json',`Issued At: ${body.issuedAt}`].join('\n'));
  assert.ok(calls.every(c=>c.options.credentials==='omit'));
});
test('personal Pinata credentials stay in tab memory; local Kubo, gateway size cap and rejected provider/destination paths',async()=>{
  const {createStorage,endpoint,cid}=await import('../public/dlang/storage.mjs');
  const storage=memory(),calls=[],jwt='public-fixture-not-a-real-credential';
  const ipfs=createStorage({storage,signer:async()=>null,fetchImpl:async(url,options)=>{
    calls.push({url,options});if(url.includes('/version'))return Response.json({Version:'0.33'});
    if(url.includes('add?'))return Response.json({Hash:CID});
    if(url.includes('testAuthentication'))return Response.json({message:'Authenticated'});
    if(url.includes('pinFile'))return Response.json({IpfsHash:CID});return new Response('123456');
  }});
  ipfs.configure({provider:'pinata',api:'http://localhost:5002',gateway:'https://ipfs.io/ipfs'},jwt);
  await ipfs.check();await ipfs.upload(new Blob(['x']),'public.txt');
  assert.ok(calls.filter(c=>c.options.headers?.Authorization).every(c=>new URL(c.url).host==='api.pinata.cloud'));
  assert.ok(!JSON.stringify([...storage.data]).includes(jwt));
  const restored=createStorage({storage,signer:async()=>null});await assert.rejects(restored.check(),/JWT/);
  ipfs.configure({...ipfs.settings,provider:'local'});await ipfs.check();assert.equal((await ipfs.upload(new Blob(['x']),'x')).cid,CID);
  await assert.rejects(ipfs.read(CID,5),/size limit/);
  for(const url of ['http://evil.example','https://user:pass@example.com','https://example.com?token=bad'])assert.throws(()=>endpoint(url,true));
  assert.throws(()=>cid('../secret'));assert.throws(()=>ipfs.configure({...ipfs.settings,provider:'unknown'}));
  const bad=createStorage({storage:memory(),signer:async()=>({getAddress:async()=>'0x'+'1'.repeat(40),signMessage:async()=> 'fixture'}),fetchImpl:async()=>Response.json({url:'https://evil.example/upload'})});
  await assert.rejects(bad.upload(new Blob(['x']),'x'),/Untrusted/);
});
test('community library requires unique steward approval, bounded recordings and native/public license declarations; voices rotate',async()=>{
  const {validateVoice,validateVoices,nextVoice}=await import('../public/dlang/audio.mjs');
  const voice={version:1,language:'hi',concept:'chair',speaker:'Fixture speaker',license:'CC-BY-4.0',type:'audio/webm',duration:2,size:123,cid:CID,sha256:'a'.repeat(64),nativeSpeakerDeclared:true};
  assert.equal(validateVoice(voice),voice);
  assert.throws(()=>validateVoices({version:1,voices:[voice]}),/approval/);
  const first={...voice,approved:true,reviewedBy:'Fluent steward',reviewedAt:'2026-01-01T12:00:00Z'},second={...first,cid:CID2};
  const voices=validateVoices({version:1,voices:[first,second]});
  assert.equal(nextVoice(voices,'hi','chair').cid,CID);assert.equal(nextVoice(voices,'hi','chair',CID).cid,CID2);assert.equal(nextVoice(voices,'hi','chair',CID2).cid,CID);
  assert.equal(nextVoice(voices,'en','chair'),null);
  for(const patch of [{nativeSpeakerDeclared:false},{license:'private'},{duration:16},{size:1048577},{sha256:'wrong'},{type:'text/html'},{concept:'unknown'}])assert.throws(()=>validateVoice({...voice,...patch}));
  assert.throws(()=>validateVoices({version:1,voices:[first,first]}));
});
test('steward import requires explicit fluent audition and verifies metadata CID, audio hash and duplicate refusal',async()=>{
  const {approveVoice}=await import('../scripts/approve-voice.mjs');
  const {digest}=await import('../public/dlang/storage.mjs');
  const blob=new Blob(['public fixture audio bytes'],{type:'audio/webm'});
  const metadata={version:1,language:'en',concept:'chair',speaker:'Fixture',license:'CC-BY-4.0',type:'audio/webm',duration:1,size:blob.size,cid:CID,sha256:await digest(blob),nativeSpeakerDeclared:true};
  const ipfs={read:async value=>value===CID2?new Blob([JSON.stringify(metadata)]):blob};
  const args={metadataCID:CID2,reviewer:'Fluent fixture reviewer',ipfs,manifest:{version:1,voices:[]}};
  await assert.rejects(approveVoice(args),/audition/);
  const result=await approveVoice({...args,auditioned:true});assert.equal(result.voices[0].approved,true);assert.equal(result.voices[0].metadataCID,CID2);
  await assert.rejects(approveVoice({...args,auditioned:true,manifest:result}),/approval/);
  await assert.rejects(approveVoice({...args,auditioned:true,ipfs:{read:async value=>value===CID2?new Blob([JSON.stringify(metadata)]):new Blob(['corrupt'])}}),/do not match/);
});
