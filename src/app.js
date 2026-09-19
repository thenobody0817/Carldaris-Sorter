import { LANGS } from './catalog.js';
import { activeSession, applyAction, categoryName, createState, csv, itemName, migrateLegacy, quantity, shiftItems, totals, validateState } from './model.js';
import { createStore, loadState, STORAGE_KEY } from './storage.js';
import { translate } from './strings.js';
import { interpretVoice } from './voice.js';
import { createCloud } from './cloud.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
let store, cloud, blocked = false, selected = null, gridTool = false, detailId = null, toastTimer, recognition = null, pendingImport = null, waitingWorker = null, preview = null;
const lang = () => store?.state.preferences.lang || 'en';
const t = key => translate(lang(), key);
const number = value => Number(value).toLocaleString(LANGS[lang()]?.locale || 'en');
const session = () => activeSession(store.state);
const nameOf = item => itemName(item, lang());
const categoryOf = category => categoryName(category, lang());
const dialog = $('dialog');
const currentColumns = () => { const tiles = $('grid').querySelector('.tiles'); return tiles ? getComputedStyle(tiles).gridTemplateColumns.split(/\s+/).filter(Boolean).length : 0; };
const currentRows = () => { const tiles = $('grid').querySelector('.tiles'); if (!tiles) return 0; return Math.ceil(tiles.children.length / (currentColumns() || 1)); };
let storage;
try { storage = window.localStorage; }
catch { storage = { getItem:()=>null, setItem:()=>{throw new Error('Device storage is unavailable. Enable site storage before counting.');} }; }
function notify(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3600); }
function failure(error) { $('warning').textContent = error.message; $('warning').hidden = false; const field = $('dialog-error'); if (field) field.textContent = error.message; }
function cloudStatus(info = {}) {
  const label = $('offline-label'); if (!label) return;
  if (!info.configured) label.textContent = t('cloudIdle');
  else if (info.sending) label.textContent = t('cloudSending');
  else if (info.error) label.textContent = t('cloudError');
  else if (info.synced) label.textContent = t('cloudSynced');
  else if (info.pending) label.textContent = t('cloudPending');
  else label.textContent = t('cloudReady');
}
function commit(action) {
  if (blocked) { notify(t('recovery')); return false; }
  try {
    store.commit(applyAction(store.state, action)); $('warning').hidden = true;
    if (action.type === 'count' || action.type === 'set') renderCounts(); else render();
    if (action.type !== 'preferences') cloud?.schedule();
    return true;
  } catch (error) { failure(error); return false; }
}
function count(id, delta) {
  selected = id;
  if (commit({ type:'count', id, delta })) navigator.vibrate?.(8);
}
function applyPreferences() {
  const p = store.state.preferences, root = document.documentElement;
  root.lang = p.lang;
  root.dataset.theme = p.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p.theme;
  root.dataset.accent = p.accent; root.dataset.contrast = p.contrast;
  $('grid').style.setProperty('--grid-direction', p.gridDir);
  $('grid').dataset.tileStyle = p.tileStyle;
  if (p.gridCols === 'auto') { $('grid').style.removeProperty('--columns'); $('grid').style.removeProperty('--track'); }
  else { $('grid').style.setProperty('--columns', p.gridCols); $('grid').style.setProperty('--track', 'minmax(0,1fr)'); }
  $('grid').style.setProperty('--custom-tile-font', `${p.titleSize}px`);
  $('grid').style.setProperty('--custom-image-zoom', String(p.imageZoom / 100));
  $('grid').style.setProperty('--custom-image-x', `${p.imageShiftX}%`);
  $('grid').style.setProperty('--custom-image-y', `${p.imageShiftY}%`);
  updateNudgeValues();
  $('grid').style.setProperty('--custom-quantity-font', ({ sm:'16px', md:'20px', lg:'27px' })[p.qtySize]);

  document.querySelector('meta[name="theme-color"]').content = root.dataset.theme === 'light' ? '#f7f8f2' : root.dataset.theme === 'oled' ? '#000000' : '#101512';
}
function render() {
  applyPreferences();
  for (const [id,key] of Object.entries({ 'sessions-button':'sessions', 'new-button':'newCount', 'reset-button':'counter.reset', 'selected-label':'selected', empty:'empty' })) $(id).textContent = t(key);
  $('undo-button').innerHTML = `↶ <span>${escape(t('undo'))}</span>`;
  document.querySelector('[data-action="settings"]').setAttribute('aria-label',t('settings.title'));
  $('redo-button').setAttribute('aria-label',t('redo'));
  $('grid-button').setAttribute('aria-label',t('grid'));
  $('grid-button').setAttribute('aria-pressed',String(gridTool));
  if (!$('session-name').isContentEditable) $('session-name').textContent = session().name || t('untitled');
  renderGrid(); gridControls(); renderCounts(); cloud?.refresh();
}
function tileMarkup(item) {
  if (item.spacer) return gridTool
    ? `<button type="button" class="tile spacer" data-action="remove-gap" data-id="${escape(item.id)}" aria-label="${escape(t('removeGap'))}"></button>`
    : `<div class="tile spacer" data-id="${escape(item.id)}" data-spacer="true" aria-hidden="true"></div>`;
  return `<article class="tile" data-id="${escape(item.id)}"><button class="count-button" data-action="count" data-id="${escape(item.id)}" aria-label="${escape(nameOf(item))}: +1"><span class="tile-picture">${item.image ? `<img src="${escape(item.image)}" alt="" draggable="false">` : '<span class="tile-placeholder">▤</span>'}</span><span class="tile-quantity">${number(item.qty)}</span><span class="tile-bottom"><span class="tile-name">${escape(nameOf(item))}</span></span></button><button class="tile-menu" data-action="details" data-id="${escape(item.id)}" aria-label="${escape(t('details') + ': ' + nameOf(item))}">···</button></article>`;
}
function renderGrid() {
  const items = preview || session().items;
  const visible = items.filter(item => !item.spacer).length;
  const preferences = store.state.preferences;
  const matrix = preferences.gridCols !== 'auto' || preferences.gridRows !== 'auto';
  $('grid').dataset.editing = String(gridTool);
  $('grid').innerHTML = `<div class="tiles">${items.map(tileMarkup).join('')}</div>`;
  if (items.length && (gridTool || matrix)) {
    const tiles = $('grid').querySelector('.tiles');
    const columns = getComputedStyle(tiles).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
    const wanted = preferences.gridRows === 'auto' ? 0 : Number(preferences.gridRows);
    const rows = Math.max(wanted, Math.ceil(items.length / columns));
    const missing = rows * columns - items.length;
    if (missing > 0) tiles.insertAdjacentHTML('beforeend', Array.from({ length: missing }, () => '<div class="tile slot" data-slot="true" aria-hidden="true"></div>').join(''));
  }
  $('empty').hidden = visible > 0;
}
function gridControls() {
  const p = store.state.preferences, box = $('grid-controls');
  box.hidden = !gridTool;
  document.body.classList.toggle('grid-open', gridTool);
  if (!gridTool) return;
  if (box.dataset.lang !== lang()) {
    const pick = (key,label,options) => `<label class="grid-control">${escape(t(label))}<select name="${key}">${options.map(([value,text]) => `<option value="${value}">${escape(text)}</option>`).join('')}</select></label>`;
    const slide = (key,label,min,max,step,suffix) => `<label class="grid-control"><span>${escape(t(label))} <output data-suffix="${suffix}"></output></span><input type="range" name="${key}" min="${min}" max="${max}" step="${step}"></label>`;
    const stepper = (key,label) => `<label class="grid-control"><span>${escape(t(label))} <output data-step="${key}"></output></span><div class="step-pad"><button type="button" data-action="grid-step" data-key="${key}" data-delta="-1" aria-label="${escape(t('settings.decrease'))}">−</button><button type="button" data-action="grid-auto" data-key="${key}" aria-label="${escape(t('settings.auto'))}">${escape(t('settings.auto'))}</button><button type="button" data-action="grid-step" data-key="${key}" data-delta="1" aria-label="${escape(t('settings.increase'))}">+</button></div></label>`;
    box.innerHTML = `<div class="grid-head"><span>${escape(t('grid'))}</span><button type="button" class="grid-close" data-action="grid" aria-label="${escape(t('close'))}">✕</button></div>`
      + stepper('gridCols','settings.cols')
      + stepper('gridRows','settings.rows')
      + pick('gridDir','settings.direction',[['ltr',t('settings.ltr')],['rtl',t('settings.rtl')]])
      + pick('tileStyle','settings.tileStyle',[['classic',t('settings.tileClassic')],['glow',t('settings.tileGlow')],['diagonal',t('settings.tileDiagonal')],['round',t('settings.tileRound')],['convex',t('settings.tileConvex')],['glass',t('settings.tileGlass')]])
      + pick('qtySize','settings.qtySize',[['sm',t('settings.small')],['md',t('settings.medium')],['lg',t('settings.large')]])
      + slide('imageZoom','settings.imageZoom',50,400,5,'%')
      + slide('titleSize','settings.titleSize',9,28,1,'px')
      + nudgePad()
      + `<button type="button" class="grid-auto" data-action="compact">⌗ ${escape(t('autoArrange'))}</button>`;
    box.dataset.lang = lang();
  }
  for (const field of box.querySelectorAll('select,input[type=range]')) field.value = p[field.name];
  for (const output of box.querySelectorAll('output')) { const input = output.closest('label')?.querySelector('input'); if (input) output.textContent = `${p[input.name]}${output.dataset.suffix}`; }
  for (const output of box.querySelectorAll('[data-step]')) { const value = p[output.dataset.step]; output.textContent = value === 'auto' ? t('settings.auto') : value; }
  for (const button of box.querySelectorAll('[data-action="grid-auto"]')) button.setAttribute('aria-pressed', String(p[button.dataset.key] === 'auto'));
  updateNudgeValues();
}
function nudgePad() {
  const p = store.state.preferences;
  const dirs = [['up','▲'],['left','◀'],['down','▼'],['right','▶']];
  return `<div class="grid-control image-nudge"><span>${escape(t('settings.imageShift'))} <output class="nudge-value">${p.imageShiftX}, ${p.imageShiftY}</output></span><div class="nudge-pad">${dirs.map(([dir,glyph]) => `<button type="button" data-action="nudge" data-dir="${dir}" aria-label="${escape(t('imageNudge.' + dir))}">${glyph}</button>`).join('')}<button type="button" data-action="nudge-center" aria-label="${escape(t('imageNudge.center'))}">⊙</button></div></div>`;
}
function updateNudgeValues() {
  const p = store.state.preferences;
  for (const output of document.querySelectorAll('.nudge-value')) output.textContent = `${p.imageShiftX}, ${p.imageShiftY}`;
}
function renderCounts() {
  $('undo-button').disabled = !store.canUndo; $('redo-button').disabled = !store.canRedo;
  for (const tile of document.querySelectorAll('.tile[data-id]:not(.spacer)')) {
    const item = session().items.find(item => item.id === tile.dataset.id);
    tile.querySelector('.tile-quantity').textContent = number(item.qty);
    tile.classList.toggle('selected', item.id === selected);
  }
  const item = session().items.find(item => item.id === selected && !item.spacer);
  $('quick-bar').hidden = !item;
  if (item) { $('selected-name').textContent = nameOf(item); $('selected-qty').textContent = number(item.qty); }
  const detail = session().items.find(item => item.id === detailId);
  if (detail && $('detail-qty')) $('detail-qty').value = detail.qty;
}
function open(title, content, side = false) {
  $('dialog-title').textContent = title; $('dialog-content').innerHTML = content + '<p id="dialog-error" class="dialog-error" role="alert"></p>';
  const wasSide = dialog.classList.contains('settings-panel');
  dialog.classList.toggle('settings-panel', side); document.body.classList.toggle('settings-open', side);
  if (dialog.open && wasSide === side) return;
  if (dialog.open) dialog.close();
  if (side) dialog.show(); else dialog.showModal();
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
  const slide = (key,label,min,max,step,suffix) => `<label>${escape(t(label))} <output data-suffix="${suffix}">${p[key]}${suffix}</output><input type="range" name="${key}" min="${min}" max="${max}" step="${step}" value="${p[key]}"></label>`;
  const option = values => values.map(value => [value,t('settings.' + value)]);
  open(t('settings.title'), `<form id="settings-form"><div class="settings-grid">${select('lang','settings.language',[['en','English'],['lv','Latviešu'],['ru','Русский'],['zh','中文']])}${select('theme','settings.theme',[['auto',t('settings.themeAuto')],['light',t('settings.themeLight')],['dark',t('settings.themeDark')],['oled','OLED']])}${select('accent','settings.accent',['green','blue','violet','pink','amber','cyan'].map(value => [value,t('accent.'+value)]))}${slide('imageZoom','settings.imageZoom',50,400,5,'%')}${slide('titleSize','settings.titleSize',9,28,1,'px')}${nudgePad()}${select('contrast','settings.contrast',[['normal',t('settings.contrastNormal')],['high',t('settings.contrastHigh')]])}${select('catAlign','settings.catAlign',[['left',t('settings.alignLeft')],['center',t('settings.alignCenter')],['right',t('settings.alignRight')]])}</div><div class="actions"><button type="button" data-action="close" class="primary">${escape(t('close'))}</button></div></form>`, true);
}
function cloudSettings() {
  open(t('cloudSync'), `<form id="cloud-form" class="form-stack"><p>${escape(t('cloudHint'))}</p><label>${escape(t('cloudUrl'))}<input name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://..." value="${escape(cloud.readUrl())}"></label><div class="actions">${button('cloud-now',t('cloudNow'))}<button type="submit" class="primary">${escape(t('cloudSave'))}</button></div></form>`);
}
function more() {
  const entries = [['csv','export'],['cloud','cloudSync','cloudHint'],['backup','backup','backupHint'],['restore','restore','restoreHint'],['categories','categories'],['voice',recognition ? 'stopVoice' : 'voice','voiceHint'],['reset','reset','resetHint']];
  open('Count', `<div class="menu-list">${entries.map(([action,label,hint])=>`<button data-action="${action}">${escape(t(label))}${hint?`<small>${escape(t(hint))}</small>`:''}</button>`).join('')}</div>`);
}
function sessionList() {
  open(t('sessions'), store.state.sessions.map(value=>`<div class="session-row"><button data-action="switch-session" data-id="${escape(value.id)}" ${value.id===store.state.activeId?'class="primary"':''}>${escape(value.name||t('untitled'))}<small>${escape(value.date)} · ${number(totals(value).quantity)}</small></button></div>`).join(''));
}
function nameForm() { open(t('newCount'), `<form id="new-session-form" class="form-stack"><p>${escape(t('newHint'))}</p><label>${escape(t('name'))}<input name="name" maxlength="160" autofocus></label><button type="submit" class="primary">${escape(t('confirm'))}</button></form>`); }
function renameStart() {
  const el = $('session-name'); if (el.isContentEditable) return;
  el.dataset.placeholder = t('untitled');
  el.textContent = session().name;
  el.contentEditable = 'true'; el.classList.add('renaming');
  el.focus();
  const range = document.createRange(); range.selectNodeContents(el);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
function renameFinish() {
  const el = $('session-name'); if (!el.isContentEditable) return;
  el.contentEditable = 'false'; el.classList.remove('renaming');
  const name = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (name !== session().name) commit({ type:'rename-session', name });
  el.textContent = session().name || t('untitled');
}
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
let suppressClick=false, press=null, holdTimer=null, holdRepeat=null, holdFired=false, drag=null, pan=null;
const stopHold=()=>{clearTimeout(holdTimer);clearInterval(holdRepeat);holdTimer=holdRepeat=null;};
const DRAG_MOVE=8;
function placeGhost(x,y){if(drag?.ghost){drag.ghost.style.left=`${x-drag.offsetX}px`;drag.ghost.style.top=`${y-drag.offsetY}px`;}}
function startDrag(){
  if(!drag || drag.started) return;
  drag.started=true;
  const rect=drag.tile.getBoundingClientRect();
  drag.offsetX=drag.startX-rect.left; drag.offsetY=drag.startY-rect.top;
  const ghost=drag.tile.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width=`${rect.width}px`; ghost.style.height=`${rect.height}px`;
  document.body.appendChild(ghost); drag.ghost=ghost;
  drag.tile.classList.add('dragging'); document.body.classList.add('tile-dragging');
  placeGhost(drag.startX,drag.startY); navigator.vibrate?.(8);
}
function cellIndexAt(x,y){
  const tiles=$('grid').querySelector('.tiles'); if(!tiles) return null;
  const cells=tiles.querySelectorAll('.tile'); if(!cells.length) return null;
  const first=cells[0].getBoundingClientRect(), rect=tiles.getBoundingClientRect(), style=getComputedStyle(tiles);
  const gapX=parseFloat(style.columnGap)||0, gapY=parseFloat(style.rowGap)||0;
  const columns=style.gridTemplateColumns.split(/\s+/).filter(Boolean).length||1;
  const cellW=first.width+gapX, cellH=first.height+gapY;
  if(!cellW || !cellH || x<rect.left || x>rect.right) return null;
  const rtl=store.state.preferences.gridDir==='rtl';
  const column=Math.max(0,Math.min(columns-1,rtl?Math.floor((rect.right-x)/cellW):Math.floor((x-first.left)/cellW)));
  const row=Math.max(0,Math.floor((y-first.top)/cellH));
  return Math.min(row*columns+column,cells.length-1);
}
function updateDragTarget(x,y){
  const index=cellIndexAt(x,y), tiles=$('grid').querySelector('.tiles');
  const target=(index===null||!tiles)?null:tiles.querySelectorAll('.tile')[index]||null;
  if(drag.target && drag.target!==target) drag.target.classList.remove('drop-target');
  if(target && target!==drag.tile) target.classList.add('drop-target');
  drag.target=(target && target!==drag.tile)?target:null;
  drag.targetIndex=(target && target!==drag.tile)?index:null;
}
function endDrag(save){
  if(!drag) return;
  drag.ghost?.remove(); drag.tile?.classList.remove('dragging');
  drag.target?.classList.remove('drop-target'); document.body.classList.remove('tile-dragging');
  const finished=drag; drag=null;
  if(finished.started && save && finished.targetIndex!==null && finished.targetIndex!==undefined){
    const from=session().items.findIndex(item=>item.id===finished.id);
    if(from>-1 && from!==finished.targetIndex) commit({type:'place',id:finished.id,index:finished.targetIndex});
  }
}
function startPan(event){
  const tiles=$('grid').querySelector('.tiles'); if(!tiles) return;
  const cell=tiles.querySelector('.tile'); if(!cell) return;
  const style=getComputedStyle(tiles), rect=cell.getBoundingClientRect();
  const gapX=parseFloat(style.columnGap)||0, gapY=parseFloat(style.rowGap)||0;
  pan={ pointer:event.pointerId, startX:event.clientX, startY:event.clientY, cellW:rect.width+gapX||1, cellH:rect.height+gapY||1, columns:style.gridTemplateColumns.split(/\s+/).filter(Boolean).length||1, offset:0 };
  document.body.classList.add('panning');
}
function movePan(x,y){
  const dCol=Math.round((x-pan.startX)/pan.cellW), dRow=Math.round((y-pan.startY)/pan.cellH);
  const offset=dRow*pan.columns+dCol;
  if(offset===pan.offset) return;
  pan.offset=offset;
  preview=shiftItems(session().items,offset);
  renderGrid();
}
function endPan(save){
  if(!pan) return;
  const offset=pan.offset; pan=null; preview=null; document.body.classList.remove('panning');
  if(offset && save) commit({type:'shift',offset});
  else if(offset) renderGrid();
}
$('quick-bar').addEventListener('pointerdown',event=>{
  const target=event.target.closest('[data-action="selected-plus"],[data-action="selected-minus"]');
  if(!target || event.button!==0 || !selected) return;
  const delta=target.dataset.action==='selected-plus'?10:-10;
  holdFired=false;
  holdTimer=setTimeout(()=>{holdFired=true;count(selected,delta);holdRepeat=setInterval(()=>count(selected,delta),500);},500);
});
document.addEventListener('pointerup',stopHold);
document.addEventListener('pointercancel',stopHold);
$('grid').addEventListener('pointerdown',event=>{
  if(gridTool){
    if(event.button!==0) return;
    const tile=event.target.closest('.tile[data-id]');
    if(tile && !tile.classList.contains('spacer') && !event.target.closest('.tile-menu,.tile-order')){
      suppressClick=false;
      drag={ id:tile.dataset.id, pointer:event.pointerId, startX:event.clientX, startY:event.clientY, tile, started:false };
      return;
    }
    suppressClick=false;
    startPan(event);
    return;
  }
  const target=event.target.closest('.count-button'); if(!target || event.button!==0) return;
  suppressClick=false;
  press={ id:target.dataset.id, x:event.clientX,y:event.clientY,pointer:event.pointerId };
  press.timer=setTimeout(()=>{if(press){suppressClick=true;details(press.id);press=null;}},500);
});
document.addEventListener('pointermove',event=>{
  if(pan){ if(pan.pointer!==event.pointerId) return; event.preventDefault(); movePan(event.clientX,event.clientY); return; }
  if(drag){
    if(drag.pointer!==event.pointerId) return;
    if(!drag.started){
      if(Math.abs(event.clientX-drag.startX)<=DRAG_MOVE && Math.abs(event.clientY-drag.startY)<=DRAG_MOVE) return;
      startDrag();
    }
    event.preventDefault(); placeGhost(event.clientX,event.clientY); updateDragTarget(event.clientX,event.clientY); return;
  }
  if(!press || press.pointer!==event.pointerId) return;
  const dx=event.clientX-press.x,dy=event.clientY-press.y;
  if(Math.abs(dx)>10 || Math.abs(dy)>10){clearTimeout(press.timer);press.moved=true;}
});
document.addEventListener('pointerup',event=>{
  if(pan && pan.pointer===event.pointerId){endPan(true);return;}
  if(drag && drag.pointer===event.pointerId){const moved=drag.started;if(moved)suppressClick=true;endDrag(true);return;}
  if(!press || press.pointer!==event.pointerId) return;
  clearTimeout(press.timer);
  const dx=event.clientX-press.x,dy=event.clientY-press.y;
  if(press.moved){suppressClick=true;if(Math.abs(dx)>44 && Math.abs(dx)>Math.abs(dy)*1.5) count(press.id,-1);}
  press=null;
});
document.addEventListener('pointercancel',()=>{if(pan)endPan(false);if(drag)endDrag(false);if(press)clearTimeout(press.timer);press=null;suppressClick=true;});
document.addEventListener('touchmove',event=>{if(drag?.started||pan)event.preventDefault();},{passive:false});
$('grid').addEventListener('contextmenu',event=>{if(event.target.closest('.count-button'))event.preventDefault();});
document.addEventListener('pointerdown',event=>{
  if(!gridTool) return;
  if(event.target.closest('#grid-controls,#grid,[data-action="grid"]')) return;
  gridTool=false; render();
});
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]'); if(!target) return;
  const {action,id}=target.dataset;
  if((action==='count'||action==='remove-gap') && suppressClick && event.detail!==0){suppressClick=false;return;}
  if((action==='selected-plus'||action==='selected-minus') && holdFired){holdFired=false;return;}
  const selectedItem=()=>session().items.find(item=>item.id===selected);
  switch(action){
    case 'count': if(!gridTool) count(id,1); break;
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
    case 'cloud':cloudSettings();break;
    case 'cloud-now':cloud.send().then(ok=>notify(ok?t('cloudSynced'):t('cloudError')));break;
    case 'undo':history('undo');break;
    case 'redo':history('redo');break;
    case 'new-session':nameForm();break;
    case 'sessions':sessionList();break;
    case 'switch-session':if(commit({type:'switch-session',id})){selected=null;render();close();}break;
    case 'edit-item':itemEditor(id);break;
    case 'delete-item':confirm(t('remove'),t('deleteHint'),'confirm-delete-item',id);break;
    case 'confirm-delete-item':if(commit({type:'delete-item',id}))close();break;
    case 'categories':categories();break;
    case 'add-category':categoryEditor();break;
    case 'edit-category':categoryEditor(id);break;
    case 'delete-category':open(t('remove'),`<p>${escape(t('deleteCategoryHint'))}</p><div class="actions">${button('remove-category-keep',t('cats.orphan'),'',id)}${button('remove-category-all',t('cats.delAll'),'danger',id)}</div>`);break;
    case 'remove-category-keep':if(commit({type:'delete-category',id}))categories();break;
    case 'remove-category-all':if(commit({type:'delete-category',id,deleteItems:true}))categories();break;
    case 'grid':gridTool=!gridTool;render();if(gridTool)notify(t('gridHint'));break;
    case 'nudge':{const p=store.state.preferences,step=2,dir=target.dataset.dir;commit({type:'preferences',value:{imageShiftX:p.imageShiftX+(dir==='right'?step:dir==='left'?-step:0),imageShiftY:p.imageShiftY+(dir==='down'?step:dir==='up'?-step:0)}});break;}
    case 'nudge-center':commit({type:'preferences',value:{imageShiftX:0,imageShiftY:0}});break;
    case 'grid-step':{
      const key=target.dataset.key, value=store.state.preferences[key];
      const base=value==='auto'?(key==='gridCols'?currentColumns():currentRows()):Number(value);
      const next=Math.max(1,Math.min(12,(base||1)+Number(target.dataset.delta)));
      const patch={[key]:String(next)};
      if(key==='gridCols')patch.fromColumns=currentColumns();
      commit({type:'preferences',value:patch});
      break;
    }
    case 'grid-auto':commit({type:'preferences',value:{[target.dataset.key]:'auto'}});break;
    case 'move-up':commit({type:'move',id,direction:-1});break;
    case 'move-down':commit({type:'move',id,direction:1});break;
    case 'remove-gap':commit({type:'remove-gap',id});break;
    case 'compact':commit({type:'compact',columns:currentColumns()});break;
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
      case 'new-session-form':if(commit({type:'new-session',name:data.get('name')})){selected=null;render();close();}break;
      case 'cloud-form':{cloud.setUrl(data.get('url'));close();notify(t('cloudSaved'));if(cloud.configured())cloud.send();break;}
    }
  }catch(error){failure(error);}
});
document.addEventListener('input',event=>{
  if(['per-row','rows'].includes(event.target.id))$('bulk-result').textContent=`+${number(Number($('per-row').value)*Number($('rows').value))}`;
  const range=event.target.closest('input[type=range]');if(!range)return;
  const output=range.parentElement.querySelector('output');if(output)output.textContent=`${range.value}${output.dataset.suffix||''}`;
  if(range.name==='imageZoom')$('grid').style.setProperty('--custom-image-zoom',String(Number(range.value)/100));
  if(range.name==='titleSize')$('grid').style.setProperty('--custom-tile-font',`${Number(range.value)}px`);
});
document.addEventListener('change',event=>{
  const gridField=event.target.closest('#grid-controls select,#grid-controls input[type=range]');
  if(gridField){const value={[gridField.name]:gridField.value};commit({type:'preferences',value,fromColumns:gridField.name==='gridCols'?currentColumns():undefined});return;}
  const field=event.target.closest('#settings-form select,#settings-form input[type=range]');if(!field)return;
  const form=$('settings-form');if(!form)return;
  if(commit({type:'preferences',value:Object.fromEntries(new FormData(form))}) && field.name==='lang'){recognition?.stop();settings();}
});
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{if(file.size>10000000)throw new Error('Backup exceeds 10 MB.');const raw=JSON.parse(await file.text());pendingImport=raw.version===4?validateState(raw):migrateLegacy(raw);confirm(t('restore'),`${t('restoreHint')} (${pendingImport.sessions.length} ${t('sessions')})`,'confirm-import');}catch(error){failure(error);}
});
$('session-name').addEventListener('click',()=>renameStart());
$('session-name').addEventListener('blur',()=>renameFinish());
$('session-name').addEventListener('keydown',event=>{
  const el=$('session-name');
  if(!el.isContentEditable){
    if(event.key==='Enter' || event.key===' '){event.preventDefault();renameStart();}
    return;
  }
  if(event.key==='Enter'){event.preventDefault();el.blur();}
  else if(event.key==='Escape'){event.preventDefault();el.textContent=session().name||t('untitled');el.blur();}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && dialog.open && dialog.classList.contains('settings-panel')){close();return;}
  if(dialog.open || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='z'){event.preventDefault();history(event.shiftKey?'redo':'undo');}
});
dialog.addEventListener('close',()=>{detailId=null;if(!dialog.open){document.body.classList.remove('settings-open');dialog.classList.remove('settings-panel');}});
matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>applyPreferences());
window.addEventListener('resize',()=>applyPreferences());

