"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function runtime() {
  const context = { module: { exports: {} }, require: id => id === 'obsidian' ? { Plugin: class {}, PluginSettingTab: class {}, addIcon: () => {}, setIcon: () => {} } : require(id), window: { matchMedia: () => ({ matches: false }) }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') + '\nmodule.exports.helpers = { crispDirectoryEntries, crispRewritePath, crispPaneRatio, crispPaneFolderWidth, crispPaneFolderHeight, crispCollectEntries, crispNewEntryPath, crispListWindow, crispPaneLayout, crispMoveDestination, CrispFolderBrowser, DUAL_PANE_ICON_ID, SINGLE_PANE_ICON_ID };', context);
  return context.module.exports.helpers;
}
test('directory contains all file types, folders first, numeric ordering, no source mutation', () => {
  const { crispDirectoryEntries } = runtime();
  const children = [{name:'10.svg',extension:'svg'}, {name:'2.md',extension:'md'}, {name:'Notes',children:[]}];
  assert.deepEqual(Array.from(crispDirectoryEntries({children}), f=>f.name), ['Notes','2.md','10.svg']);
  assert.equal(children[0].name, '10.svg');
});
test('recent sort keeps folders first and does not need metadata or file contents', () => {
  const { crispDirectoryEntries } = runtime();
  assert.deepEqual(Array.from(crispDirectoryEntries({children:[{name:'a',stat:{mtime:1}},{name:'folder',children:[]},{name:'b',stat:{mtime:5}}]}, 'modified'), f=>f.name), ['folder','b','a']);
});
test('rename/delete remaps only path segments within the affected folder', () => {
  const { crispRewritePath } = runtime();
  assert.equal(crispRewritePath('Core/Notes/a', 'Core/Notes', 'Core/Writing'), 'Core/Writing/a');
  assert.equal(crispRewritePath('Core/Notes2/a', 'Core/Notes', 'X'), 'Core/Notes2/a');
  assert.equal(crispRewritePath('Core/Notes/a', 'Core/Notes', null), 'Core');
});
test('split remains bounded even for invalid or extreme saved ratios', () => {
  const { crispPaneRatio } = runtime();
  assert.equal(crispPaneRatio(NaN), .43);
  assert.equal(crispPaneRatio(Infinity), .43);
  assert.equal(crispPaneRatio(9), .65);
  assert.equal(crispPaneRatio(-2), .3);
});
test('folder width and height remain bounded for invalid or extreme sizes', () => {
  const { crispPaneFolderWidth, crispPaneFolderHeight } = runtime();
  assert.equal(crispPaneFolderWidth(NaN), 200);
  assert.equal(crispPaneFolderWidth(Infinity), 200);
  assert.equal(crispPaneFolderWidth(50), 100);
  assert.equal(crispPaneFolderWidth(1000), 500);
  assert.equal(crispPaneFolderWidth(350, 400), 300);

  assert.equal(crispPaneFolderHeight(NaN), 200);
  assert.equal(crispPaneFolderHeight(Infinity), 200);
  assert.equal(crispPaneFolderHeight(40), 90);
  assert.equal(crispPaneFolderHeight(1000), 450);
});
test('opening an attachment uses the native editor and respects modifier new tabs', () => {
  const { CrispFolderBrowser } = runtime();
  const file={path:'image.svg',extension:'svg'}; const calls=[];
  const browser=Object.create(CrispFolderBrowser.prototype);
  browser.plugin={app:{vault:{getAbstractFileByPath:()=>file},workspace:{getLeaf:mode=>({openFile:f=>{calls.push([mode,f]);return Promise.resolve();}})}}};
  browser.openEntry(file.path); browser.openEntry(file.path,{metaKey:true});
  assert.equal(calls[0][0],false); assert.equal(calls[1][0],'tab'); assert.equal(calls[0][1],file);
});
test('selecting a nonexistent folder never clears current navigation', () => {
  const { CrispFolderBrowser } = runtime();
  const browser=Object.create(CrispFolderBrowser.prototype);
  browser.selectedPath='Core'; browser.folder=()=>null;
  assert.equal(browser.selectFolder('missing'),false); assert.equal(browser.selectedPath,'Core');
});
test('unrelated workspace refresh updates active state without replacing rows or scroll', () => {
  const { CrispFolderBrowser } = runtime();
  const browser=Object.create(CrispFolderBrowser.prototype);
  const win={}; const doc={defaultView:win}; let updates=0;
  Object.assign(browser,{destroyed:false,win,doc,nativeContainer:{ownerDocument:doc},enabled:true,dirty:false,plugin:{settings:{dualPaneEnabled:true}},folder:()=>({children:[]}),rail:{refresh(){}},syncActiveFile(){updates++;},renderTree(){throw Error('unnecessary tree render');},renderDirectory(){throw Error('unnecessary list render');}});
  browser.refresh(); assert.equal(updates,1);
});

