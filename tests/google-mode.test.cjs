const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const sync=import('../public/google-sync.js');
const png='data:image/png;base64,aGVsbG8=',jpg='data:image/jpeg;base64,d29ybGQ=';
const fixture=()=>[{id:'abcdef0123456789',date:'2026-11-02T04:00:00.000Z',tester:'Tester A',prompt:'Image 1 wearing Image 2',count:1,mode:'parallel',refs:[{name:'face.png',data:png},{name:'jacket.jpg',data:jpg}],results:[{name:'Seedream 5.0 Pro',config:{model:'doubao-seedream-5-0-pro-260628',provider:'volcengine',endpoint:'/api/generate'},status:'done',images:[png]},{name:'Seedream 5.0 Flash',config:{model:'doubao-seedream-5-0-flash-260915',provider:'volcengine',endpoint:'/api/generate'},status:'error',error:'HTTP 429',images:[]}]}];

test('planSync sends every record once, uploads images once, and re-sends only changed rows',async()=>{
 const {planSync,emptyState}=await sync,runs=fixture();
 const first=planSync(runs,emptyState());
 assert.equal(first.rows.length,2);assert.deepEqual(Object.keys(first.rows[0]),['record_id','paths','input','prompt','outputs','model used','review','开源/闭源','tester','status','test date']);
 assert.equal(first.rows[0].record_id,'abcdef0123456789:1');assert.equal(first.rows[0].paths,'1.1');assert.equal(first.rows[1].status,'error');
 const paths=first.files.map(f=>f.path);
 assert.equal(paths.filter(p=>p.endsWith('.png')||p.endsWith('.jpg')).length,3,'two references and one output');
 assert.equal(paths.filter(p=>p.endsWith('prompt.txt')).length,1);assert.equal(paths.filter(p=>p.endsWith('record.json')).length,2);
 assert.ok(first.files.find(f=>f.path.endsWith('prompt.txt')).text==='Image 1 wearing Image 2');
 assert.equal(first.nextState.revision,'1');
 const again=planSync(runs,first.nextState);assert.equal(again.rows.length,0);assert.equal(again.files.length,0);assert.equal(again.nextState.revision,'1');
 runs[0].results[0].humanReview={type:'human',name:'Reviewer',verdict:'pass',score:4,notes:'ok'};
 const changed=planSync(runs,first.nextState);assert.equal(changed.rows.length,1);assert.ok(changed.rows[0].review.includes('Reviewer: Reviewer'));
 assert.deepEqual(changed.files.map(f=>path.basename(f.path)),['record.json'],'no image or prompt re-upload for a review edit');
 runs[0].results[1].status='done';runs[0].results[1].images.push(jpg);
 const output=planSync(runs,changed.nextState);assert.equal(output.rows.length,1);assert.deepEqual(output.files.map(f=>f.path.split('/').at(-2)+'/'+path.basename(f.path)),['outputs/001.jpg','002_Seedream_5_0_Flash/record.json']);
});

function loadBootstrap(calls,answers){
 const source=fs.readFileSync(path.join(root,'public/google-bootstrap.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace("await import('./app.js');",'');
 const fetchMock=async(url,options)=>{if(url!=='https://script.example/exec')return new Response('passthrough',{status:200});const body=JSON.parse(options.body);calls.push({body,headers:options.headers,redirect:options.redirect});const answer=answers[body.action]?.(body)||{ok:false,status:400,error:'unhandled '+body.action};return new Response(JSON.stringify(answer),{status:200})};
 const store={};
 const context={window:{fetch:fetchMock},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}},location:{origin:'https://mysticpolar.github.io',href:'https://mysticpolar.github.io/image-model-tester/'},Response,URL,Object,JSON,Error,Array,Number,String,console,SCRIPT_URL:'https://script.example/exec',SHARED_TOKEN:'secret-token',SHEET_URL:'https://docs.google.com/spreadsheets/d/x',FOLDER_URL:'https://drive.google.com/drive/folders/y'};
 return sync.then(mod=>{context.planSync=mod.planSync;context.emptyState=mod.emptyState;vm.runInNewContext(source,context);return context});
}

