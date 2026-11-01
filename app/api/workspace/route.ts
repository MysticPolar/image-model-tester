import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 const user=await getChatGPTUser();if(!user)return reply({error:'Sign in with ChatGPT to access your workspace.'},401);
 const bucket=(env as unknown as {BUCKET:R2Bucket}).BUCKET;if(!bucket)return reply({error:'Cloud storage is unavailable.'},503);
 const object=await bucket.get('workspaces/'+encodeURIComponent(user.userId)+'.json');
 return reply({revision:object?.etag||null,workspace:object?await object.json():null});
}
export async function PUT(request:Request){
 const user=await getChatGPTUser();if(!user)return reply({error:'Sign in with ChatGPT to save your workspace.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Invalid request origin.'},403);
 const bucket=(env as unknown as {BUCKET:R2Bucket}).BUCKET;if(!bucket)return reply({error:'Cloud storage is unavailable.'},503);
 if(Number(request.headers.get('content-length')||0)>50*1024*1024)return reply({error:'Workspace exceeds the 50 MB cloud limit. Download older runs to back them up.'},413);
 try{
 const raw=await request.text();if(raw.length>50*1024*1024)return reply({error:'Workspace exceeds the 50 MB cloud limit.'},413);
 const {workspace,revision}=JSON.parse(raw);
 if(!workspace||!Array.isArray(workspace.refs)||!Array.isArray(workspace.models)||!Array.isArray(workspace.runs)||!Array.isArray(workspace.selected)||typeof workspace.prompt!=='string')return reply({error:'Invalid workspace format.'},400);
 const object=await bucket.put('workspaces/'+encodeURIComponent(user.userId)+'.json',JSON.stringify(workspace),{httpMetadata:{contentType:'application/json'},onlyIf:revision?{etagMatches:revision}:{etagDoesNotMatch:'*'}});
 if(!object)return reply({error:'This workspace changed on another device. Reload from cloud before making further changes.'},409);
 return reply({revision:object.etag});
 }catch{return reply({error:'Could not save this workspace. Try again.'},500)}
}