test('flat view includes descendant notes and canvases once without attachments or folders', () => {
  const { crispCollectEntries }=runtime();
  const root={children:[{name:'b.md',extension:'md'},{name:'sub',children:[{name:'a.md',extension:'md'},{name:'c.canvas',extension:'canvas'},{name:'image.png',extension:'png'}]}]};
  assert.deepEqual(Array.from(crispCollectEntries(root,'name',true),x=>x.name),['a.md','b.md','c.canvas']);
  assert.equal(root.children.length,2);
});
test('new entry paths reject traversal and preserve Markdown suffixes', () => {
  const { crispNewEntryPath }=runtime();
  assert.equal(crispNewEntryPath('Core','Note.md',true),'Core/Note.md');
  assert.equal(crispNewEntryPath('','Note',true),'Note.md');
  for(const bad of ['../x','a/b','a\\b','..','', 'x: y']) assert.throws(()=>crispNewEntryPath('Core',bad,true));
});
test('large directories have bounded DOM windows including last row', () => {
  const { crispListWindow }=runtime();
  const first=crispListWindow(10000,0,700,38);
  const last=crispListWindow(10000,9999*38,700,38);
  assert.ok(first.end-first.start<50);assert.equal(last.end,10000);assert.ok(last.start>9900);
});
test('auto orientation uses hysteresis and respects explicit preference', () => {
  const { crispPaneLayout }=runtime();
  assert.equal(crispPaneLayout('auto',280,'horizontal'),'vertical');
  assert.equal(crispPaneLayout('auto',380,'vertical'),'vertical');
  assert.equal(crispPaneLayout('auto',450,'vertical'),'horizontal');
  assert.equal(crispPaneLayout('horizontal',200,'vertical'),'horizontal');
});
test('moving files refuses collisions, folders and no-op moves', () => {
  const { crispMoveDestination }=runtime();
  const file={path:'a/n.md',name:'n.md'}; const folder={path:'b',children:[]};
  assert.equal(crispMoveDestination(file,folder,{getAbstractFileByPath:()=>null}),'b/n.md');
  assert.equal(crispMoveDestination(file,{path:'a',children:[]},{getAbstractFileByPath:()=>file}),null);
  assert.throws(()=>crispMoveDestination(file,folder,{getAbstractFileByPath:()=>({})}));
  assert.throws(()=>crispMoveDestination({path:'a',name:'a',children:[]},folder,{getAbstractFileByPath:()=>null}));
});

test('an ended native drag cannot move a previously dragged file on an external drop', () => {
  const { CrispFolderBrowser }=runtime();
  const file={path:'a.md'};const browser=Object.create(CrispFolderBrowser.prototype);
  browser.plugin={draggedFile:file,app:{dragManager:{draggable:null},vault:{getAbstractFileByPath:()=>file}}};
  assert.equal(browser.getDraggedFile(),null);
  browser.plugin.app.dragManager.draggable={file};assert.equal(browser.getDraggedFile(),file);
});

test('handleListKey opens focused entry in new tab with Cmd+Enter or Ctrl+Enter', () => {
  const { CrispFolderBrowser } = runtime();
  const file = { path: 'Note.md', extension: 'md' };
  const calls = [];
  const browser = Object.create(CrispFolderBrowser.prototype);
  browser.focusedEntryPath = file.path;
  browser.entries = [file];
  browser.plugin = { app: { vault: { getAbstractFileByPath: () => file }, workspace: { getLeaf: mode => ({ openFile: f => { calls.push([mode, f]); return Promise.resolve(); } }) } } };

  let prevented = false; let stopped = false;
  const metaEvent = { key: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: { closest: () => null }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } };
  browser.handleListKey(metaEvent);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'tab');
  assert.equal(calls[0][1], file);

  prevented = false; stopped = false;
  const ctrlEvent = { key: 'Enter', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, target: { closest: () => null }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } };
  browser.handleListKey(ctrlEvent);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'tab');
});

