#!/usr/bin/env node
// Judge CLI for the team backend (apps-script/Code.gs). Used by the /judge skill; also usable by hand.
//   node scripts/judge.mjs list [--limit 20]
//   node scripts/judge.mjs pull [--limit 5] [--out .judge]
//   node scripts/judge.mjs submit <record_id> --verdict pass|fail|needs-review [--score 4] [--notes "..."] [--model "..."] [--rubric v1] [--force]
//   node scripts/judge.mjs csv > test-records.csv
// Configuration: IMT_SCRIPT_URL and IMT_TOKEN, else public/google-config.js.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));

export function parseArgs(argv){
 const positional=[],flags={};
 for(let i=0;i<argv.length;i++){const arg=argv[i];if(!arg.startsWith('--')){positional.push(arg);continue}const next=argv[i+1];if(next!==undefined&&!next.startsWith('--')){flags[arg.slice(2)]=next;i++}else flags[arg.slice(2)]=true}
 return {positional,flags};
}
export async function config(){
 if(process.env.IMT_SCRIPT_URL)return {url:process.env.IMT_SCRIPT_URL,token:process.env.IMT_TOKEN||''};
 const settings=await import(pathToFileURL(path.join(root,'public/google-config.js')).href);
 if(!settings.SCRIPT_URL)throw Error('Set IMT_SCRIPT_URL and IMT_TOKEN, or fill public/google-config.js first.');
 return {url:settings.SCRIPT_URL,token:settings.SHARED_TOKEN};
}
export async function call(action,payload={},settings,fetcher=fetch){
 const {url,token}=settings||await config();
 const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token,action,...payload}),redirect:'follow'});
 const text=await response.text();let data;
 try{data=JSON.parse(text)}catch{throw Error('Unexpected response from the team backend: '+text.slice(0,200))}
 if(!data.ok)throw Error(data.error||'Team backend request failed.');
 return data;
}
export const safeId=id=>String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
export function brief(record,files){
 const list=kind=>files.filter(f=>f.kind===kind).map((f,i)=>`${i+1}. ${path.basename(f.file)}  (${f.path})`).join('\n')||'(none)';
 return `# Record ${record.record_id} — path ${record.path}\n\nModel: ${record.model}\nTester: ${record.tester||'not recorded'}\nTest date: ${record.date}\n\n## Prompt\n\n${record.prompt}\n\n## Reference images (in prompt order)\n\n${list('input')}\n\n## Output images\n\n${list('output')}\n\nJudge against judge/rubric.md. Do not read the human review column.\n`;
}
export async function pull(flags,settings){
 const out=path.resolve(flags.out||'.judge'),limit=Number(flags.limit)||5;
 const {records,total}=await call('list',{limit},settings),pulled=[];
 for(const record of records){
  const dir=path.join(out,safeId(record.record_id));await mkdir(dir,{recursive:true});
  const files=[];
  for(const [kind,paths] of [['input',record.input],['output',record.outputs]])for(const [i,p] of paths.entries()){
   const file=await call('file',{path:p},settings),target=path.join(dir,`${kind}-${i+1}-${path.basename(p)}`);
   await writeFile(target,Buffer.from(file.data,'base64'));files.push({kind,path:p,file:target});
  }
  await writeFile(path.join(dir,'brief.md'),brief(record,files));
  await writeFile(path.join(dir,'record.json'),JSON.stringify({...record,files},null,2));
  pulled.push({record_id:record.record_id,path:record.path,dir,brief:path.join(dir,'brief.md'),inputs:files.filter(f=>f.kind==='input').map(f=>f.file),outputs:files.filter(f=>f.kind==='output').map(f=>f.file)});
 }
 return {total,pulled:pulled.length,remaining:total-pulled.length,records:pulled};
}
export async function submit(positional,flags,settings){
 const record_id=positional[0];if(!record_id)throw Error('Usage: submit <record_id> --verdict pass|fail|needs-review [--score 0-5] [--notes "..."]');
 if(!['pass','fail','needs-review'].includes(flags.verdict))throw Error('--verdict must be pass, fail, or needs-review.');
 const score=flags.score===undefined?'':Number(flags.score);
 if(score!==''&&!(score>=0&&score<=5))throw Error('--score must be between 0 and 5.');
 return call('judge',{record_id,verdict:flags.verdict,score,notes:String(flags.notes||''),model:flags.model||process.env.IMT_JUDGE_MODEL||'Claude Code',rubric:flags.rubric||'v1',force:!!flags.force},settings);
}
async function main(){
 const {positional:[command,...rest],flags}=parseArgs(process.argv.slice(2));
 switch(command){
  case 'list':{const result=await call('list',{limit:Number(flags.limit)||20});console.log(JSON.stringify(result,null,2));break}
  case 'pull':console.log(JSON.stringify(await pull(flags),null,2));break;
  case 'submit':console.log(JSON.stringify(await submit(rest,flags),null,2));break;
  case 'csv':process.stdout.write((await call('csv')).csv);break;
  default:console.error('Usage: judge.mjs list|pull|submit|csv (see the header of this file).');process.exit(2);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exit(1)});
