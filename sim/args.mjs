// args.mjs - the command line of the simulator.
//
// ONE table (FLAGS, plus PREFIX_FLAGS for the dotted families) describes every
// flag. The same table validates the input and generates --help, so the two
// cannot drift apart. An unknown flag, a malformed value, an unknown variant, an
// illegal variant value, an unknown constant and an unknown bot level all stop
// the run with a message BEFORE any game is played (UsageError, exit code 2).

import os from 'node:os';
import {
  RULES,
  VARIANTS,
  createGame,
  parseVariantValue,
  resolveVariants,
  nonDefaultVariants,
  activeModules,
} from '../src/engine/index.js';
import { BOT_LEVELS, botLevelIds, getBot } from '../src/bots/index.js';

/** A problem with how the simulator was called. The message is for the person at the keyboard. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** The bot used when --bots is not given: Medium once it is registered, otherwise Random. */
export function defaultBotLevel() {
  return botLevelIds().includes('medium') ? 'medium' : 'random';
}

export function defaultThreads() {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, cores - 1);
}

/** The largest number of games a run may ask for. */
export const MAX_GAMES = 10_000_000;

/**
 * Every plain flag. `type`: int, number, string, list, bool, tribool (true / false / left to the default).
 * `default` may be a function (evaluated when --help is printed and when options are resolved).
 */
export const FLAGS = [
  { name: 'games', type: 'int', min: 1, max: MAX_GAMES, default: 100, arg: 'N', help: 'Games per arm.' },
  { name: 'players', type: 'int', values: [2, 3, 4], default: 4, arg: '2|3|4', help: 'Players per game.' },
  {
    name: 'bots',
    type: 'list',
    default: defaultBotLevel,
    arg: 'LEVELS',
    help: 'Bot level for each seat, comma separated (one level per seat), or one level for every seat. Any registered level (medium once it is registered, otherwise random, when omitted).',
  },
  {
    name: 'rotate',
    type: 'bool',
    help: 'Rotate which seat each bot of --bots takes from one game to the next, so that each bot sits in each seat equally often. Results are reported by seat and by bot type.',
  },
  { name: 'shuffle-seats', type: 'bool', help: 'Let the engine shuffle the seat order (R3.2) instead of seating --bots in the order given. Off by default so that "seat 1" means the bot written first.' },
  { name: 'seed', type: 'string', default: '1', arg: 'TEXT', help: 'Base seed. Game k of an arm uses the seed "<seed>-<k>", so a game is the same game whatever the thread count. The default is a fixed seed (1): run again with another --seed for an independent sample.' },
  { name: 'jitter', type: 'number', min: 0, arg: 'X', help: 'Small random tie-break per bot decision, passed to the bots as `jitter`. Without it, identical deterministic bots manufacture a first-player advantage; never report a turn-order figure without it.' },
  { name: 'weights-seat', type: 'int', min: 1, max: 4, arg: 'N', help: 'Apply the --weights.<name> values only to the Nth bot of --bots (1 to 4), which then reports as "<level>+w" and keeps its weights as it rotates. Without it the weights go to every bot.' },
  { name: 'baseline', type: 'bool', help: 'Also run a control arm on the same seeds with NO --variant / --const overrides, in the same invocation. Both arms go in one output file, with a comparison block.' },
  { name: 'label', type: 'string', arg: 'TEXT', help: 'Name for the output file (lower case, digits and hyphens). Default: built from the bots, players and games.' },
  { name: 'out', type: 'string', arg: 'PATH', help: 'Output file. Default: sim-results/<yyyymmdd-hhmm>-<label>.json. An existing file is never overwritten: -2, -3 are added.' },
  { name: 'threads', type: 'int', min: 1, max: 256, default: defaultThreads, arg: 'N', help: 'Worker threads (1 plays in this process). Results do not depend on it. Default: cores minus one.' },
  { name: 'fast', type: 'bool', help: 'No events: final scores, end reasons, turns, decisions and the driver\'s action counts only, plus what the final state shows for free (routes, buildings, leftovers, module state). About a third faster.' },
  { name: 'budget', type: 'number', min: 0, arg: 'MS', help: 'Thinking time per TURN in ms for time-budgeted bots (hard, expert; a turn is several small decisions and the bot shares the time between them). Default: the level\'s own. Time-budgeted games are NOT reproducible; use --iterations.' },
  { name: 'iterations', type: 'int', min: 1, arg: 'N', help: 'Fixed search iterations per TURN instead of a time budget (makes search bots reproducible; every search seat gets the same number).' },
  { name: 'keep-games', type: 'tribool', help: 'Write the per-game records. Default: yes up to 5,000 games per arm, summarised beyond that unless this is given.' },
  { name: 'max-decisions', type: 'int', min: 100, max: 10_000_000, default: 20000, arg: 'N', help: 'Hard cap on decisions in one game: an independent livelock guard. A game that reaches it is recorded as a failure and the run exits non-zero.' },
  { name: 'quiet', type: 'bool', help: 'No progress line on stderr.' },
  { name: 'help', type: 'bool', help: 'Print this help.' },
];

