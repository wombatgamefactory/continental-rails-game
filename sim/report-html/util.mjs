// util.mjs - small helpers shared by the report modules: escaping, number formatting
// (never prints undefined or NaN), and the plain-English labels.
//
// Every formatter returns the en dash for a value that does not exist, so a missing
// figure reads as "no data" instead of leaking a JavaScript artefact into the page.

export const DASH = '–';

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** toFixed without "-0.0". */
export function fixed(x, d = 1) {
  if (!isNum(x)) return DASH;
  const s = x.toFixed(d);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** A fraction (0.26) as a percentage with one decimal place: "26.0%". */
export function pct(x, d = 1) {
  return isNum(x) ? `${fixed(x * 100, d)}%` : DASH;
}

/** A number that is already a percentage: "26.6%". */
export function pctNum(x, d = 1) {
  return isNum(x) ? `${fixed(x, d)}%` : DASH;
}

/** Signed number: "+1.5" / "-1.5". */
export function signed(x, d = 1, suffix = '') {
  if (!isNum(x)) return DASH;
  const s = fixed(x, d);
  return `${s.startsWith('-') ? '' : '+'}${s}${suffix}`;
}

/** Signed difference of two fractions in percentage points: "+9.0 pp". */
export function pp(x, d = 1) {
  return isNum(x) ? signed(x * 100, d, ' pp') : DASH;
}

export function int(x) {
  return isNum(x) ? String(Math.round(x)) : DASH;
}

/** Thousands separators for counts, British style. */
export function count(x) {
  return isNum(x) ? Math.round(x).toLocaleString('en-GB') : DASH;
}

export function plural(n, one, many = `${one}s`) {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** A standard error as "+/- 4.4". */
export function pm(x, d = 1, isFraction = false) {
  if (!isNum(x)) return '';
  return `±${fixed(isFraction ? x * 100 : x, d)}${isFraction ? ' pp' : ''}`;
}

/** DD/MM/YYYY (Europe/London) from an ISO string. */
export function ukDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return DASH;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  return parts; // en-GB gives DD/MM/YYYY
}

export function ukDateTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return DASH;
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${ukDate(iso)} ${t}`;
}

/** camelCase / kebab-case / snake_case id -> "Sentence case words". */
export function humanise(id) {
  const s = String(id ?? '')
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : DASH;
}

/** Safe dotted-path read: returns undefined when any step is missing. */
export function get(obj, path) {
  let o = obj;
  for (const p of path.split('.')) {
    if (o === null || o === undefined) return undefined;
    o = o[p];
  }
  return o;
}

export const arr = (x) => (Array.isArray(x) ? x : []);
export const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

/** Standard error of a proportion (used only where the file gives none). */
export function propSe(p, n) {
  return isNum(p) && isNum(n) && n > 0 ? Math.sqrt((p * (1 - p)) / n) : null;
}

// ---------------------------------------------------------------------------
// Plain-English labels
// ---------------------------------------------------------------------------

/** VP sources in rules order, with the plain-English labels the brief gives. */
export const VP_SOURCES = [
  ['track', 'Track laid'],
  ['firstConnection', 'First connections'],
  ['completion', 'Transcontinental bonus'],
  ['telegraph', 'Telegraph stations'],
  ['toll', 'Tolls'],
  ['congress', 'Congress'],
  ['upgrades', 'Carriage upgrades'],
  ['milestones', 'Milestones'],
  ['legislative', 'Legislative Agenda'],
  ['ponyCards', 'Pony Express cards'],
  ['buildingsEnd', 'Buildings (end of game)'],
  ['goals', 'Goals'],
  ['ponyEnd', 'Pony Express (end of game)'],
];
export const VP_LABEL = Object.fromEntries(VP_SOURCES);
export const FINAL_SOURCES = new Set(['buildingsEnd', 'goals', 'ponyEnd']);

/** Position of a source in the colour table; unknown sources get the spare slots. */
export function sourceIndex(id) {
  const i = VP_SOURCES.findIndex(([k]) => k === id);
  if (i >= 0) return i;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return VP_SOURCES.length + (h % 3);
}
export const vpLabel = (id) => VP_LABEL[id] ?? String(id);

export const END_REASON_LABEL = {
  transcontinental: 'Transcontinental line completed',
  'routes-claimed': 'Routes all claimed',
  'turn-limit': 'Turn limit (safety stop)',
};
export const endLabel = (id) => END_REASON_LABEL[id] ?? humanise(id);

const ACTION_LABEL = {
  placeWorker: 'Place a worker',
  removeWorker: 'Remove a worker',
  displaceWorker: 'Displace a worker',
  chooseDistrict: 'Choose a district',
  chooseResource: 'Choose a resource',
  useStep: 'Use a train step',
  endFreeActions: 'End free actions',
  claimRoute: 'Claim a route',
  moveTrain: 'Move the train',
  stopLaying: 'Stop laying track',
  placeRailwayStation: 'Place a railway station',
  placeTelegraphStation: 'Place a telegraph station',
  placeRailhead: 'Place a railhead',
  exchangeToken: 'Exchange a Pony Express token',
  buyPonyCard: 'Buy a Pony Express card',
  buyHat: 'Buy a cowboy hat',
  hireSpecialist: 'Hire a specialist',
  addCarriage: 'Add a carriage',
  installUpgrade: 'Install a carriage upgrade',
  takeCongressEntry: 'Take a Congress entry',
  closeCongress: 'Close Congress',
  skipBonusAction: 'Skip the bonus action',
  skipStep: 'Skip a step',
  skipEffect: 'Skip an effect',
  skipBuilding: 'Skip building',
  chooseBuiltTile: 'Choose a built tile',
  chooseForemanType: 'Choose the foreman type',
  chooseOption: 'Choose an option',
  chooseStartingProduction: 'Choose starting production',
  chooseStartingSpecialist: 'Choose starting specialist',
  discard: 'Discard (storage overflow)',
};
export const actionLabel = (id) => ACTION_LABEL[id] ?? humanise(id);

const KIND_LABEL = {
  workerStep: 'Worker step',
  trainActivation: 'Train activation',
  layTracks: 'Lay Track',
  placeBuildings: 'Place buildings',
  freeActions: 'Free actions',
  freeCongress: 'Congress',
  bonusAction: 'Bonus action',
  hireSpecialist: 'Hire a specialist',
  addCarriage: 'Add a carriage',
};
export const kindLabel = (id) => KIND_LABEL[id] ?? humanise(id);

const RESOURCE_LABEL = { iron: 'Iron', wood: 'Wood', gunpowder: 'Gunpowder', coins: 'Coins', hats: 'Cowboy hats', ground: 'Ground', tunnel: 'Tunnel', bridge: 'Bridge' };
export const resLabel = (id) => RESOURCE_LABEL[id] ?? humanise(id);

const BONUS_LABEL = { hire: 'Hire a specialist', hat: 'Buy a cowboy hat', carriage: 'Add a carriage', upgrade: 'Install an upgrade' };
export const bonusLabel = (id) => BONUS_LABEL[id] ?? humanise(id);

/** Position names of the 3 x 3 grid (row, column), for the default fixed layout. */
const POSITION = { D1: 'top left', D2: 'top centre', D3: 'top right', D4: 'middle left', D5: 'centre', D6: 'middle right', D7: 'bottom left', D8: 'bottom centre', D9: 'bottom right' };
const FIXED_TILE = {
  D1: 'Gather Gunpowder', D2: 'Lobby Congress', D3: 'Gather Iron', D4: 'Ground Tracks', D5: 'Lay Tracks / Move Train',
  D6: 'Bridge Tracks', D7: 'Gather Wood', D8: 'Tunnel Tracks', D9: 'Gather Coins',
};
export function districtLabel(id, fixedLayout) {
  if (id === 'none') return 'No district (R5.4.4)';
  if (!POSITION[id]) return String(id);
  return fixedLayout ? `${id} ${POSITION[id]}: ${FIXED_TILE[id]}` : `${id} (${POSITION[id]})`;
}

/** Item names by id, filled from the engine's rules table when it can be imported. */
export const NAMES = { upgrades: {}, milestones: {}, goals: {}, legislative: {}, pony: {} };
export function itemLabel(module, id) {
  const n = NAMES[module]?.[id];
  return n ? `${id} ${n}` : String(id);
}
