import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { activeSession, applyAction, categoryName, createState, csv, itemName, localDate, MAX_QUANTITY, migrateLegacy, quantity, totals, validateState } from '../src/model.js';
import { createStore, loadState, STORAGE_KEY } from '../src/storage.js';
import { interpretVoice } from '../src/voice.js';
const memory = () => { const map = new Map(); return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)}; };
test('legacy migration normalizes quantities, duplicate IDs, missing categories and unsafe images',()=>{
  const state=migrateLegacy({items:[null,{id:'x',qty:'5',name:'One',category:'Custom',image:'" onerror="alert(1)'},{id:'x',qty:-10,name:'Two'}]});
  const s=activeSession(state);assert.equal(s.items.length,2);assert.equal(s.items[0].qty,5);assert.equal(s.items[1].qty,0);assert.notEqual(s.items[0].id,s.items[1].id);assert.equal(s.items[0].image,'');assert.equal(s.items[0].categoryId,s.categories[0].id);validateState(state);
});
test('language change preserves category identity, custom items and customized default names',()=>{
  const state=migrateLegacy({lang:'en',items:[{id:'crateGrnE',name:'My crate',category:'Empty crates',qty:3},{id:'custom',name:'Custom',category:'Empty crates',qty:2}]});
  const next=applyAction(state,{type:'preferences',value:{lang:'lv'}}),s=activeSession(next);
  assert.equal(itemName(s.items[0],'lv'),'My crate');assert.equal(s.items[1].categoryId,s.categories[0].id);assert.equal(categoryName(s.categories[0],'lv'),'Tukšas kastes');assert.equal(totals(s).quantity,5);
});
test('count commands keep immutable valid integers and clamp subtraction to zero',()=>{
  const state=createState(),id=activeSession(state).items[0].id;
  const next=applyAction(state,{type:'count',id,delta:5});assert.equal(activeSession(state).items[0].qty,0);assert.equal(activeSession(next).items[0].qty,5);
  assert.equal(activeSession(applyAction(next,{type:'count',id,delta:-9})).items[0].qty,0);
  for(const value of [NaN,Infinity,-1,0.5,MAX_QUANTITY+1,'oops'])assert.throws(()=>quantity(value));
  assert.throws(()=>applyAction(state,{type:'count',id,delta:1.1}));
});
test('new count retains history and uses local date',()=>{
  let state=createState();const id=activeSession(state).items[0].id;
  state=applyAction(state,{type:'count',id,delta:7});state=applyAction(state,{type:'new-session',name:'Morning'});
  assert.equal(state.sessions.length,2);assert.equal(activeSession(state).name,'Morning');assert.equal(activeSession(state).date,localDate());assert.equal(totals(activeSession(state)).quantity,0);assert.equal(state.sessions[1].items[0].qty,7);
  const local=new Date(2025,0,2,0,15);assert.equal(localDate(local),'2025-01-02');
});
test('explicit zero is stored and spacers do not affect quantity',()=>{
  let state=migrateLegacy({items:[{id:'a',name:'A',qty:0},{id:'gap',spacer:true,qty:8}]});state=applyAction(state,{type:'set',id:'a',value:0});assert.deepEqual(totals(activeSession(state)),{quantity:0});
});
test('reorder accepts a full permutation and move swaps neighbours across categories',()=>{
  let state=createState();
  const ids=activeSession(state).items.map(item=>item.id),reversed=[...ids].reverse();
  state=applyAction(state,{type:'reorder',ids:reversed});assert.deepEqual(activeSession(state).items.map(item=>item.id),reversed);
  assert.throws(()=>applyAction(state,{type:'reorder',ids:reversed.slice(1)}));
  assert.throws(()=>applyAction(state,{type:'reorder',ids:[...reversed.slice(0,-1),reversed[0]]}));
  const first=reversed[0],second=reversed[1];
  state=applyAction(state,{type:'move',id:first,direction:1});
  assert.equal(activeSession(state).items[0].id,second);assert.equal(activeSession(state).items[1].id,first);
});
test('place moves a tile to a grid cell, swapping occupants and materialising gaps',()=>{
  const base=migrateLegacy({items:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'},{id:'d',name:'D'}]});
  const swapped=activeSession(applyAction(base,{type:'place',id:'a',index:3}));
  assert.deepEqual(swapped.items.map(item=>item.id),['d','b','c','a']);
  const dropped=activeSession(applyAction(base,{type:'place',id:'a',index:6}));
  assert.equal(dropped.items.length,7);assert.equal(dropped.items[6].id,'a');
  assert.deepEqual(dropped.items.filter(item=>!item.spacer).map(item=>item.id),['b','c','d','a']);
  assert.equal(dropped.items.filter(item=>item.spacer).length,3);
  assert.throws(()=>applyAction(base,{type:'place',id:'missing',index:0}));
  assert.throws(()=>applyAction(base,{type:'place',id:'a',index:-1}));
});
test('changing tiles per row keeps positions and adds columns on the left',()=>{
  const state=migrateLegacy({items:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'},{id:'d',name:'D'},{id:'e',name:'E'}]});
  const grownState=applyAction(state,{type:'preferences',value:{gridCols:'5'},fromColumns:4}),grown=activeSession(grownState);
  assert.equal(grownState.preferences.gridCols,'5');
  assert.equal(grown.items.length,7);
  assert.deepEqual(grown.items.filter(item=>!item.spacer).map(item=>item.id),['a','b','c','d','e']);
  assert.equal(grown.items[0].spacer,true);
  assert.deepEqual(grown.items.slice(1,5).map(item=>item.id),['a','b','c','d']);
  assert.equal(grown.items[5].spacer,true);
  assert.equal(grown.items[6].id,'e');
  const shrunk=activeSession(applyAction(grownState,{type:'preferences',value:{gridCols:'4'},fromColumns:5}));
  assert.deepEqual(shrunk.items.map(item=>item.id),['a','b','c','d','e']);
  assert.equal(shrunk.items.some(item=>item.spacer),false);
});
test('grid columns and rows accept up to twelve and reject beyond',()=>{
  let state=createState();
  state=applyAction(state,{type:'preferences',value:{gridCols:'12',gridRows:'12'}});
  assert.equal(state.preferences.gridCols,'12');assert.equal(state.preferences.gridRows,'12');
  const fallback=applyAction(state,{type:'preferences',value:{gridCols:'13'}});
  assert.equal(fallback.preferences.gridCols,'auto');
});
test('remove-gap deletes only spacers',()=>{
  const state=migrateLegacy({items:[{id:'a',name:'A'},{id:'gap',spacer:true,qty:0}]});
  assert.deepEqual(activeSession(applyAction(state,{type:'remove-gap',id:'gap'})).items.map(item=>item.id),['a']);
  assert.throws(()=>applyAction(state,{type:'remove-gap',id:'a'}));
});
test('category deletion can preserve items and rename never breaks references',()=>{
  let state=createState();const category=activeSession(state).categories[0];const before=activeSession(state).items.length;
  state=applyAction(state,{type:'save-category',id:category.id,name:'Mine'});assert.equal(activeSession(state).items[0].categoryId,category.id);
  state=applyAction(state,{type:'delete-category',id:category.id});assert.equal(activeSession(state).items.length,before);assert.equal(activeSession(state).items[0].categoryId,null);validateState(state);
});
test('restore rejects missing category references and duplicate session IDs',()=>{
  const state=createState();activeSession(state).items[0].categoryId='missing';assert.throws(()=>validateState(state));
  const duplicate=createState();duplicate.sessions.push(structuredClone(duplicate.sessions[0]));assert.throws(()=>validateState(duplicate));
});
test('CSV escapes quotes and prevents formula-leading names',()=>{
  const state=migrateLegacy({items:[{id:'x',name:'=HYPERLINK("bad")',category:'@evil',qty:3}]});const output=csv(state);assert.ok(output.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(output.includes('"\'@evil"'));assert.ok(output.startsWith('\uFEFF'));
});
test('migration leaves the legacy storage key unchanged',()=>{
  const storage=memory(),raw=JSON.stringify({items:[{id:'x',name:'X',qty:5}]});storage.setItem('countlist.v3',raw);
  const store=createStore(storage,loadState(storage,'en'));store.initialize();assert.equal(storage.getItem('countlist.v3'),raw);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).version,4);
});
test('failed save does not change displayed state, revision or undo history',()=>{
  const storage=memory(),store=createStore(storage,loadState(storage,'en'));store.initialize();const before=structuredClone(store.state);storage.setItem=()=>{throw new Error('Quota exceeded');};
  assert.throws(()=>store.commit(applyAction(store.state,{type:'count',id:activeSession(store.state).items[0].id,delta:2})));assert.deepEqual(store.state,before);assert.equal(store.canUndo,false);
});
test('undo and redo restore the exact count, including after reset',()=>{
  const storage=memory(),store=createStore(storage,loadState(storage,'en'));store.initialize();const id=activeSession(store.state).items[0].id;
  store.commit(applyAction(store.state,{type:'count',id,delta:72}));store.commit(applyAction(store.state,{type:'reset'}));assert.equal(totals(activeSession(store.state)).quantity,0);
  store.undo();assert.equal(totals(activeSession(store.state)).quantity,72);store.redo();assert.equal(totals(activeSession(store.state)).quantity,0);
});
test('a stale tab cannot overwrite an already committed newer revision',()=>{
  const storage=memory(),first=createStore(storage,loadState(storage,'en'));first.initialize();const second=createStore(storage,loadState(storage,'en'));
  first.commit(applyAction(first.state,{type:'count',id:activeSession(first.state).items[0].id,delta:4}));assert.throws(()=>second.commit(applyAction(second.state,{type:'reset'})),/Another tab/);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).sessions[0].items[0].qty,4);
});
test('malformed stored JSON fails explicitly rather than replacing it',()=>{
  const storage=memory();storage.setItem(STORAGE_KEY,'broken');assert.throws(()=>loadState(storage,'en'));assert.equal(storage.getItem(STORAGE_KEY),'broken');
});
test('voice zero is zero in all four languages and ambiguous matches do not count',()=>{
  for(const [lang,text] of [['en','plus zero'],['ru','плюс ноль'],['lv','plus nulle'],['zh','加零']])assert.equal(interpretVoice(text,lang,[]).delta,0);
  assert.equal(interpretVoice('plus five','en',[]).delta,5);
  assert.equal(interpretVoice('plus one hundred five','en',[]).delta,105);
  assert.equal(interpretVoice('plus five Keg 20 L','en',[{id:'keg',name:'Keg 20 L'}]).delta,5);
  assert.equal(interpretVoice('Green crate','en',[{id:'a',name:'Green crate'},{id:'b',name:'Green crate'}]).type,'ambiguous');
});
test('restored quantities and dates reject malformed values',()=>{
  for(const value of [null,true,{},''])assert.throws(()=>quantity(value));
  const state=createState();state.sessions[0].date='2026-02-31';assert.throws(()=>validateState(state));
});
test('offline precache includes every application module and catalog image',()=>{
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const assets=[...sw.matchAll(/'\.\/([^']+)'/g)].map(match=>match[1]);
  for(const asset of assets)assert.ok(existsSync(new URL('../'+asset,import.meta.url)),asset);
  for(const name of ['app','catalog','model','storage','strings','voice'])assert.ok(assets.includes(`src/${name}.js`));
  assert.ok(assets.includes('images/crateGrnGarage.webp'));assert.ok(sw.includes('key.startsWith(CACHE_PREFIX)'));
});
