import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('.',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const modules=[['storage.js',['loadProfile','loadSettings','loadVoyage']],['render.js',['Renderer']],['audio.js',['AudioManager']],['content.js',['STAGES','INTRO','ENDING','UPGRADES','portraitSVG']],['story.js',['CAMPAIGN','CAMPAIGN_INTRO','CAMPAIGN_ENDINGS']],['campaign-engine.js',['CampaignEngine']],['campaign.js',['installCampaign']]];
let bundle='(()=>{\n\"use strict\";\n';
for(const [file,names] of modules){const src=(await read(file)).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');bundle+=`const {${names.join(',')}}=(()=>{\n${src}\nreturn {${names.join(',')}};\n})();\n`;}
bundle+=(await read('main.js')).replace(/^import .*;\n/gm,'')+'\n})();';
bundle=bundle.replace(/<\/script/gi,'<\\/script');
const readCss=await read('styles.css');
const html=(await read('index.html')).replace('<link rel="stylesheet" href="styles.css">',()=>'<style>\n'+readCss+'\n</style>');
const complete=html.replace('<script type="module" src="main.js"></script>',()=>'<script>\n'+bundle+'\n</script>');
await mkdir(new URL('dist/',root),{recursive:true});
const out=new URL('dist/tidekeeper.html',root);
await writeFile(out,complete);
console.log(`Built ${fileURLToPath(out)} (${Math.round(Buffer.byteLength(complete)/1024)} KB), fully self-contained.`);
