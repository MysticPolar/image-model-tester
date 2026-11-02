import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { providerStatus,saveProviderKey,type ProviderEnv } from '../../../lib/volcengine';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){const user=await getChatGPTUser();if(!user)return reply({error:'Sign in to configure your API key.'},401);try{return reply(await providerStatus(env as unknown as ProviderEnv,user.userId))}catch{return reply({error:'Provider storage unavailable.'},503)}}
export async function PUT(request:Request){
 const user=await getChatGPTUser();if(!user)return reply({error:'Sign in to configure API keys.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Invalid origin.'},403);
 const raw=await request.text();if(raw.length>8192)return reply({error:'Invalid API keys.'},400);
 let keys;try{keys=JSON.parse(raw).keys}catch{return reply({error:'Invalid request.'},400)}
 if(!keys||typeof keys!=='object'||Array.isArray(keys)||!Object.keys(keys).length||Object.keys(keys).some(slot=>!['pro','flash'].includes(slot)))return reply({error:'Provide keys for Pro and/or Flash.'},400);
 for(const [slot,key] of Object.entries(keys))if(typeof key!=='string'||key.trim().length<12||key.length>2048||/\s/.test(key.trim()))return reply({error:'Enter a valid '+slot+' Ark API key without the Bearer prefix.'},400);
 try{for(const [slot,key] of Object.entries(keys)){const model=slot==='pro'?'doubao-seedream-5-0-pro-260628':'doubao-seedream-5-0-flash-260915';await saveProviderKey(env as unknown as ProviderEnv,user.userId,model,(key as string).trim())}return reply(await providerStatus(env as unknown as ProviderEnv,user.userId))}catch{return reply({error:'Could not save API keys. Check encryption configuration and retry.'},503)}
}