/** The dotted flag families. */
export const PREFIX_FLAGS = [
  { prefix: 'variant.', usage: '--variant.<name>=<value>', help: 'Play with a rules variant (any name of the table below; validated by the engine). Applies to the test arm only when --baseline is given.' },
  { prefix: 'const.', usage: '--const.<GROUP>.<name>=<value>', help: 'Override a tuning constant of rules.js through createGame (recorded in the state), for example --const.SCORING.firstConnectionVp=3. Deeper paths and JSON values are allowed (--const.SCORING.goalVp=[8,4]). Test arm only when --baseline is given.' },
  { prefix: 'weights.', usage: '--weights.<name>=<number>', help: 'A weight for an archetype bot, passed through the bot context as `weights`. See --weights-seat.' },
];

const BY_NAME = new Map(FLAGS.map((f) => [f.name, f]));

function resolveDefault(flag) {
  return typeof flag.default === 'function' ? flag.default() : flag.default;
}

function parseInteger(flag, text) {
  if (!/^-?\d+$/.test(text)) throw new UsageError(`--${flag.name} needs a whole number, not "${text}".`);
  return Number(text);
}

function parseNumber(flag, text) {
  if (text.trim() === '' || !Number.isFinite(Number(text))) throw new UsageError(`--${flag.name} needs a number, not "${text}".`);
  return Number(text);
}

function checkRange(flag, value) {
  if (flag.values && !flag.values.includes(value)) throw new UsageError(`--${flag.name} must be one of ${flag.values.join(', ')}, not ${value}.`);
  if (flag.min !== undefined && value < flag.min) throw new UsageError(`--${flag.name} must be at least ${flag.min}, not ${value}.`);
  if (flag.max !== undefined && value > flag.max) throw new UsageError(`--${flag.name} must be at most ${flag.max}, not ${value}.`);
}

function parseBoolean(flag, text) {
  if (text === undefined || text === 'true') return true;
  if (text === 'false') return false;
  throw new UsageError(`--${flag.name} is a switch: use --${flag.name} or --${flag.name}=false, not "${text}".`);
}

/**
 * Parses argv (without node and the script) into raw, unvalidated-against-the-engine values.
 * @returns {{ options: object, variantText: object, constantText: Array, weightText: object }}
 */
export function parseArgs(argv) {
  const options = {};
  const variantText = {};
  const constantText = [];
  const weightText = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) throw new UsageError(`Unexpected argument "${arg}". Every option starts with "--"; try --help.`);
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const text = eq === -1 ? undefined : arg.slice(eq + 1);
    if (name === '') throw new UsageError(`Unexpected argument "${arg}".`);
    const flag = BY_NAME.get(name);
    if (flag) {
      if (flag.type === 'bool') options[name] = parseBoolean(flag, text);
      else if (flag.type === 'tribool') options[name] = parseBoolean(flag, text);
      else {
        if (text === undefined || text === '') throw new UsageError(`--${name} needs a value: --${name}=${flag.arg ?? 'VALUE'}.`);
        if (flag.type === 'int') {
          options[name] = parseInteger(flag, text);
          checkRange(flag, options[name]);
        } else if (flag.type === 'number') {
          options[name] = parseNumber(flag, text);
          checkRange(flag, options[name]);
        } else if (flag.type === 'list') options[name] = text.split(',').map((s) => s.trim());
        else options[name] = text;
      }
      continue;
    }
    const family = PREFIX_FLAGS.find((p) => name.startsWith(p.prefix));
    if (family) {
      const rest = name.slice(family.prefix.length);
      if (rest === '') throw new UsageError(`"${arg}" has no name after "${family.prefix}". Usage: ${family.usage}.`);
      if (text === undefined || text === '') throw new UsageError(`--${name} needs a value. Usage: ${family.usage}.`);
      if (family.prefix === 'variant.') variantText[rest] = text;
      else if (family.prefix === 'weights.') weightText[rest] = text;
      else constantText.push({ path: rest.split('.'), text });
      continue;
    }
    throw new UsageError(`Unknown option "--${name}". Try --help for the list.`);
  }
  return { options, variantText, constantText, weightText };
}

function kindOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/** Reads the current value of a constant at a path of RULES, or undefined. */
function constantAt(path) {
  let node = RULES;
  for (const key of path) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Turns the text of a --const flag into a value of the right kind. The engine checks the
 * NAME of a constant but accepts any value for it, so the kind is checked here: a number
 * constant must be given a number, a string constant a string, and so on.
 */
function parseConstantValue(path, text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text; // a bare word is a string
  }
  const current = constantAt(path);
  const label = path.join('.');
  if (current === undefined) return value; // unknown name: the engine's own message follows
  const want = kindOf(current);
  const got = kindOf(value);
  if (want !== got) throw new UsageError(`Illegal value "${text}" for constant "${label}": it is ${want === 'array' ? 'an array' : `a ${want}`}, not ${got === 'array' ? 'an array' : `a ${got}`}.`);
  if (want === 'array' && current.length > 0 && value.length > 0) {
    const wantElement = kindOf(current[0]);
    for (const element of value) {
      if (kindOf(element) !== wantElement) throw new UsageError(`Illegal value "${text}" for constant "${label}": its entries must be ${wantElement}s.`);
    }
  }
  return value;
}

/** Folds [{ path, value }] into a nested override object, the shape createGame takes. */
function nestConstants(entries) {
  const out = {};
  for (const { path, value } of entries) {
    let node = out;
    for (let i = 0; i < path.length - 1; i++) {
      if (typeof node[path[i]] !== 'object' || node[path[i]] === null || Array.isArray(node[path[i]])) node[path[i]] = {};
      node = node[path[i]];
    }
    node[path[path.length - 1]] = value;
  }
  return out;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validates everything against the engine and the bot registry and returns the plan:
 * plain JSON that the main thread and every worker read. Throws UsageError.
 */
export function resolveOptions(parsed) {
  const { options, variantText, constantText, weightText } = parsed;
  const get = (name) => (options[name] !== undefined ? options[name] : resolveDefault(BY_NAME.get(name)));

  const players = get('players');
  const games = get('games');

  // Bots
  const botNames = options.bots ?? [defaultBotLevel()];
  if (botNames.some((b) => b === '')) throw new UsageError('--bots has an empty entry. Give a level for each seat: --bots=medium,medium,easy.');
  if (botNames.length !== 1 && botNames.length !== players) {
    throw new UsageError(`--bots gives ${botNames.length} levels for ${players} players: give one level for every seat, or exactly ${players}.`);
  }
  for (const level of botNames) {
    try {
      getBot(level);
    } catch (err) {
      throw new UsageError(err.message);
    }
  }
  const slotLevels = botNames.length === 1 ? Array(players).fill(botNames[0]) : botNames;

  // Weights
  const weights = {};
  for (const [name, text] of Object.entries(weightText)) {
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) throw new UsageError(`--weights.${name} needs a number, not "${text}".`);
    weights[name] = value;
  }
  const hasWeights = Object.keys(weights).length > 0;
  const weightsSeat = options['weights-seat'];
  if (weightsSeat !== undefined && !hasWeights) throw new UsageError('--weights-seat needs at least one --weights.<name>=<number>.');
  if (weightsSeat !== undefined && weightsSeat > players) throw new UsageError(`--weights-seat=${weightsSeat} is more than the ${players} players.`);
  const bots = slotLevels.map((level, i) => {
    const gets = hasWeights && (weightsSeat === undefined || weightsSeat === i + 1);
    return { level, weights: gets ? { ...weights } : null, type: gets && weightsSeat !== undefined ? `${level}+w` : level };
  });

  // Variants: typed by the engine's own parser, then checked as a whole.
  const variantOverrides = {};
  for (const [name, text] of Object.entries(variantText)) {
    try {
      variantOverrides[name] = parseVariantValue(name, text);
    } catch (err) {
      throw new UsageError(err.message);
    }
  }
  let variants;
  try {
    variants = resolveVariants(variantOverrides);
  } catch (err) {
    throw new UsageError(err.message);
  }

  // Constants
  const constants = nestConstants(constantText.map(({ path, text }) => ({ path, value: parseConstantValue(path, text) })));
  const hasConstants = constantText.length > 0;

  // The engine has the last word: build one game of each arm now, so that a name or value it
  // refuses stops the run before the first game.
  try {
    createGame({ playerCount: players, seed: 'sim-validate', variants: variantOverrides, ...(hasConstants ? { constants } : {}) });
  } catch (err) {
    throw new UsageError(err.message);
  }

  const baseline = get('baseline') === true;
  if (baseline && Object.keys(variantOverrides).length === 0 && !hasConstants) {
    throw new UsageError('--baseline compares against the game with no --variant or --const overrides, so it needs at least one of them. (Without one, both arms would be the same games.)');
  }

  const fast = get('fast') === true;
  const keepOption = options['keep-games'];
  const keepGames = keepOption === undefined ? games <= 5000 : keepOption;
  const seed = String(get('seed'));
  const label = options.label !== undefined ? slug(options.label) : null;
  if (options.label !== undefined && label === '') throw new UsageError('--label has no letters or digits to build a file name from.');

  const armOf = (name, variantSet, constantSet) => ({
    name,
    variants: variantSet,
    variantsResolved: resolveVariants(variantSet),
    variantsNonDefault: nonDefaultVariants(resolveVariants(variantSet)),
    constants: constantSet,
  });
  const arms = [armOf('test', variantOverrides, hasConstants ? constants : {})];
  if (baseline) arms.push(armOf('baseline', {}, {}));

  const timeBudgeted = bots.some((b) => (BOT_LEVELS.find((l) => l.id === b.level)?.defaultTimeBudgetMs ?? 0) > 0) && options.iterations === undefined;

  return {
    schema: 1,
    games,
    players,
    bots,
    rotate: get('rotate') === true,
    shuffleSeats: get('shuffle-seats') === true,
    seed,
    jitter: options.jitter ?? null,
    weights: hasWeights ? weights : null,
    weightsSeat: weightsSeat ?? null,
    budget: options.budget ?? null,
    iterations: options.iterations ?? null,
    timeBudgeted,
    baseline,
    label,
    out: options.out ?? null,
    threads: get('threads'),
    mode: fast ? 'fast' : 'full',
    keepGames,
    maxDecisions: get('max-decisions'),
    quiet: get('quiet') === true,
    help: get('help') === true,
    modulesOn: activeModules(variants),
    arms,
  };
}

