/* Diagnostic probes for the original app, not acceptance tests for the rewrite.
 * Executes selected original functions with synthetic state; never opens or
 * modifies browser storage. Run: node scripts/audit-legacy.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../legacy/index.html'), 'utf8');
function fn(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `Original function ${name} exists`);
  return match[0];
}
function run(names, context, expression) {
  return vm.runInNewContext(names.map(fn).join('\n') + '\n' + expression, context);
}
async function main() {
  const results = [];
  const state = {
    categories: ['Empty crates'],
    items: [
      { id: 'crateGrnE', name: 'My renamed crate', category: 'Empty crates' },
      { id: 'custom', name: 'Custom crate', category: 'Empty crates' },
    ],
  };
  run(['localizeDefaults'], {
    state,
    DEFAULT_ITEMS: {
      en: [{ id: 'crateGrnE', name: 'Green crate', category: 'Empty crates' }],
      lv: [{ id: 'crateGrnE', name: 'Zaļā kaste', category: 'Tukšās kastes' }],
    },
  }, "localizeDefaults('lv')");
  assert.equal(state.items[0].name, 'Zaļā kaste');
  assert.equal(state.categories.includes(state.items[1].category), false);
  results.push('Language change overwrites a custom default-item name and orphans a custom item category.');

  const quantityState = { items: [{ id: 'x', qty: '5' }] };
  run(['bumpItem'], {
    state: quantityState, save() {}, render() {}, flashTile() {}, navigator: {},
  }, "bumpItem('x', 1)");
  assert.equal(quantityState.items[0].qty, 51);
  results.push('A stored string quantity of "5" increments to 51.');

  let delta;
  run(['processVoiceCommand'], {
    normalizeText: s => s, console: { log() {} }, curLang: () => 'en',
    VOICE_WORDS: { en: { stop: /stop/, plus: /plus/, minus: /minus/ } },
    qbId: 'x', extractNumber: () => 0, qbBump: n => { delta = n; },
    state: { items: [{ id: 'x', name: 'Crate' }] }, showToast() {},
  }, "processVoiceCommand('plus zero')");
  assert.equal(delta, 1);
  results.push('Voice input "plus zero" adds one.');

  const resetState = { date: '2020-01-01', label: 'Old', items: [{ qty: 8 }] };
  await run(['resetAll'], {
    state: resetState, showPick: async () => 'yes', t: s => s,
    document: { getElementById: () => ({ value: '', classList: { remove() {} } }) },
    save() {}, render() {}, requestAnimationFrame() {}, fitTiles() {},
  }, 'resetAll()');
  assert.equal(resetState.items[0].qty, 0);
  assert.equal(resetState.date, '2020-01-01');
  results.push('Reset clears quantities but retains the old session date.');

  const saveState = { savedAt: 0 };
  let warned = false;
  const returned = run(['save'], {
    state: saveState, KEY: 'test',
    localStorage: { setItem() { throw new Error('quota exceeded'); } },
    console: { warn() { warned = true; } },
  }, 'save()');
  assert.ok(warned);
  assert.ok(saveState.savedAt > 0);
  assert.equal(returned, undefined);
  results.push('Failed persistence updates savedAt and returns no failure signal to the UI.');

  for (const result of results) console.log(`CONFIRMED: ${result}`);
  console.log(`${results.length} legacy issue probes reproduced. These are diagnostic confirmations, not passing product acceptance tests.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });


