import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),output=path.join(root,'docs');
// Google mode when public/google-config.js names an Apps Script deployment; otherwise the Sites popup bridge.
const config=await import(pathToFileURL(path.join(root,'public/google-config.js')).href),google=!!config.SCRIPT_URL;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await mkdir(output,{recursive:true});
let html=await readFile(path.join(root,'public/workbench.html'),'utf8');
html=html.replace('href="/"','href="./"').replace('<script type="module" src="app.js"></script>',`<script type="module" src="${google?'google-bootstrap.js':'pages-bootstrap.js'}"></script>`);
const link=(href,label)=>href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`:'';
const section=google
 ?`<section class="pagesconnection"><div><strong>Team tester</strong><p id="pagesConnectionStatus">Records save to the team Google Sheet and images to the shared Drive folder. No sign-in needed.</p></div><div class="teamlinks">${link(config.SHEET_URL,'Open Sheet')}${link(config.FOLDER_URL,'Open images')}</div></section>`
 :`<section class="pagesconnection"><div><strong>GitHub Pages tester</strong><p id="pagesConnectionStatus">Connect to generate and sync your saved tests.</p></div><button id="connectCloud" class="primary">Connect cloud</button></section>`;
html=html.replace('</header>','</header>'+section);
await writeFile(path.join(output,'index.html'),html);
const files=google?['app.js','style.css','records-core.js','google-bootstrap.js','google-sync.js','google-config.js','favicon.svg']:['app.js','style.css','records-core.js','pages-bootstrap.js','bridge-policy.js','favicon.svg'];
for(const file of files)await copyFile(path.join(root,'public',file),path.join(output,file));
await writeFile(path.join(output,'.nojekyll'),'');
console.log(`GitHub Pages files built in docs/ (${google?'Google team backend':'Sites popup bridge'})`);
