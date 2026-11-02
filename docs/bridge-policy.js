export const PAGES_ORIGIN='https://mysticpolar.github.io';
export const BACKEND_ORIGIN='https://image-model-tester-yuhao.yuhaoguo.chatgpt.site';
export function allowedBridgeRequest(path,method){
 if(typeof path!=='string'||typeof method!=='string')return false;
 return (path==='/api/workspace'&&['GET','PUT'].includes(method))||(path==='/api/provider'&&['GET','PUT'].includes(method))||(path==='/api/generate'&&method==='POST');
}
