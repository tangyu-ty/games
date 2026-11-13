import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const order=['geometry','armory','enemies','levels','story','audio','ai','game','render','ui','input','main'];
let code='// DEAD CIRCUIT — original, self-contained browser game.\n';
for(const name of order){
 let source=await readFile(path.join(root,name+'.js'),'utf8');
 const exports=[...source.matchAll(/^export\s+(?:const|let|class|function)\s+([\w$]+)/gm)].map(m=>m[1]);
 for(const m of source.matchAll(/^export\s*\{([^}]+)\};?/gm))exports.push(...m[1].split(',').map(x=>x.trim()).filter(Boolean));
 source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)\.js['"];?\s*$/gm,(_,names,mod)=>`const {${names}}=__dc_${mod};`);
 source=source.replace(/^export\s*\{[^}]+\};?\s*$/gm,'').replace(/^export\s+(?=(?:const|let|class|function)\s)/gm,'');
 if(/^import\s/m.test(source))throw Error('Unhandled import in '+name);
 code+=`\nconst __dc_${name}=(()=>{\n${source}\nreturn {${[...new Set(exports)].join(',')}};\n})();\n`;
}
let html=await readFile(path.join(root,'index.html'),'utf8');
const css=await readFile(path.join(root,'style.css'),'utf8');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`).replace('<script type="module" src="main.js"></script>',`<script type="module">${code.replace(/<\/script/gi,'<\\/script')}</script>`);
const out=path.resolve(root,'../dist/deadcircuit.html');await mkdir(path.dirname(out),{recursive:true});await writeFile(out,html);console.log(`DEAD CIRCUIT standalone: ${Buffer.byteLength(html)} bytes → dist/deadcircuit.html`);
