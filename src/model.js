import { DEFAULT_ITEMS, IMAGE_BY_ID } from './catalog.js';

export const VERSION = 4;
export const MAX_QUANTITY = 999999999;
export const languages = ['en', 'lv', 'ru', 'zh'];
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
const makeSpacer = () => ({ id: uid(), name: '', defaultKey: null, categoryId: null, qty: 0, spacer: true, image: '' });
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function quantity(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new Error('Enter a whole number.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_QUANTITY) throw new Error('Enter a whole number between 0 and 999,999,999.');
  return number;
}
const gridSizes = ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
export const defaults = {
  lang: 'en', theme: 'auto', accent: 'green', contrast: 'normal', gridCols: 'auto', gridRows: 'auto',
  gridDir: 'ltr', qtySize: 'md', rowFit: 'auto', catAlign: 'left', tileStyle: 'classic',
  imageZoom: 125, titleSize: 12, imageShiftX: 0, imageShiftY: 0,
};
const choices = {
  lang: languages, theme: ['auto', 'light', 'dark', 'oled'], accent: ['green', 'blue', 'violet', 'pink', 'amber', 'cyan'],
  contrast: ['normal', 'high'], gridCols: gridSizes, gridRows: gridSizes, gridDir: ['ltr', 'rtl'],
  qtySize: ['sm', 'md', 'lg'], rowFit: ['auto', '3', '4', '5', '6'], catAlign: ['left', 'center', 'right'],
  tileStyle: ['classic', 'glow', 'diagonal', 'round', 'convex', 'glass'],
};
const ranges = { imageZoom: [50, 400], titleSize: [9, 28], imageShiftX: [-50, 50], imageShiftY: [-50, 50] };
function preferences(raw = {}) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    if (ranges[key]) {
      const value = Number(raw[key]);
      return [key, Number.isFinite(value) ? Math.min(ranges[key][1], Math.max(ranges[key][0], Math.round(value))) : fallback];
    }
    return [key, choices[key].includes(raw[key]) ? raw[key] : fallback];
  }));
}
function defaultCategory(name) {
  for (const list of Object.values(DEFAULT_ITEMS)) {
    const item = list.find(item => item.category === name);
    if (item) return item.id;
  }
  return null;
}
function translatedDefaultName(id, name) {
  return Object.values(DEFAULT_ITEMS).some(list => list.some(item => item.id === id && item.name === name));
}
export function migrateLegacy(raw) {
  if (!raw || !Array.isArray(raw.items)) throw new Error('The old count data is not valid.');
  const names = new Set((Array.isArray(raw.categories) ? raw.categories : []).filter(name => typeof name === 'string' && name));
  for (const item of raw.items) if (item && typeof item.category === 'string' && item.category) names.add(item.category);
  const categories = [...names].map(name => ({ id: uid(), name, defaultKey: defaultCategory(name) }));
  const seen = new Set();
  const items = raw.items.filter(item => item && typeof item === 'object').map(item => {
    let id = typeof item.id === 'string' && item.id ? item.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const value = Number(item.qty);
    return {
      id, name: typeof item.name === 'string' ? item.name : 'Item',
      defaultKey: translatedDefaultName(item.id, item.name) ? item.id : null,
      categoryId: categories.find(category => category.name === item.category)?.id || null,
      image: safeImage(item.image) || IMAGE_BY_ID[item.id] || '',
      qty: Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUANTITY ? value : 0,
      spacer: Boolean(item.spacer),
    };
  });
  const session = { id: uid(), name: String(raw.label || ''), date: validDate(raw.date) ? raw.date : localDate(), categories, items };
  return { version: VERSION, revision: 0, savedAt: null, preferences: preferences(raw), activeId: session.id, sessions: [session] };
}
export function createState(lang = 'en') {
  lang = languages.includes(lang) ? lang : 'en';
  return migrateLegacy({ lang, date: localDate(), items: DEFAULT_ITEMS[lang].map(item => ({ ...item, qty: 0, image: IMAGE_BY_ID[item.id] || '' })) });
}
export function safeImage(value) {
  return typeof value === 'string' && (/^images\/[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$/.test(value) || (value.length < 3000000 && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value))) ? value : '';
}
export function validateState(raw) {
  if (!raw || raw.version !== VERSION || !Array.isArray(raw.sessions) || !raw.sessions.length || raw.sessions.length > 500) throw new Error('Unsupported or invalid backup.');
  const state = structuredClone(raw);
  state.preferences = preferences(raw.preferences);
  const sessions = new Set();
  for (const session of state.sessions) {
    if (typeof session.id !== 'string' || !session.id || sessions.has(session.id)) throw new Error('Invalid session ID.');
    sessions.add(session.id);
    if (typeof session.name !== 'string' || !validDate(session.date) || !Array.isArray(session.items) || !Array.isArray(session.categories)) throw new Error('Invalid session data.');
    if (session.items.length > 10000 || session.categories.length > 1000) throw new Error('Backup is too large.');
    const categories = new Set();
    for (const category of session.categories) {
      if (!category || typeof category.id !== 'string' || !category.id || categories.has(category.id) || typeof category.name !== 'string') throw new Error('Invalid category.');
      categories.add(category.id);
    }
    const ids = new Set();
    for (const item of session.items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string') throw new Error('Invalid item.');
      ids.add(item.id);
      if (item.categoryId !== null && !categories.has(item.categoryId)) throw new Error('An item refers to a missing category.');
      item.qty = quantity(item.qty);
      item.image = safeImage(item.image);
      item.spacer = Boolean(item.spacer);
      delete item.counted;
    }
  }
  if (!sessions.has(state.activeId)) throw new Error('Missing active session.');
  state.revision = Number.isSafeInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  return state;
}
export const activeSession = state => state.sessions.find(session => session.id === state.activeId);
export const itemName = (item, lang) => DEFAULT_ITEMS[lang]?.find(value => value.id === item.defaultKey)?.name || item.name;
export const categoryName = (category, lang) => DEFAULT_ITEMS[lang]?.find(value => value.id === category.defaultKey)?.category || category.name;
export function totals(session) {
  return session.items.reduce((sum, item) => item.spacer ? sum : ({ quantity: sum.quantity + item.qty }), { quantity: 0 });
}
function reflowItems(session, from, to) {
  const rows = [];
  for (let i = 0; i < session.items.length; i += from) rows.push(session.items.slice(i, i + from));
  const out = [];
  if (to > from) {
    const pad = to - from;
    for (const row of rows) { for (let i = 0; i < pad; i++) out.push(null); out.push(...row); }
  } else {
    const drop = from - to;
    for (const row of rows) {
      let cut = 0;
      while (cut < drop && (!row[cut] || row[cut].spacer)) cut++;
      out.push(...row.slice(cut));
    }
  }
  session.items = out.map(cell => cell || makeSpacer());
}
export function shiftItems(items, offset) {
  if (!Number.isSafeInteger(offset) || !offset || !items.length) return items;
  const first = items.findIndex(value => !value.spacer);
  if (first < 0) return items;
  let last = items.length - 1;
  while (last >= 0 && items[last].spacer) last--;
  const clamped = Math.max(-first, Math.min(items.length - 1 - last, offset));
  if (!clamped) return items;
  return items.map((_, index) => {
    const source = index - clamped;
    return source >= 0 && source < items.length ? items[source] : makeSpacer();
  });
}
export function applyAction(previous, action) {
  const next = structuredClone(previous);
  const session = activeSession(next);
  const item = session.items.find(item => item.id === action.id);
  switch (action.type) {
    case 'count':
      if (!item || item.spacer) throw new Error('Item not found.');
      if (!Number.isSafeInteger(action.delta)) throw new Error('Invalid quantity change.');
      item.qty = quantity(Math.max(0, item.qty + action.delta)); break;
    case 'set':
      if (!item || item.spacer) throw new Error('Item not found.');
      item.qty = quantity(action.value); break;
    case 'preferences': {
      const merged = { ...next.preferences, ...action.value };
      const from = action.fromColumns, to = Number(merged.gridCols);
      if (Number.isInteger(from) && from > 0 && Number.isInteger(to) && to > 0 && from !== to) reflowItems(session, from, to);
      next.preferences = preferences(merged);
      break;
    }
    case 'rename-session': session.name = String(action.name).trim().slice(0, 160); break;
    case 'new-session': {
      const fresh = structuredClone(session);
      fresh.id = uid(); fresh.name = String(action.name || '').trim().slice(0, 160); fresh.date = localDate();
      fresh.items.forEach(item => { item.qty = 0; });
      next.sessions.unshift(fresh); next.activeId = fresh.id; break;
    }
    case 'switch-session':
      if (!next.sessions.some(session => session.id === action.id)) throw new Error('Session not found.');
      next.activeId = action.id; break;
    case 'reset': session.items.forEach(item => { item.qty = 0; }); break;
    case 'save-item': {
      const name = String(action.name || '').trim().slice(0, 160);
      if (!name) throw new Error('Enter an item name.');
      if (action.categoryId && !session.categories.some(category => category.id === action.categoryId)) throw new Error('Category not found.');
      if (item) { item.name = name; item.defaultKey = null; item.categoryId = action.categoryId || null; }
      else session.items.push({ id: uid(), name, defaultKey: null, categoryId: action.categoryId || null, qty: 0, spacer: false, image: '' });
      break;
    }
    case 'delete-item': session.items = session.items.filter(item => item.id !== action.id); break;
    case 'save-category': {
      const name = String(action.name || '').trim().slice(0, 160);
      if (!name) throw new Error('Enter a category name.');
      if (session.categories.some(category => category.id !== action.id && categoryName(category, next.preferences.lang).toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('This category already exists.');
      const category = session.categories.find(category => category.id === action.id);
      if (category) { category.name = name; category.defaultKey = null; }
      else session.categories.push({ id: uid(), name, defaultKey: null });
      break;
    }
    case 'delete-category':
      session.categories = session.categories.filter(category => category.id !== action.id);
      if (action.deleteItems) session.items = session.items.filter(item => item.categoryId !== action.id);
      else session.items.forEach(item => { if (item.categoryId === action.id) item.categoryId = null; });
      break;
    case 'move': {
      if (!item) throw new Error('Item not found.');
      const index = session.items.indexOf(item), target = session.items[index + action.direction];
      if (target) { session.items[index] = target; session.items[index + action.direction] = item; }
      break;
    }
    case 'reorder': {
      if (!Array.isArray(action.ids) || action.ids.length !== session.items.length) throw new Error('Invalid item order.');
      const byId = new Map(session.items.map(item => [item.id, item]));
      const seen = new Set();
      session.items = action.ids.map(id => {
        const value = byId.get(id);
        if (!value || seen.has(id)) throw new Error('Invalid item order.');
        seen.add(id); return value;
      });
      break;
    }
    case 'shift':
      session.items = shiftItems(session.items, action.offset); break;
    case 'compact': {
      const items = session.items.filter(value => !value.spacer);
      const columns = Number.isSafeInteger(action.columns) && action.columns > 0 ? action.columns : Math.max(1, items.length);
      const total = Math.ceil(items.length / columns) * columns;
      while (items.length < total) items.push(makeSpacer());
      session.items = items;
      break;
    }
    case 'place': {
      const from = session.items.findIndex(value => value.id === action.id);
      if (from < 0) throw new Error('Item not found.');
      if (!Number.isSafeInteger(action.index) || action.index < 0 || action.index > 10000) throw new Error('Invalid position.');
      const cells = session.items.slice();
      while (cells.length <= action.index) cells.push(null);
      const moving = cells[from];
      cells[from] = null;
      const displaced = cells[action.index];
      cells[action.index] = moving;
      if (displaced) cells[from] = displaced;
      session.items = cells.map(cell => cell || makeSpacer());
      break;
    }
    case 'remove-gap':
      if (!item || !item.spacer) throw new Error('Gap not found.');
      session.items = session.items.filter(value => value.id !== action.id);
      break;
    default: throw new Error('Unknown action.');
  }
  return validateState(next);
}
export function csv(state) {
  const session = activeSession(state), lang = state.preferences.lang;
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['Session', session.name], ['Date', session.date], [], ['Category', 'Item', 'Quantity']];
  for (const item of session.items.filter(item => !item.spacer)) {
    const category = session.categories.find(category => category.id === item.categoryId);
    rows.push([category ? categoryName(category, lang) : '', itemName(item, lang), item.qty]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
