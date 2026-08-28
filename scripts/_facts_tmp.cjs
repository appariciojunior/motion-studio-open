const path=require('path');const Module=require('module');
const root=path.join(__dirname,'..');
const orig=Module._resolveFilename;
Module._resolveFilename=function(req,...a){ if(req.startsWith('@/')) req=path.join(root,req.slice(2)); return orig.call(this,req,...a); };
require('sucrase/register');
const t=require('../templates');
const byGroup={};
for(const x of t.templateList){ const g=x.meta.group; (byGroup[g]=byGroup[g]||[]).push(x.meta.id+':'+x.meta.name); }
for(const g of Object.keys(byGroup).sort()) console.log(g+' ('+byGroup[g].length+')\n  '+byGroup[g].join('\n  '));