window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY || event.key===null){blocked=true;failure(new Error('Another tab changed these counts. Reload to continue.'));}});
try{
  store=createStore(storage,loadState(storage,navigator.language.slice(0,2)));store.initialize();render();
}catch(error){
  if(!store){store=createStore(storage,{state:createState(navigator.language.slice(0,2)),raw:storage.getItem(STORAGE_KEY)});blocked=true;}
  render();failure(error);
  if(blocked)open(t('restore'),`<p>${escape(t('recovery'))}</p><div class="menu-list">${button('raw-backup',t('rawBackup'))}${button('restore',t('restore'),'primary')}</div>`);
}
cloud=createCloud({storage,getState:()=>store.state,onStatus:cloudStatus});cloud.refresh();
window.addEventListener('online',()=>cloud.schedule());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')cloud.send();});
window.addEventListener('pagehide',()=>cloud.send());
if('serviceWorker' in navigator && location.protocol !== 'file:' && (!['127.0.0.1','localhost'].includes(location.hostname) || new URLSearchParams(location.search).has('offline-test'))){
  let changingController=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(waitingWorker && !changingController){changingController=true;location.reload();}});
  const offerUpdate=worker=>{waitingWorker=worker;$('toast').innerHTML=`<button data-action="reload">${escape(t('reload'))}</button>`;$('toast').hidden=false;};
  navigator.serviceWorker.register('sw.js').then(registration=>{
    if(registration.waiting)offerUpdate(registration.waiting);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller)offerUpdate(worker);});});
  }).catch(()=>{});
}


