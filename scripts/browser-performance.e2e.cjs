"use strict";
// Failure cases: expansion mounts thousands of rows/ticks; keyboard navigation
// stops at a window boundary; reveal/resize leaves gaps; collapse keeps stale
// scroll height; dragging cannot reach unmounted folders; scrolling at either
// edge stops orb rotation; a stationary pointer spins; teardown leaks fixtures.
// Real Obsidian renderer, synthetic folders only. No settings or files saved.
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { createHash } = require('node:crypto');
async function probe() {
  const plugin = app.plugins.plugins['crisp-file-explorer'];
  const exemplar = [...plugin.folderBrowsers.values()][0];
  const doc = exemplar.doc, win = doc.defaultView, focus = doc.activeElement;
  const wait = ms => new Promise(r => win.setTimeout(r, ms));
  // Electron may throttle background rAF independently from timers. Sample
  // actual rendered frames so a delayed frame is not mistaken for no motion.
  const frames = count => new Promise((resolve, reject) => {
    let frame;
    const timeout = win.setTimeout(() => { win.cancelAnimationFrame(frame); reject(Error("Renderer frames did not advance")); }, 10000);
    const step = () => {
      if (--count <= 0) { win.clearTimeout(timeout); resolve(); }
      else frame = win.requestAnimationFrame(step);
    };
    frame = win.requestAnimationFrame(step);
  });
  const root = doc.createElement('div');
  root.className = 'workspace-leaf-content'; root.dataset.type = 'file-explorer';
  root.dataset.crispBrowserPerformance = 'true';
  root.style.cssText = 'position:fixed;left:20px;top:20px;width:560px;height:620px;display:flex;flex-direction:column;z-index:-1';
  const header = root.appendChild(doc.createElement('div')); header.className = 'nav-header';
  header.appendChild(doc.createElement('div')).className = 'nav-buttons-container';
  const native = root.appendChild(doc.createElement('div')); native.className = 'nav-files-container';
  const files = new Map();
  const folder = path => { const f = {path,name:path.split('/').at(-1)||'E2E',children:[]}; files.set(path,f); return f; };
  const vaultRoot = folder('');
  for(let i=0;i<80;i++) { const parent=folder(`P-${String(i).padStart(2,'0')}`); vaultRoot.children.push(parent);
    for(let j=0;j<64;j++) parent.children.push(folder(`${parent.path}/C-${String(j).padStart(2,'0')}`)); }
  const fake = Object.create(plugin);
  fake.settings = {...plugin.settings,dualPaneEnabled:true,dualPaneFollowActive:false,dualPaneDescendants:false,
    dualPaneLayout:'horizontal',dualPaneFolderWidth:200,orbStyle:'soccer',soundEnabled:false,releaseSoundEnabled:false,
    autoExpandFoldersOnDrag:false,openOnDragRelease:true};
  fake.app = {scope:app.scope,keymap:app.keymap,vault:{getRoot:()=>vaultRoot,getName:()=> 'E2E',getAbstractFileByPath:p=>files.get(p)},
    workspace:{getActiveFile:()=>null,trigger(){}},fileManager:{}};
  fake.getTodayPathSet = fake.getFrequentPathSet = fake.getPinnedPathSet = () => new Set();
  fake.enableDocument = fake.scheduleRefresh = fake.lockInteraction = () => {};
  fake.saveSettings = () => Promise.resolve(); fake.folderBrowsers = new Map();
  const checks=[]; const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
  let browser; doc.body.appendChild(root);
  const pointer=(target,type,y)=>target.dispatchEvent(new win.PointerEvent(type,{pointerId:54321,isPrimary:true,button:0,clientY:y,bubbles:true,cancelable:true}));
  const key=value=>doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  const measure = action => { const start=performance.now(); action(); browser.rail.refresh({immediate:true});
    browser.tree.getBoundingClientRect(); return performance.now()-start; };
  try {
    browser = new exemplar.constructor(fake,native); fake.folderBrowsers.set(native,browser); await wait(200);
    const expandMs = measure(()=>browser.foldAllButton.click()); await wait(150);
    const renderedRows=browser.treeRows.size, renderedTicks=browser.rail.ticks.children.length;
    check('expand keeps DOM bounded with 5200 folders',renderedRows<100&&renderedTicks<250,{renderedRows,renderedTicks,expandMs});
    check('expand and layout finish within 500ms',expandMs<500,{expandMs});
    check('rail covers all folders',browser.rail.items.length===5200,{items:browser.rail.items.length});
    browser.focusTree(); key('End'); await wait(100);
    check('End reaches the final unmounted folder',doc.activeElement?.dataset.folderPath==='P-79/C-63',{path:doc.activeElement?.dataset.folderPath});
    key('Home'); await wait(100);
    check('Home returns to the first folder',doc.activeElement?.dataset.folderPath==='P-00',{path:doc.activeElement?.dataset.folderPath});
    browser.selectFolder('P-52/C-40',true); browser.focusTree(); await wait(100);
    const row=browser.treeRows.get('P-52/C-40'), r=row?.getBoundingClientRect(), box=browser.tree.getBoundingClientRect();
    check('reveal mounts and scrolls to a distant selection',r&&r.top>=box.top&&r.bottom<=box.bottom,{top:r?.top,bottom:r?.bottom,boxTop:box.top,boxBottom:box.bottom});
    key('ArrowDown'); await wait(80);
    check('ArrowDown uses complete tree order',browser.selectedPath==='P-52/C-41',{path:browser.selectedPath});
    const rail=browser.rail;
    check('fixture uses a rotating soccer orb', !!rail.orbBall && rail.orb.dataset.orbStyle === 'soccer', {style:rail.orb.dataset.orbStyle,ball:!!rail.orbBall});
    for(const direction of [1,-1]) {
      browser.tree.scrollTop=direction===1?1000:3000; browser.renderTreeWindow?.(); rail.refresh({immediate:true}); await wait(80);
      const box=browser.tree.getBoundingClientRect();
      pointer(rail.orb,'pointerdown',box.top+box.height/2); await wait(60);
      pointer(win,'pointermove',direction===1?box.bottom-2:box.top+2); await frames(4);
      const s=browser.tree.scrollTop, angle=rail.orbRotation;
      await frames(6);
      check(`edge ${direction} scrolls and rolls while held`,direction*(browser.tree.scrollTop-s)>20&&Math.abs(rail.orbRotation-angle)>5,
        {scrollDelta:browser.tree.scrollTop-s,rotationDelta:rail.orbRotation-angle,dragging:rail.isDragging});
      pointer(win,'pointermove',box.top+box.height/2); await wait(100);
      const still=rail.orbRotation; await wait(150);
      check(`edge ${direction} stops spinning when scrolling stops`,rail.orbRotation===still,{before:still,after:rail.orbRotation});
      pointer(win,'pointerup',box.top+box.height/2); await wait(80);
      check(`edge ${direction} release selects the landed folder`,browser.selectedPath===rail.items[rail.visualActiveIndex]?.path,{selected:browser.selectedPath});
    }
    root.style.height='340px'; await wait(150);
    browser.tree.scrollTop=browser.tree.scrollHeight; await wait(100);
    check('resize and bottom scrolling keep bounded rows and ticks',browser.treeRows.size<100&&browser.rail.ticks.children.length<250,{rows:browser.treeRows.size,ticks:browser.rail.ticks.children.length});
    const collapseMs=measure(()=>browser.foldAllButton.click()); await wait(100);
    check('collapse resets model and scroll extent',browser.rail.items.length===80&&browser.tree.scrollHeight<4000,{items:browser.rail.items.length,scrollHeight:browser.tree.scrollHeight,collapseMs});
    check('collapse finishes within 500ms',collapseMs<500,{collapseMs});
    // The actual host vault is read only here, to compare against the original report.
    fake.app.vault={getRoot:()=>app.vault.getRoot(),getName:()=>app.vault.getName(),getAbstractFileByPath:p=>app.vault.getAbstractFileByPath(p)};
    browser.selectedPath=''; browser.expanded=new Set(['']); browser.renderTree();
    const realExpandMs=measure(()=>browser.foldAllButton.click()); await wait(150);
    check('actual vault expand stays bounded and below 500ms',realExpandMs<500&&browser.treeRows.size<100&&browser.rail.ticks.children.length<250,
      {folders:browser.rail.items.length,rows:browser.treeRows.size,ticks:browser.rail.ticks.children.length,realExpandMs});
    const realCollapseMs=measure(()=>browser.foldAllButton.click());
    check('actual vault collapse finishes within 500ms',realCollapseMs<500,{realCollapseMs});
  } finally { browser?.destroy(); root.remove(); if(focus?.isConnected) focus.focus({preventScroll:true}); }
  check('fixture and drag loops are removed',!root.isConnected&&!browser.rail.frame&&!browser.rail.dragScrollFrame);
  return JSON.stringify({checks,pass:checks.every(c=>c.pass)});
}
const output=process.argv.find(v=>v.startsWith('--output='))?.slice(9);
const vault=process.env.CRISP_E2E_VAULT;
const raw=execFileSync('obsidian',[...(vault?[`vault=${vault}`]:[]),'eval',`code=(${probe.toString()})()`],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
const line=raw.split('\n').find(v=>v.startsWith('=> ')); if(!line)throw Error(raw);
const result=JSON.parse(line.slice(3)); result.checkedAt=new Date().toISOString();
result.sourceSha256=createHash('sha256').update(readFileSync(resolve(__dirname,'../main.js'))).digest('hex');
if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