/** The --help text, generated from the flag tables and the engine's variant table. */
export function helpText() {
  const lines = [];
  lines.push('Continental Rails simulator: plays bot-versus-bot games headless and reports balance statistics.');
  lines.push('');
  lines.push('Usage: node sim/sim.mjs [options]        (or: npm run sim -- [options])');
  lines.push('');
  lines.push('Options');
  const left = (f) => `--${f.name}${f.type === 'bool' || f.type === 'tribool' ? '' : `=${f.arg ?? 'VALUE'}`}`;
  const width = Math.max(...FLAGS.map((f) => left(f).length), ...PREFIX_FLAGS.map((p) => p.usage.length)) + 2;
  const wrap = (text, indent) => {
    const out = [];
    let line = '';
    for (const word of text.split(' ')) {
      if (line.length + word.length + 1 > 100 - indent) {
        out.push(line);
        line = word;
      } else line = line === '' ? word : `${line} ${word}`;
    }
    out.push(line);
    return out.map((l, i) => (i === 0 ? l : ' '.repeat(indent) + l)).join('\n');
  };
  for (const f of FLAGS) {
    const d = resolveDefault(f);
    const shown = d === undefined ? '' : ` [default: ${Array.isArray(d) ? d.join(',') : d}]`;
    lines.push(`  ${left(f).padEnd(width)}${wrap(f.help + shown, width + 2)}`);
  }
  for (const p of PREFIX_FLAGS) lines.push(`  ${p.usage.padEnd(width)}${wrap(p.help, width + 2)}`);
  lines.push('');
  lines.push(`Bot levels registered now: ${BOT_LEVELS.map((l) => l.id).join(', ')}.`);
  lines.push('');
  lines.push('Rules variants (--variant.<name>=<value>); the default is marked with *');
  for (const v of VARIANTS) {
    let allowed;
    if (v.type === 'enum') allowed = v.values.map((x) => (x === v.default ? `${x}*` : x)).join(' | ');
    else if (v.type === 'boolean') allowed = v.default ? 'true* | false' : 'true | false*';
    else if (v.type === 'integer') allowed = `${v.min}..${v.max} (default ${v.default})`;
    else allowed = `${v.values.join(' | ')} | ${v.min}..${v.max} (default ${v.default})`;
    lines.push(`  ${v.name.padEnd(24)}${allowed}`);
  }
  lines.push('');
  lines.push('Exit codes: 0 all games played cleanly; 1 a game was refused, hit the decision cap, crashed or failed a bookkeeping check (results are still written); 2 the command line was wrong.');
  return lines.join('\n');
}

export { slug };
