// Pure planning for Google mode: which Sheet rows and Drive files still need to be sent.
// Shared by the browser (google-bootstrap.js) and the tests. No network, no DOM, no credentials.
import {recordRows,reportRows,referencePaths,outputPaths,runFolder} from './records-core.js';

export const fnv=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)};
export const emptyState=()=>({revision:'0',records:{},files:{}});

// state: {revision, records:{record_id:hash}, files:{path:true}} → {rows, files, nextState}
// Rows carry the eleven report columns plus record_id; the judge column is dropped because the Sheet owns it.
export function planSync(runs,state=emptyState()){
 const rows=[],files=[],seenFile=new Set(),nextState={revision:state.revision,records:{...state.records},files:{...state.files}};
 const file=(path,entry)=>{if(nextState.files[path]||seenFile.has(path))return;seenFile.add(path);files.push({path,...entry})};
 const details=recordRows(runs),report=reportRows(runs);let position=0;
 for(const run of runs||[]){
  const refPaths=referencePaths(run);
  (run.results||[]).forEach((item,index)=>{
   const detail=details[position],row={record_id:detail.record_id,...report[position]};position++;delete row.judge;
   const hash=fnv(JSON.stringify(row));
   (run.refs||[]).forEach((ref,i)=>{if(/^data:image\//.test(ref.data||''))file(refPaths[i],{data:ref.data})});
   outputPaths(run,item,index).forEach((path,i)=>file(path,{data:item.images[i]}));
   if(state.records[detail.record_id]===hash)return;
   file(`${runFolder(run)}/prompt.txt`,{text:run.prompt||''});
   files.push({path:detail.metadata_path,text:JSON.stringify(detail,null,2)});
   rows.push(row);nextState.records[detail.record_id]=hash;
  });
 }
 for(const f of files)nextState.files[f.path]=true;
 if(rows.length||files.length)nextState.revision=String(Number(state.revision||0)+1);
 return {rows,files,nextState};
}
