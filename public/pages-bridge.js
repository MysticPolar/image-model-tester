import {PAGES_ORIGIN,allowedBridgeRequest} from './bridge-policy.js';
const parent=window.opener,status=document.querySelector('#bridgeStatus'),channel=crypto.randomUUID();
const send=message=>parent?.postMessage({...message,channel},PAGES_ORIGIN);
const active=new Map();let connected=false;
if(!parent)status.textContent='Open this connection using “Connect cloud” in the GitHub Pages tester.';
window.addEventListener('message',async event=>{
 if(!parent||event.source!==parent||event.origin!==PAGES_ORIGIN||event.data?.channel!==channel)return;
 const message=event.data;
 if(message.type==='tester-connect'){connected=true;status.textContent='Connected. Return to the GitHub Pages tester. Keep this window open.';send({type:'tester-connected'});return}
 if(!connected)return;
 if(message.type==='tester-cancel'){active.get(message.id)?.abort();return}
 if(message.type!=='tester-request'||typeof message.id!=='string'||!allowedBridgeRequest(message.path,message.method))return;
 if(active.has(message.id))return;
 const controller=new AbortController();active.set(message.id,controller);
 try{
  if(message.body!=null&&(typeof message.body!=='string'||message.body.length>50*1024*1024))throw Error('Request too large.');
  const response=await fetch(message.path,{method:message.method,headers:{'Content-Type':'application/json'},body:message.method==='GET'?undefined:message.body,credentials:'same-origin',cache:'no-store',signal:controller.signal});
  send({type:'tester-response',id:message.id,status:response.status,body:await response.text()});
 }catch(error){send({type:'tester-response',id:message.id,status:503,body:JSON.stringify({error:error.name==='AbortError'?'Request cancelled.':'Cloud request failed. Check the connection window.'})})}
 finally{active.delete(message.id)}
});
// Repeat the handshake until the opener is ready. No workspace or credential data is sent here.
const hello=setInterval(()=>{if(connected||!parent||parent.closed){clearInterval(hello);return}send({type:'tester-ready'})},1000);
send({type:'tester-ready'});