test('google bootstrap maps /api routes onto token-authenticated Apps Script actions',async()=>{
 const calls=[],answers={status:()=>({ok:true,status:200,models:{pro:{connected:true,suffix:'ab12'},flash:{connected:false,suffix:''}},notice:'Owner keys'}),upload:()=>({ok:true,status:200,id:'f'}),records:body=>({ok:true,status:200,inserted:body.rows.length}),generate:body=>body.model.includes('flash')?{ok:false,status:503,error:'Flash key missing'}:{ok:true,status:200,images:[png],settings:{model:body.model}},csv:()=>({ok:true,status:200,csv:'﻿"paths"\r\n'})};
 const ctx=await loadBootstrap(calls,answers),fetch=ctx.window.fetch;
 assert.equal(ctx.window.testerBackend.mode,'google');
 assert.equal(await (await fetch('https://elsewhere.test/x')).text(),'passthrough','non-API URLs are untouched');
 let response=await fetch('/api/workspace',{cache:'no-store'});let result=await response.json();
 assert.equal(response.status,200);assert.equal(result.workspace,null);assert.equal(calls.length,1);assert.equal(calls[0].body.action,'status');assert.equal(calls[0].body.token,'secret-token');assert.equal(calls[0].headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(calls[0].redirect,'follow');
 await fetch('/api/workspace');assert.equal(calls.length,1,'later GETs answer locally');
 response=await fetch('/api/provider');result=await response.json();assert.equal(result.models.pro.suffix,'ab12');assert.equal(result.notice,'Owner keys');
 response=await fetch('/api/provider',{method:'PUT',body:'{"keys":{"pro":"x"}}'});assert.equal(response.status,403);
 response=await fetch('/api/workspace',{method:'PUT',body:JSON.stringify({workspace:{runs:fixture()},revision:null})});result=await response.json();
 assert.equal(response.status,200);assert.equal(result.recordsSaved,true);assert.equal(result.rows,2);assert.equal(result.files,6);
 const actions=calls.map(c=>c.body.action);assert.equal(actions.filter(a=>a==='upload').length,6);assert.equal(actions.filter(a=>a==='records').length,1);assert.ok(actions.indexOf('records')>actions.lastIndexOf('upload'),'files are uploaded before rows are written');
 const before=calls.length;response=await fetch('/api/workspace',{method:'PUT',body:JSON.stringify({workspace:{runs:fixture()},revision:'1'})});result=await response.json();assert.equal(calls.length,before,'unchanged workspace sends nothing');assert.equal(result.revision,'1');
 response=await fetch('/api/generate',{method:'POST',body:JSON.stringify({model:'doubao-seedream-5-0-pro-260628',prompt:'p',images:[png],n:1})});result=await response.json();assert.equal(response.status,200);assert.deepEqual(result.images,[png]);assert.deepEqual(calls.at(-1).body.images,[png]);
 response=await fetch('/api/generate',{method:'POST',body:JSON.stringify({model:'doubao-seedream-5-0-flash-260915',prompt:'p',images:[],n:1})});assert.equal(response.status,503);assert.equal((await response.json()).error,'Flash key missing');
 response=await fetch('/api/records');assert.equal(response.headers.get('Content-Type'),'text/csv;charset=utf-8');const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[0xEF,0xBB,0xBF],'CSV keeps its UTF-8 BOM (app.js downloads it as a blob, not text)');assert.equal(new TextDecoder().decode(bytes.slice(3)),'"paths"\r\n');
 response=await fetch('/api/unknown');assert.equal(response.status,404);
});

test('judge CLI parses flags, validates submissions, and builds briefs without the human review',async()=>{
 const cli=await import('../scripts/judge.mjs');
 assert.deepEqual(cli.parseArgs(['submit','abc:1','--verdict','pass','--score','4','--notes','fine','--force']),{positional:['submit','abc:1'],flags:{verdict:'pass',score:'4',notes:'fine',force:true}});
 const settings={url:'https://script.example/exec',token:'t'};
 const calls=[];const fetcher=async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({ok:true,status:200,record_id:'abc:1'}))};
 await assert.rejects(cli.submit(['abc:1'],{verdict:'maybe'},settings),/pass, fail, or needs-review/);
 await assert.rejects(cli.submit(['abc:1'],{verdict:'pass',score:'7'},settings),/between 0 and 5/);
 const original=globalThis.fetch;globalThis.fetch=fetcher;try{await cli.submit(['abc:1'],{verdict:'needs-review',score:'3',notes:'n',model:'Test model'},settings)}finally{globalThis.fetch=original}
 assert.equal(calls[0].action,'judge');assert.equal(calls[0].token,'t');assert.equal(calls[0].score,3);assert.equal(calls[0].rubric,'v1');assert.equal(calls[0].model,'Test model');assert.equal(calls[0].force,false);
 const text=cli.brief({record_id:'abc:1',path:'3.1',model:'Seedream 5.0 Pro',tester:'A',date:'2026-11-02',prompt:'Image 1 in Image 2 style',review:'pass\nReviewer: Human'},[{kind:'input',path:'tests/r/references/001_a.png',file:'/tmp/j/input-1-001_a.png'},{kind:'output',path:'tests/r/models/001_m/outputs/001.png',file:'/tmp/j/output-1-001.png'}]);
 assert.ok(text.includes('Image 1 in Image 2 style'));assert.ok(text.includes('input-1-001_a.png'));assert.ok(text.includes('output-1-001.png'));assert.ok(!text.includes('Reviewer: Human'),'brief never leaks the human review');
});

test('Pages build switches to the Google bootstrap only when a script URL is configured',async()=>{
 const config=fs.readFileSync(path.join(root,'public/google-config.js'),'utf8');
 const build=fs.readFileSync(path.join(root,'scripts/build-pages.mjs'),'utf8');
 assert.ok(build.includes('google-bootstrap.js')&&build.includes('pages-bootstrap.js'));
 assert.ok(/SCRIPT_URL='[^']*'/.test(config));
 for(const name of ['google-bootstrap.js','google-sync.js','google-config.js'])assert.ok(fs.existsSync(path.join(root,'public',name)));
 assert.ok(fs.existsSync(path.join(root,'apps-script/Code.gs')));assert.ok(fs.existsSync(path.join(root,'judge/rubric.md')));assert.ok(fs.existsSync(path.join(root,'.claude/skills/judge/SKILL.md')));
 const gas=fs.readFileSync(path.join(root,'apps-script/Code.gs'),'utf8');
 assert.ok(gas.includes("'paths','input','prompt','outputs','model used','judge','review','开源/闭源','tester','status','test date','record_id'"));
 assert.ok(!/ARK_KEY_(PRO|FLASH)\s*=\s*'[^']+'/.test(gas),'no keys in source');
});
