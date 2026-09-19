import { LANGS } from './catalog.js';
import { activeSession, applyAction, categoryName, createState, csv, itemName, migrateLegacy, quantity, totals, validateState } from './model.js';
import { createStore, loadState, STORAGE_KEY } from './storage.js';
import { translate } from './strings.js';
import { interpretVoice } from './voice.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
let store, blocked = false, selected = null, reordering = false, filter = '', detailId = null, toastTimer, recognition = null, pendingImport = null, waitingWorker = null;
const lang = () => store?.state.preferences.lang || 'en';
const t = key => translate(lang(), key);
const number = value => Number(value).toLocaleString(LANGS[lang()]?.locale || 'en');
const session = () => activeSession(store.state);
const nameOf = item => itemName(item, lang());
const categoryOf = category => categoryName(category, lang());
const dialog = $('dialog');
let storage;
try { storage = window.localStorage; }
catch { storage = { getItem:()=>null, setItem:()=>{throw new Error('Device storage is unavailable. Enable site storage before counting.');} }; }
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3600); }
function failure(error) { $('warning').textContent = error.message; $('warning').hidden = false; $('save-status').textContent = 'Change not saved'; $('status-dot').style.background = 'var(--danger)'; const field = $('dialog-error'); if (field) field.textContent = error.message; }
function status() { if (!$('warning').hidden) return; $('save-status').textContent = t(navigator.onLine ? 'saved' : 'offline'); $('status-dot').style.background = ''; }
function commit(action) {
  if (blocked) { notify(t('recovery')); return false; }
  try {
    store.commit(applyAction(store.state, action)); $('warning').hidden = true;
    if (action.type === 'count' || action.type === 'set') renderCounts(); else render();
    status(); return true;
  } catch (error) { failure(error); return false; }
}
function count(id, delta) {
  selected = id;
  if (commit({ type:'count', id, delta })) {
    const tile = [...document.querySelectorAll('.tile')].find(tile => tile.dataset.id === id);
    tile?.classList.remove('bump'); requestAnimationFrame(() => tile?.classList.add('bump'));
    navigator.vibrate?.(8);
  }
}
function applyPreferences() {
  const p = store.state.preferences, root = document.documentElement;
  root.lang = p.lang;
  root.dataset.theme = p.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p.theme;
  root.dataset.accent = p.accent; root.dataset.contrast = p.contrast;
  $('grid').style.setProperty('--grid-direction', p.gridDir);
  if (p.gridCols === 'auto') $('grid').style.removeProperty('--columns'); else $('grid').style.setProperty('--columns', p.gridCols);
  $('grid').style.setProperty('--custom-tile-font', ({ sm:'10px', md:'12px', lg:'16px' })[p.textSize]);
  $('grid').style.setProperty('--custom-quantity-font', ({ sm:'16px', md:'20px', lg:'27px' })[p.qtySize]);
  if (p.rowFit === 'auto') $('grid').style.removeProperty('--custom-tile-picture-height');
  else $('grid').style.setProperty('--custom-tile-picture-height', `${Math.max(40, Math.floor((innerHeight - 290) / Number(p.rowFit)) - 65)}px`);
  document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === 'light' ? '#f7f8f2' : root.dataset.theme === 'oled' ? '#000000' : '#101512';
}
function render() {
  applyPreferences();
  for (const [id,key] of Object.entries({ 'sessions-button':'sessions', 'new-button':'newCount', 'collection-title':'yourItems', 'gesture-hint':'hint', 'add-button':'add', 'total-label':'total', 'selected-label':'selected', empty:'empty' })) $(id).textContent = t(key);
  $('undo-button').innerHTML = `↶ <span>${escape(t('undo'))}</span>`;
  document.querySelector('[data-action="settings"]').setAttribute('aria-label',t('settings.title'));
  $('redo-button').setAttribute('aria-label',t('redo'));
  $('reorder-button').setAttribute('aria-label',t('move'));
  $('search').placeholder = t('search'); $('search').setAttribute('aria-label',t('search'));
  $('reorder-button').setAttribute('aria-pressed',String(reordering));
  $('session-name').textContent = session().name || t('untitled');
  $('date').textContent = new Date(session().date + 'T12:00:00').toLocaleDateString(LANGS[lang()]?.locale, { day:'numeric',month:'long',year:'numeric' });
  renderGrid(); renderCounts(); status();
}
function renderGrid() {
  const groups = [{ id:null, name:t('ungrouped') }, ...session().categories];
  let visible = 0;
  $('grid').innerHTML = groups.map(category => {
    const items = session().items.filter(item => item.categoryId === category.id && (!filter || (!item.spacer && nameOf(item).toLocaleLowerCase().includes(filter))));
    if (!items.some(item => !item.spacer)) return '';
    visible += items.filter(item => !item.spacer).length;
    return `<section class="category"><div class="category-header" style="text-align:${store.state.preferences.catAlign}"><h2>${escape(category.id ? categoryOf(category) : category.name)}</h2><span><strong data-category-total="${escape(category.id || '')}">0</strong></span></div><div class="tiles">${items.map(item => item.spacer ? `<div class="tile spacer" aria-hidden="true"></div>` : `<article class="tile" data-id="${escape(item.id)}"><button class="count-button" data-action="count" data-id="${escape(item.id)}" aria-label="${escape(nameOf(item))}: +1"><span class="tile-picture">${item.image ? `<img src="${escape(item.image)}" alt="" draggable="false">` : '<span class="tile-placeholder">▤</span>'}</span><span class="tile-bottom"><span class="tile-name">${escape(nameOf(item))}</span><span class="tile-quantity">${number(item.qty)}</span></span></button><button class="tile-menu" data-action="details" data-id="${escape(item.id)}" aria-label="${escape(t('details') + ': ' + nameOf(item))}">···</button>${reordering ? `<div class="tile-order"><button data-action="move-up" data-id="${escape(item.id)}" aria-label="Move earlier">←</button><button data-action="move-down" data-id="${escape(item.id)}" aria-label="Move later">→</button></div>` : ''}</article>`).join('')}</div></section>`;
  }).join('');
  $('empty').hidden = visible > 0;
}
function renderCounts() {
  const sums = totals(session()); $('total').textContent = number(sums.quantity);
  $('progress-label').textContent = `${sums.counted} / ${sums.items} ${t('checked')}`;
  $('progress-bar').style.width = `${sums.items ? sums.counted / sums.items * 100 : 0}%`;
  $('undo-button').disabled = !store.canUndo; $('redo-button').disabled = !store.canRedo;
  for (const tile of document.querySelectorAll('.tile[data-id]')) {
    const item = session().items.find(item => item.id === tile.dataset.id);
    tile.querySelector('.tile-quantity').textContent = number(item.qty);
    tile.classList.toggle('checked', item.counted); tile.classList.toggle('selected', item.id === selected);
  }
  for (const element of document.querySelectorAll('[data-category-total]')) element.textContent = number(session().items.filter(item => !item.spacer && (item.categoryId || '') === element.dataset.categoryTotal).reduce((sum,item) => sum + item.qty,0));
  const item = session().items.find(item => item.id === selected && !item.spacer);
  $('quick-bar').hidden = !item;
  if (item) { $('selected-name').textContent = nameOf(item); $('selected-qty').textContent = number(item.qty); }
  const detail = session().items.find(item => item.id === detailId);
  if (detail && $('detail-qty')) $('detail-qty').value = detail.qty;
}
function open(title, content) {
  $('dialog-title').textContent = title; $('dialog-content').innerHTML = content + '<p id="dialog-error" class="dialog-error" role="alert"></p>';
  if (!dialog.open) dialog.showModal();
}
function close() { dialog.close(); detailId = null; }
const button = (action,label,css='',id='') => `<button type="button" data-action="${action}" data-id="${escape(id)}" class="${css}">${escape(label)}</button>`;
function confirm(title, hint, action, id='') { open(title, `<p>${escape(hint)}</p><div class="actions">${button('close',t('cancel'))}${button(action,t('confirm'),'primary',id)}</div>`); }
function details(id) {
  const item = session().items.find(item => item.id === id); if (!item) return;
  selected = id; detailId = id; renderCounts();
  open(nameOf(item), `<form id="quantity-form" class="form-stack"><label>${escape(t('quantity'))}<input id="detail-qty" class="counter-input" type="number" inputmode="numeric" min="0" max="999999999" step="1" required value="${item.qty}"></label><div class="counter-controls">${button('detail-minus','−1')}${button('detail-zero','0')}${button('detail-plus','+1')}</div><button class="primary" type="submit">${escape(t('set'))}</button></form><form id="bulk-form" class="bulk-panel"><label>${escape(t('bulk'))}</label><div class="bulk-inputs"><label>${escape(t('perRow'))}<input id="per-row" type="number" inputmode="numeric" min="1" max="999" required value="8"></label><span>×</span><label>${escape(t('rows'))}<input id="rows" type="number" inputmode="numeric" min="1" max="999" required value="9"></label></div><div id="bulk-result" class="bulk-result">+72</div><div class="actions"><button type="submit" class="primary">${escape(t('calc.add'))}</button>${button('edit-item',t('edit'),'',id)}</div></form>`);
}
function itemEditor(id) {
  const item = session().items.find(item => item.id === id);
  detailId = null;
  open(t(item ? 'editor.editItem' : 'add'), `<form id="item-form" data-id="${escape(id || '')}" class="form-stack"><label>${escape(t('name'))}<input name="name" required maxlength="160" value="${escape(item ? nameOf(item) : '')}"></label><label>${escape(t('categories'))}<select name="categoryId"><option value="">${escape(t('ungrouped'))}</option>${session().categories.map(category => `<option value="${escape(category.id)}" ${item?.categoryId === category.id ? 'selected' : ''}>${escape(categoryOf(category))}</option>`).join('')}</select></label><div class="actions">${item ? button('delete-item',t('remove'),'danger',id) : ''}<button type="submit" class="primary">${escape(t('editor.save'))}</button></div></form>`);
}
function categories() {
  open(t('categories'), `<div>${session().categories.map(category => `<div class="category-row"><span>${escape(categoryOf(category))}</span>${button('edit-category',t('edit'),'',category.id)}${button('delete-category',t('remove'),'danger',category.id)}</div>`).join('')}</div><div class="actions">${button('add-category',t('cats.add'),'primary')}</div>`);
}
function categoryEditor(id) {
  const category = session().categories.find(category => category.id === id);
  open(t(category ? 'editor.editCategory' : 'editor.newCategory'), `<form id="category-form" data-id="${escape(id || '')}" class="form-stack"><label>${escape(t('name'))}<input name="name" required maxlength="160" value="${escape(category ? categoryOf(category) : '')}"></label><button type="submit" class="primary">${escape(t('editor.save'))}</button></form>`);
}
function settings() {
  const p = store.state.preferences;
  const select = (key,label,options) => `<label>${escape(t(label))}<select name="${key}">${options.map(([value,text]) => `<option value="${value}" ${p[key] === value ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
  const option = values => values.map(value => [value,t('settings.' + value)]);
  open(t('settings.title'), `<form id="settings-form"><div class="settings-grid">${select('lang','settings.language',[['en','English'],['lv','Latviešu'],['ru','Русский'],['zh','中文']])}${select('theme','settings.theme',[['auto',t('settings.themeAuto')],['light',t('settings.themeLight')],['dark',t('settings.themeDark')],['oled','OLED']])}${select('accent','settings.accent',['green','blue','violet','pink','amber','cyan'].map(value => [value,t('accent.'+value)]))}${select('gridCols','settings.cols',['auto','3','4','5','6'].map(value=>[value,value === 'auto' ? t('settings.auto') : value]))}${select('rowFit','settings.rowsVisible',['auto','3','4','5','6'].map(value=>[value,value === 'auto' ? t('settings.auto') : value]))}${select('textSize','settings.textSize',[['sm',t('settings.small')],['md',t('settings.medium')],['lg',t('settings.large')]])}${select('qtySize','settings.qtySize',[['sm',t('settings.small')],['md',t('settings.medium')],['lg',t('settings.large')]])}${select('gridDir','settings.direction',[['ltr',t('settings.ltr')],['rtl',t('settings.rtl')]])}${select('contrast','settings.contrast',[['normal',t('settings.contrastNormal')],['high',t('settings.contrastHigh')]])}${select('catAlign','settings.catAlign',[['left',t('settings.alignLeft')],['center',t('settings.alignCenter')],['right',t('settings.alignRight')]])}</div><div class="actions"><button type="submit" class="primary">${escape(t('apply'))}</button></div></form>`);
}
function more() {
  const entries = [['csv','export'],['backup','backup','backupHint'],['restore','restore','restoreHint'],['categories','categories'],['voice',recognition ? 'stopVoice' : 'voice','voiceHint'],['reset','reset','resetHint']];
  open('Count', `<div class="menu-list">${entries.map(([action,label,hint])=>`<button data-action="${action}">${escape(t(label))}${hint?`<small>${escape(t(hint))}</small>`:''}</button>`).join('')}</div>`);
}
function sessionList() {
  open(t('sessions'), store.state.sessions.map(value=>`<div class="session-row"><button data-action="switch-session" data-id="${escape(value.id)}" ${value.id===store.state.activeId?'class="primary"':''}>${escape(value.name||t('untitled'))}<small>${escape(value.date)} · ${number(totals(value).quantity)}</small></button></div>`).join(''));
}
function nameForm(isNew) { open(t(isNew ? 'newCount' : 'name'), `<form id="${isNew ? 'new-session' : 'rename'}-form" class="form-stack">${isNew ? `<p>${escape(t('newHint'))}</p>`:''}<label>${escape(t('name'))}<input name="name" maxlength="160" value="${escape(isNew ? '' : session().name)}" autofocus></label><button type="submit" class="primary">${escape(t('confirm'))}</button></form>`); }
function download(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], {type})); const link = document.createElement('a'); link.href=url; link.download=filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function history(type) { try { if (blocked) return; store[type](); selected=null; $('warning').hidden=true; render(); } catch(error) { failure(error); } }
function voice() {
  if (recognition) { recognition.stop(); recognition=null; notify(t('stopVoice')); return; }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) { notify(t('voice.unsupported')); return; }
  const current = new Speech(); recognition=current; current.lang=LANGS[lang()]?.locale || 'en-US'; current.continuous=true; current.interimResults=false;
  current.onresult = event => {
    if (dialog.open || blocked) return;
    for (let i=event.resultIndex;i<event.results.length;i++) {
      if (!event.results[i].isFinal) continue;
      const command=interpretVoice(event.results[i][0].transcript,lang(),session().items.filter(item=>!item.spacer).map(item=>({...item,name:nameOf(item)})));
      if (command.type==='stop') { current.stop(); break; }
      if (command.type==='select') { selected=command.id; renderCounts(); notify(nameOf(session().items.find(item=>item.id===selected))); }
      else if (command.type==='count') { if (command.id || selected) count(command.id || selected,command.delta); else notify(t('voice.selectFirst')); }
      else notify(t('voiceHint'));
    }
  };
  current.onerror=()=>{ notify(t('voiceHint')); current.stop(); };
  current.onend=()=>{ if(recognition===current) recognition=null; $('more-button').classList.remove('voice-active'); };
  try { current.start(); $('more-button').classList.add('voice-active'); notify(t('voiceHint')); } catch(error) { recognition=null; failure(error); }
}
let suppressClick=false, press=null;
$('grid').addEventListener('pointerdown',event=>{
  const target=event.target.closest('.count-button'); if(!target || event.button!==0) return;
  suppressClick=false;
  press={ id:target.dataset.id, x:event.clientX,y:event.clientY,pointer:event.pointerId };
  press.timer=setTimeout(()=>{if(press){suppressClick=true;details(press.id);press=null;}},500);
});
document.addEventListener('pointermove',event=>{
  if(!press || press.pointer!==event.pointerId) return;
  const dx=event.clientX-press.x,dy=event.clientY-press.y;
  if(Math.abs(dx)>10 || Math.abs(dy)>10){clearTimeout(press.timer);press.moved=true;}
});
document.addEventListener('pointerup',event=>{
  if(!press || press.pointer!==event.pointerId) return;
  clearTimeout(press.timer);
  const dx=event.clientX-press.x,dy=event.clientY-press.y;
  if(press.moved){suppressClick=true;if(Math.abs(dx)>44 && Math.abs(dx)>Math.abs(dy)*1.5) count(press.id,-1);}
  press=null;
});
document.addEventListener('pointercancel',()=>{if(press)clearTimeout(press.timer);press=null;suppressClick=true;});
$('grid').addEventListener('contextmenu',event=>{if(event.target.closest('.count-button'))event.preventDefault();});
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]'); if(!target) return;
  const {action,id}=target.dataset;
  if(action==='count' && suppressClick && event.detail!==0){suppressClick=false;return;}
  const selectedItem=()=>session().items.find(item=>item.id===selected);
  switch(action){
    case 'count': count(id,1); break;
    case 'details': details(id);break;
    case 'selected-minus': if(selectedItem())count(selected,-1);break;
    case 'selected-plus': if(selectedItem())count(selected,1);break;
    case 'selected-details': details(selected);break;
    case 'detail-minus': count(detailId,-1);break;
    case 'detail-plus': count(detailId,1);break;
    case 'detail-zero': commit({type:'set',id:detailId,value:0});break;
    case 'close': close();break;
    case 'settings':settings();break;
    case 'more':more();break;
    case 'undo':history('undo');break;
    case 'redo':history('redo');break;
    case 'rename':nameForm(false);break;
    case 'new-session':nameForm(true);break;
    case 'sessions':sessionList();break;
    case 'switch-session':if(commit({type:'switch-session',id})){selected=null;filter='';$('search').value='';render();close();}break;
    case 'add-item':itemEditor();break;
    case 'edit-item':itemEditor(id);break;
    case 'delete-item':confirm(t('remove'),t('deleteHint'),'confirm-delete-item',id);break;
    case 'confirm-delete-item':if(commit({type:'delete-item',id}))close();break;
    case 'categories':categories();break;
    case 'add-category':categoryEditor();break;
    case 'edit-category':categoryEditor(id);break;
    case 'delete-category':open(t('remove'),`<p>${escape(t('deleteCategoryHint'))}</p><div class="actions">${button('remove-category-keep',t('cats.orphan'),'',id)}${button('remove-category-all',t('cats.delAll'),'danger',id)}</div>`);break;
    case 'remove-category-keep':if(commit({type:'delete-category',id}))categories();break;
    case 'remove-category-all':if(commit({type:'delete-category',id,deleteItems:true}))categories();break;
    case 'reorder':reordering=!reordering;render();if(reordering)notify(t('moveHint'));break;
    case 'move-up':commit({type:'move',id,direction:-1});break;
    case 'move-down':commit({type:'move',id,direction:1});break;
    case 'reset':confirm(t('reset'),t('resetHint'),'confirm-reset');break;
    case 'confirm-reset':if(commit({type:'reset'}))close();break;
    case 'backup':download(JSON.stringify(store.state,null,2),`count-backup-${session().date}.json`,'application/json');close();break;
    case 'csv':download(csv(store.state),`count-${session().date}.csv`,'text/csv;charset=utf-8');close();break;
    case 'restore':$('import-file').click();break;
    case 'confirm-import':try{store.commit(pendingImport);pendingImport=null;blocked=false;selected=null;$('warning').hidden=true;render();close();}catch(error){failure(error);}break;
    case 'voice':close();voice();break;
    case 'reload':if(waitingWorker)waitingWorker.postMessage('ACTIVATE_UPDATE');else location.reload();break;
    case 'raw-backup':try{download(JSON.stringify({v4:localStorage.getItem(STORAGE_KEY),v3:localStorage.getItem('countlist.v3')},null,2),'count-recovery.json','application/json');}catch(error){failure(error);}break;
  }
});
document.addEventListener('submit',event=>{
  if(!event.target.closest('dialog'))return;event.preventDefault();const form=event.target,data=new FormData(form);
  try{
    switch(form.id){
      case 'quantity-form':if(commit({type:'set',id:detailId,value:quantity($('detail-qty').value)}))close();break;
      case 'bulk-form':{const amount=quantity($('per-row').value)*quantity($('rows').value);if(commit({type:'count',id:detailId,delta:amount}))notify(`+${number(amount)}`);break;}
      case 'item-form':if(commit({type:'save-item',id:form.dataset.id,name:data.get('name'),categoryId:data.get('categoryId')}))close();break;
      case 'category-form':if(commit({type:'save-category',id:form.dataset.id,name:data.get('name')}))categories();break;
      case 'settings-form':if(commit({type:'preferences',value:Object.fromEntries(data)})){recognition?.stop();close();}break;
      case 'rename-form':if(commit({type:'rename-session',name:data.get('name')}))close();break;
      case 'new-session-form':if(commit({type:'new-session',name:data.get('name')})){selected=null;filter='';$('search').value='';render();close();}break;
    }
  }catch(error){failure(error);}
});
document.addEventListener('input',event=>{if(['per-row','rows'].includes(event.target.id))$('bulk-result').textContent=`+${number(Number($('per-row').value)*Number($('rows').value))}`;});
$('search').addEventListener('input',event=>{filter=event.target.value.trim().toLocaleLowerCase();renderGrid();renderCounts();});
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{if(file.size>10000000)throw new Error('Backup exceeds 10 MB.');const raw=JSON.parse(await file.text());pendingImport=raw.version===4?validateState(raw):migrateLegacy(raw);confirm(t('restore'),`${t('restoreHint')} (${pendingImport.sessions.length} ${t('sessions')})`,'confirm-import');}catch(error){failure(error);}
});
document.addEventListener('keydown',event=>{
  if(dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='z'){event.preventDefault();history(event.shiftKey?'redo':'undo');}
});
dialog.addEventListener('close',()=>{detailId=null;});
matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>applyPreferences());
window.addEventListener('resize',()=>applyPreferences());
window.addEventListener('online',status);window.addEventListener('offline',status);
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY || event.key===null){blocked=true;failure(new Error('Another tab changed these counts. Reload to continue.'));}});
try{
  store=createStore(storage,loadState(storage,navigator.language.slice(0,2)));store.initialize();render();
}catch(error){
  if(!store){store=createStore(storage,{state:createState(navigator.language.slice(0,2)),raw:storage.getItem(STORAGE_KEY)});blocked=true;}
  render();failure(error);
  if(blocked)open(t('restore'),`<p>${escape(t('recovery'))}</p><div class="menu-list">${button('raw-backup',t('rawBackup'))}${button('restore',t('restore'),'primary')}</div>`);
}
if('serviceWorker' in navigator && location.protocol !== 'file:' && (!['127.0.0.1','localhost'].includes(location.hostname) || new URLSearchParams(location.search).has('offline-test'))){
  let changingController=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(waitingWorker && !changingController){changingController=true;location.reload();}});
  const offerUpdate=worker=>{waitingWorker=worker;$('offline-label').innerHTML=`<button data-action="reload">${escape(t('reload'))}</button>`;};
  navigator.serviceWorker.register('sw.js').then(registration=>{
    if(registration.waiting)offerUpdate(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){if(navigator.serviceWorker.controller)offerUpdate(worker);else $('offline-label').textContent=t('ready');}});});
    navigator.serviceWorker.ready.then(()=>{if(!waitingWorker)$('offline-label').textContent=t('ready');});
  }).catch(()=>{$('offline-label').textContent='Offline installation unavailable';});
}


