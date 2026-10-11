// events.js - the event sink used while one action is applied.
//
// `applyAction` RETURNS the events of that action; the game state carries no
// log. docs/engine-contract.md, "Events", gives the reasons (a log inside the
// state would be copied by every cloneState, and Monte Carlo search clones
// constantly).
//
// The sink is a module variable that is open only for the length of one
// applyAction call. Mutators call `emit(record)` freely; when the caller asked
// for no events the record is dropped. Nothing here outlives the call, so the
// engine stays a pure function of (state, action).

let sink = null;
let sequence = 0;

/** Opens the sink. `collect` false means every emit is dropped (fast path). */
export function openEventSink(collect, seq) {
  sink = collect ? [] : null;
  sequence = seq;
}

/** Closes the sink and returns what was collected (an array, or null). */
export function closeEventSink() {
  const out = sink;
  sink = null;
  return out;
}

/** Tells the sink which applied action the following events belong to. */
export function setEventSeq(seq) {
  sequence = seq;
}

/** Whether events are being collected. Use to skip building a costly record. */
export function eventsOn() {
  return sink !== null;
}

/**
 * Appends one event. `record` must be plain JSON with a string `type`.
 * The engine stamps `seq`, the number of the applied action it belongs to.
 */
export function emit(record) {
  if (sink === null) return;
  record.seq = sequence;
  sink.push(record);
}
