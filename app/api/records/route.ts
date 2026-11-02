import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { archivePrefix, archiveRecords } from '../../../lib/records';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const headers={'Cache-Control':'private, no-store'};
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Sign in to access test records.'},{status:401,headers});
  const bucket=(env as unknown as {BUCKET:R2Bucket}).BUCKET;
  try {
    const object=await bucket.get('workspaces/'+encodeURIComponent(user.userId)+'.json');
    if(!object)return Response.json({error:'No saved workspace yet.'},{status:404,headers});
    const path=new URL(request.url).searchParams.get('file')||'test-records.csv';
    if(path!=='test-records.csv'&&!/^tests\/[a-zA-Z0-9_/-]+\.(png|jpg|webp|txt|json)$/.test(path))return Response.json({error:'Invalid file path.'},{status:400,headers});
    const prefix=archivePrefix(user.userId),image=/\.(png|jpg|webp)$/.test(path);
    const key=prefix+(image?'assets/':`revisions/v2/${object.etag}/`)+path;
    let file=await bucket.get(key);
    if(!file){await archiveRecords(bucket,user.userId,object.etag,await object.json());file=await bucket.get(key);}
    if(!file)return Response.json({error:'File not found.'},{status:404,headers});
    return new Response(file.body,{headers:{...headers,'Content-Type':file.httpMetadata?.contentType||'application/octet-stream','Content-Disposition':`attachment; filename="${path.split('/').at(-1)}"`,'X-Content-Type-Options':'nosniff'}});
  }catch{return Response.json({error:'Could not load the saved records. Try again.'},{status:503,headers});}
}