test('dual-pane custom icon IDs are defined', () => {
  const { DUAL_PANE_ICON_ID, SINGLE_PANE_ICON_ID } = runtime();
  assert.equal(DUAL_PANE_ICON_ID, 'crisp-fe-dual-pane');
  assert.equal(SINGLE_PANE_ICON_ID, 'crisp-fe-single-pane');
});

test('browser setSize sets pixel styles and saves settings', () => {
  const { CrispFolderBrowser } = runtime();
  const browser = Object.create(CrispFolderBrowser.prototype);
  const styles = {};
  const attrs = {};
  browser.shell = {
    style: { setProperty: (k, v) => { styles[k] = v; } },
    getBoundingClientRect: () => ({ width: 500, height: 400 })
  };
  browser.separator = {
    setAttribute: (k, v) => { attrs[k] = v; }
  };
  let saved = false;
  browser.plugin = {
    settings: {},
    saveSettings: () => { saved = true; }
  };

  browser.setSize(240, 190);
  assert.equal(browser.folderWidth, 240);
  assert.equal(browser.folderHeight, 190);
  assert.equal(styles['--crisp-fe-folder-width'], '240px');
  assert.equal(styles['--crisp-fe-folder-height'], '190px');
  assert.equal(attrs['aria-valuenow'], '240');

  browser.saveSize();
  assert.equal(browser.plugin.settings.dualPaneFolderWidth, 240);
  assert.equal(browser.plugin.settings.dualPaneFolderHeight, 190);
  assert.equal(saved, true);
});

test('handleTreeKey and handleListKey invoke rename and deletion for focused items', () => {
  const { CrispFolderBrowser } = runtime();
  const folder = { path: 'Core', name: 'Core', children: [] };
  const file = { path: 'Core/Note.md', name: 'Note.md', extension: 'md' };
  const renames = [];
  const deletions = [];

  const browser = Object.create(CrispFolderBrowser.prototype);
  browser.selectedPath = 'Core';
  browser.treeRows = new Map([['Core', { dataset: { folderPath: 'Core' } }]]);
  browser.focusedEntryPath = file.path;
  browser.entries = [file];
  browser.plugin = {
    app: {
      vault: {
        getAbstractFileByPath: p => (p === 'Core' ? folder : p === file.path ? file : null),
      },
      fileManager: {
        promptForFileRename: f => { renames.push(f); return Promise.resolve(); },
        promptForDeletion: f => { deletions.push(f); return Promise.resolve(); },
      }
    }
  };
  browser.runAction = fn => Promise.resolve(fn());

  let p1 = false;
  browser.handleTreeKey({ key: 'F2', target: { closest: () => null }, preventDefault: () => { p1 = true; }, stopPropagation: () => {} });
  assert.equal(p1, true);
  assert.equal(renames[0], folder);

  let p2 = false;
  browser.handleTreeKey({ key: 'Backspace', metaKey: true, target: { closest: () => null }, preventDefault: () => { p2 = true; }, stopPropagation: () => {} });
  assert.equal(p2, true);
  assert.equal(deletions[0], folder);

  let p3 = false;
  browser.handleListKey({ key: 'F2', target: { closest: () => null }, preventDefault: () => { p3 = true; }, stopPropagation: () => {} });
  assert.equal(p3, true);
  assert.equal(renames[1], file);

  let p4 = false;
  browser.handleListKey({ key: 'Backspace', metaKey: true, target: { closest: () => null }, preventDefault: () => { p4 = true; }, stopPropagation: () => {} });
  assert.equal(p4, true);
  assert.equal(deletions[1], file);

  let p5 = false;
  browser.handleListKey({ key: 'Delete', target: { closest: () => null }, preventDefault: () => { p5 = true; }, stopPropagation: () => {} });
  assert.equal(p5, true);
  assert.equal(deletions[2], file);
});

