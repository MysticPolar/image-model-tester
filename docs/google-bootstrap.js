// Google mode: serve the app's /api/* calls from the team Apps Script instead of the Sites popup bridge.
// /api/generate  → action generate (owner's Ark keys stay in Script properties)
// /api/provider  → action status (GET); key changes are refused here (PUT)
// /api/workspace → GET answers locally; PUT diffs runs and sends new rows + files (upload, records)
// /api/records   → action csv (the Sheet's eleven columns)
import {SCRIPT_URL,SHARED_TOKEN,SHEET_URL,FOLDER_URL} from './google-config.js';
import {planSync,emptyState} from './google-sync.js';
const realFetch=window.fetch.bind(window),stateKey='imt-google-sync:'+SCRIPT_URL;
let state=emptyState(),checked=false,pushing=null;
try{state={...emptyState(),...JSON.parse(localStorage.getItem(stateKey)||'{}')}}catch{}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
window.testerBackend={mode:'google',sheetUrl:SHEET_URL,folderUrl:FOLDER_URL};
export async function call(action,payload={},signal){
 if(!SCRIPT_URL)throw Object.assign(Error('Team backend is not configured. Fill public/google-config.js and rebuild.'),{status:503});
 let response;
 // text/plain keeps this a simple request (no preflight); Apps Script answers through a redirect that fetch follows.
 try{response=await realFetch(SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:SHARED_TOKEN,action,...payload}),redirect:'follow',cache:'no-store',signal})}
 catch(error){if(error.name==='AbortError')throw error;throw Object.assign(Error('Could not reach the team backend. Check your connection.'),{status:503})}
 let data;try{data=JSON.parse(await response.text())}catch{throw Object.assign(Error('The team backend returned an unexpected response. Check the Apps Script deployment.'),{status:502})}
 if(!data.ok)throw Object.assign(Error(data.error||'Team backend request failed.'),{status:data.status||500});
 return data;
}
const failure=error=>json({error:error.message||'Team backend request failed.'},error.status||503);
async function pushWorkspace(workspace){
 const {rows,files,nextState}=planSync(workspace.runs||[],state);
 for(const file of files)await call('upload',file);
 for(let i=0;i<rows.length;i+=50)await call('records',{rows:rows.slice(i,i+50)});
 state=nextState;try{localStorage.setItem(stateKey,JSON.stringify(state))}catch{}
 return {revision:state.revision,recordsSaved:true,rows:rows.length,files:files.length};
}
async function handle(path,options){
 const method=(options.method||'GET').toUpperCase();
 try{
  if(path==='/api/workspace'&&method==='GET'){
   if(!checked){await call('status');checked=true}
   return json({revision:state.revision,workspace:null,tester:'',testerAccount:''});
  }
  if(path==='/api/workspace'&&method==='PUT'){
   const {workspace}=JSON.parse(options.body);
   if(!workspace||!Array.isArray(workspace.runs))return json({error:'Invalid workspace format.'},400);
   if(pushing)await pushing.catch(()=>{});
   pushing=pushWorkspace(workspace);
   try{return json(await pushing)}finally{pushing=null}
  }
  if(path==='/api/provider'&&method==='GET'){const status=await call('status');return json({models:status.models,legacyKeyPresent:false,notice:status.notice})}
  if(path==='/api/provider'&&method==='PUT')return json({error:'API keys are managed by the team owner in the Apps Script properties.'},403);
  if(path==='/api/generate'&&method==='POST'){const input=JSON.parse(options.body);const result=await call('generate',{model:input.model,prompt:input.prompt,images:input.images,n:input.n},options.signal);return json({images:result.images,settings:result.settings})}
  if(path==='/api/records'&&method==='GET'){const result=await call('csv');return new Response(result.csv,{status:200,headers:{'Content-Type':'text/csv;charset=utf-8'}})}
  return json({error:'Unknown route.'},404);
 }catch(error){if(error.name==='AbortError')throw error;return failure(error)}
}
window.fetch=(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin||!url.pathname.includes('/api/'))return realFetch(input,options);
 return handle(url.pathname.slice(url.pathname.indexOf('/api/')),options);
};
await import('./app.js');
