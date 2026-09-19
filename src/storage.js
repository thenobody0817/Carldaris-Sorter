import { createState, migrateLegacy, validateState } from './model.js';
export const STORAGE_KEY = 'countlist.v4';
export function loadState(storage, lang) {
  const current = storage.getItem(STORAGE_KEY);
  if (current !== null) return { state: validateState(JSON.parse(current)), raw: current };
  const legacy = storage.getItem('countlist.v3');
  return { state: legacy ? migrateLegacy(JSON.parse(legacy)) : createState(lang), raw: null };
}
export function createStore(storage, initial) {
  let state = initial.state, expected = initial.raw;
  const undo = [], redo = [];
  function persist(next) {
    if (storage.getItem(STORAGE_KEY) !== expected) throw new Error('Another tab changed these counts. Reload before continuing.');
    next = validateState(next);
    next.revision = state.revision + 1; next.savedAt = new Date().toISOString();
    const raw = JSON.stringify(next);
    storage.setItem(STORAGE_KEY, raw);
    expected = raw; state = next;
  }
  return {
    get state() { return state; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    initialize() { if (expected === null) persist(state); },
    commit(next) {
      const previous = state; persist(next); undo.push(previous);
      if (undo.length > 30) undo.shift(); redo.length = 0;
    },
    undo() { if (undo.length) { const old = state; persist(undo.at(-1)); undo.pop(); redo.push(old); } },
    redo() { if (redo.length) { const old = state; persist(redo.at(-1)); redo.pop(); undo.push(old); } },
  };
}
