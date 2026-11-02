import {BACKEND_ORIGIN} from './bridge-policy.js';
const realFetch=window.fetch.bind(window),pending=new Map();let popup=null,channel=null,connected=false;
const button=document.querySelector('#connectCloud'),connectionStatus=document.querySelector('#pagesConnectionStatus');
const send=message=>popup?.postMessage({...message,channel},BACKEND_ORIGIN);
function disconnect(){connected=false;channel=null;button.textContent='Connect cloud';connectionStatus.textContent='Connect to generate and sync your saved tests.';for(const entry of pending.values())entry.reject(Error('Cloud connection closed. Click Connect cloud.'));pending.clear()}
button.onclick=()=>{if(popup&&!popup.closed){popup.focus();return}disconnect();popup=window.open(BACKEND_ORIGIN+'/pages-bridge.html','image-tester-cloud','popup,width=620,height=600');if(!popup){connectionStatus.textContent='Allow popups for this page, then click Connect cloud.';return}connectionStatus.textContent='Sign in in the cloud window, then return here.'};
window.addEventListener('message',event=>{
 if(event.origin!==BACKEND_ORIGIN||!popup||event.source!==popup)return;
 const message=event.data;if(!message||typeof message.channel!=='string')return;
 if(message.type==='tester-ready'){channel=message.channel;send({type:'tester-connect'});return}
 if(message.channel!==channel)return;
 if(message.type==='tester-connected'){const first=!connected;connected=true;button.textContent='Cloud connected ↗';connectionStatus.textContent='Connected · Keep the cloud window open.';if(first)window.dispatchEvent(new Event('tester-cloud-connected'));return}
 if(message.type==='tester-response'){const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);entry.resolve(new Response(message.body,{status:message.status,headers:{'Content-Type':'application/json'}}))}
});
setInterval(()=>{if(connected&&(!popup||popup.closed))disconnect()},1000);
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin||!url.pathname.includes('/api/'))return realFetch(input,options);
 const path=url.pathname.slice(url.pathname.indexOf('/api/'));
 if(!connected||!popup||popup.closed)throw Error('Click Connect cloud to sign in and enable generation and sync.');
 const id=crypto.randomUUID();
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(Error('Cloud request timed out. Check the connection window before retrying.')),310000);
  const abort=()=>{send({type:'tester-cancel',id});finish(new DOMException('Aborted','AbortError'))};
  const cleanup=()=>{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);pending.delete(id)};
  function finish(error){cleanup();reject(error)}
  if(options.signal?.aborted){abort();return}
  pending.set(id,{resolve:response=>{cleanup();resolve(response)},reject:finish});options.signal?.addEventListener('abort',abort,{once:true});
  send({type:'tester-request',id,path,method:options.method||'GET',body:options.body});
 });
};
await import('./app.js');
