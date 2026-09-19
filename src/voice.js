const RU_NUMS = {
  ноль:0, нуль:0,
  один:1, одна:1, одну:1, одно:1,
  два:2, две:2, двух:2,
  три:3, трех:3, трёх:3,
  четыре:4, четырех:4, четырёх:4,
  пять:5, пяти:5,
  шесть:6, шести:6,
  семь:7, семи:7,
  восемь:8, восьми:8,
  девять:9, девяти:9,
  десять:10, десяти:10,
  одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14,
  пятнадцать:15, шестнадцать:16, семнадцать:17, восемнадцать:18,
  девятнадцать:19,
  двадцать:20, тридцать:30, сорок:40, пятьдесят:50,
  шестьдесят:60, семьдесят:70, восемьдесят:80, девяносто:90,
  сто:100, двести:200, триста:300, четыреста:400,
  пятьсот:500, шестьсот:600, семьсот:700, восемьсот:800, девятьсот:900,
};

const EN_NUMS = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
  nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
  fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70,
  eighty:80, ninety:90, hundred:100, thousand:1000
};

const LV_NUMS = {
  nulle:0, viens:1, viena:1, divi:2, divas:2, tris:3, trīs:3, cetri:4,
  četri:4, cetras:4, četras:4, pieci:5, piecas:5, sesi:6, seši:6,
  sesas:6, sešas:6, septini:7, septiņi:7, septinas:7, septiņas:7,
  astoni:8, astoņi:8, astonas:8, astoņas:8, devini:9, deviņi:9,
  devinas:9, deviņas:9, desmit:10, vienpadsmit:11, divpadsmit:12,
  trispadsmit:13, trīspadsmit:13, cetrpadsmit:14, četrpadsmit:14,
  piecpadsmit:15, sespadsmit:16, sešpadsmit:16, septinpadsmit:17,
  septiņpadsmit:17, astonpadsmit:18, astoņpadsmit:18, devinpadsmit:19,
  deviņpadsmit:19, divdesmit:20, trisdesmit:30, trīsdesmit:30,
  cetrdesmit:40, četrdesmit:40, piecdesmit:50, sesdesmit:60,
  sešdesmit:60, septindesmit:70, septiņdesmit:70, astondesmit:80,
  astoņdesmit:80, devindesmit:90, deviņdesmit:90, simts:100
};

const NUM_WORDS = { ru: RU_NUMS, en: EN_NUMS, lv: LV_NUMS };

const VOICE_WORDS = {
  ru: {
    stop:  /(^| )(стоп|хватит|закончить|выключи|выключить)( |$)/,
    plus:  /(^| )(плюс|добав|прибав|плюсуй)( |$)/,
    minus: /(^| )(минус|убери|уменьши|отними)( |$)/
  },
  en: {
    stop:  /(^| )(stop|finish|turn off|off)( |$)/,
    plus:  /(^| )(plus|add|increase)( |$)/,
    minus: /(^| )(minus|remove|subtract|decrease)( |$)/
  },
  lv: {
    stop:  /(^| )(stop|beigt|izslegt|izslēgt|izslēdz)( |$)/,
    plus:  /(^| )(plus|pievieno|pieliec|palielini)( |$)/,
    minus: /(^| )(minus|mīnus|atnem|atņem|nonem|noņem|samazini)( |$)/
  },
  zh: {
    stop:  /(停止|关闭|結束|结束|停)/,
    plus:  /(加|添加|增加|加上)/,
    minus: /(减|減|减去|減去|去掉|减少|減少)/
  }
};

const VOICE_STOP = {
  ru: new Set(['плюс','минус','добавь','прибавь','убери','отними','и','в','на','для','с','к','по','мл','шт','штук','штуки','л','литров','литра']),
  en: new Set(['plus','minus','add','remove','subtract','and','in','on','for','with','to','by','ml','pcs','pieces','l','liters','litre','litres']),
  lv: new Set(['plus','mīnus','minus','pievieno','pieliec','palielini','atņem','atnem','noņem','nonem','samazini','un','ar','uz','par','no','l','ml','gab','gabali']),
  zh: new Set(['加','添加','增加','加上','减','減','减去','減去','去掉','减少','減少','和','的','个','個','升','毫升'])
};

function normalizeText(s){
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parseZhNumber(s){
  const digits = { '零':0,'〇':0,'一':1,'二':2,'两':2,'兩':2,'三':3,'四':4,
                   '五':5,'六':6,'七':7,'八':8,'九':9 };
  const units = { '十':10,'百':100,'千':1000,'万':10000 };
  let total = 0, section = 0, number = 0;
  for (const ch of s){
    if (digits[ch] !== undefined){ number = digits[ch]; }
    else if (units[ch] !== undefined){
      const u = units[ch];
      if (u === 10000){ section = (section + number) * u; total += section; section = 0; number = 0; }
      else { if (number === 0) number = 1; section += number * u; number = 0; }
    }
  }
  return total + section + number;
}

function extractNumber(text){
  const digits = text.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);

  if (curLang() === 'zh'){
    const zh = String(text).match(/[零〇一二两兩三四五六七八九十百千万萬]+/);
    return zh ? parseZhNumber(zh[0].replaceAll('萬','万')) : null;
  }

  const map = NUM_WORDS[curLang()] || RU_NUMS;
  const words = normalizeText(text).split(/\s+/);
  let sum = 0, section = 0, found = false;
  for (const w of words){
    const n = map[w];
    if (n !== undefined){
      if (n === 100) section = Math.max(1, section) * 100;
      else if (n >= 1000) { sum += Math.max(1, section) * n; section = 0; }
      else section += n;
      found = true;
    }
  }
  return found ? sum + section : null;
}

export function interpretVoice(raw, lang, items) {
  currentLanguage = lang;
  const text = normalizeText(raw);
  const words = VOICE_WORDS[lang] || VOICE_WORDS.en;
  if (words.stop.test(text)) return { type: 'stop' };
  const plus = words.plus.test(text) || /\+/.test(raw);
  const minus = words.minus.test(text) || /-/.test(raw);
  if (plus && minus) return { type: 'unknown' };
  const names = items.filter(item => text.includes(normalizeText(item.name)));
  if (names.length > 1) return { type: 'ambiguous' };
  if (plus || minus) {
    const number = extractNumber(names.length ? text.replace(normalizeText(names[0].name), '') : raw);
    return { type: 'count', id: names[0]?.id, delta: (minus ? -1 : 1) * (number === null ? 1 : number) };
  }
  if (names.length === 1) return { type: 'select', id: names[0].id };
  return { type: 'unknown' };
}
let currentLanguage = 'en';
function curLang() { return currentLanguage; }
