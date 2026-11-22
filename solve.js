// solve.js — a fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) returns exactly the answer csv-reader 1.0.0 returns for the case's
// input {text, header}: {columns, rows, errors}. The reading policy is the
// reference's own, reproduced field for field:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled: "" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows the closing quote, up to the next comma or
//     line break, is appended as it stands (error quote_junk, when anything
//     was appended); a quote that never closes is a literal character and the
//     text after it is read again as unquoted (error unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (error short_row, with fields: its count) or cut (error
//     long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (counting every LF, CRLF and lone CR inside quotes), row its
//     record's index in rows, null for the header, in the order met.
//
// Where the reference builds one object graph and a driver JSON.stringifies
// it, this module transduces: it walks the text once and writes the answer's
// JSON text directly. Field values are carried as slices of the input (or a
// short parts list when a stray CR, a doubled quote or a CR inside quotes
// forces a join), and no row objects, no answer graph and no second walk over
// the values ever exist.
//
// answerJson(text, header) is the transducer itself: the answer for one case
// as JSON text. run(input) is the contract the task names: the same answer
// as a value.

/** Field endings: at a comma, at a line break, at the end of the text. */
const ENDED_COMMA = 0;
const ENDED_LINE_BREAK = 1;
const ENDED_END = 2;

/**
 * One field value as a JSON string literal. `dirty` is the field readers'
 * word that the value holds a character JSON cannot carry raw (they meet
 * every character as they scan, so their word is exact); when it is false
 * the literal is the value between quotes, untouched.
 */
function emitString(value, dirty) {
  if (!dirty) return '"' + value + '"';
  let out = '"';
  let last = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    let esc = null;
    if (c === 34) esc = '\\"';
    else if (c === 92) esc = '\\\\';
    else if (c === 10) esc = '\\n';
    else if (c === 13) esc = '\\r';
    else if (c === 9) esc = '\\t';
    else if (c === 8) esc = '\\b';
    else if (c === 12) esc = '\\f';
    else if (c < 32) esc = '\\u00' + (c < 16 ? '0' : '') + c.toString(16);
    if (esc !== null) {
      out += value.slice(last, i) + esc;
      last = i + 1;
    }
  }
  return out + value.slice(last) + '"';
}

/**
 * The answer for one case's {text, header}, as JSON text.
 * A single left-to-right pass over the text, mirroring the reference reader's
 * state machine decision for decision.
 */
export function answerJson(text, header) {
  const T = text;
  const N = T.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (T.charCodeAt(0) === 0xfeff) pos = 1; // a BOM at the very start is dropped

  // The record being read: the line it starts on, its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  const errParts = []; // one JSON object text per error, in the order met
  const rowParts = []; // one JSON array text per row
  let columnsJson = null; // the header record's JSON array text, once read
  let width = -1; // the first record's field count
  let rowsCount = 0;

  // The field just read, shared through these slots instead of an object.
  let fValue = '';
  let fEnded = ENDED_END;
  let fKept = 0; // characters the last unquoted read kept (the quote_junk test)
  let fDirty = false; // the value holds a character JSON cannot carry raw

  function pushError(code) {
    errParts.push(
      '{"code":"' + code + '","line":' + recordLine + ',"row":' +
        (recordRow === null ? 'null' : recordRow) + '}',
    );
  }

  /** The value in the segments parts[0..] plus the open segment [segStart, end). */
  function collect(parts, segStart, end) {
    if (parts === null) return T.slice(segStart, end);
    parts.push(T.slice(segStart, end));
    return parts.join('');
  }

  /**
   * Reads unquoted characters from pos up to the next comma or line break.
   * A CR not followed by LF is dropped (stray_cr). Sets fValue, fEnded, fKept.
   */
  function readUnquoted() {
    let segStart = pos;
    let parts = null;
    let kept = 0;
    let dirty = false;
    while (pos < N) {
      const c = T.charCodeAt(pos);
      if (c > 44) { // past every terminator: a plain character (a backslash is not)
        if (c === 92) dirty = true;
        pos += 1;
        continue;
      }
      if (c === 44) { // ','
        fValue = collect(parts, segStart, pos);
        fKept = kept + (pos - segStart);
        fDirty = dirty;
        pos += 1;
        fEnded = ENDED_COMMA;
        return;
      }
      if (c === 10) { // LF
        fValue = collect(parts, segStart, pos);
        fKept = kept + (pos - segStart);
        fDirty = dirty;
        pos += 1;
        line += 1;
        fEnded = ENDED_LINE_BREAK;
        return;
      }
      if (c === 13) { // CR
        if (T.charCodeAt(pos + 1) === 10) { // CRLF
          fValue = collect(parts, segStart, pos);
          fKept = kept + (pos - segStart);
          fDirty = dirty;
          pos += 2;
          line += 1;
          fEnded = ENDED_LINE_BREAK;
          return;
        }
        // A lone CR outside quotes is dropped.
        if (parts === null) parts = [];
        parts.push(T.slice(segStart, pos));
        kept += pos - segStart;
        pushError('stray_cr');
        pos += 1;
        segStart = pos;
        continue;
      }
      // A quote or a control character: kept, and JSON cannot carry it raw.
      if (c === 34 || c < 32) dirty = true;
      pos += 1;
    }
    fValue = collect(parts, segStart, N);
    fKept = kept + (N - segStart);
    fDirty = dirty;
    fEnded = ENDED_END;
  }

  /** Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded. */
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1; // the opening quote
    const contentStart = pos;
    let segStart = pos;
    let parts = null;
    let closed = false;
    let dirty = false;
    while (pos < N) {
      const c = T.charCodeAt(pos);
      if (c > 34) { // past the quote and both line breaks: plain content
        if (c === 92) dirty = true;
        pos += 1;
        continue;
      }
      if (c === 34) { // '"'
        if (T.charCodeAt(pos + 1) === 34) { // a doubled quote is one quote
          if (parts === null) parts = [];
          parts.push(T.slice(segStart, pos), '"');
          dirty = true; // the value gains a quote
          pos += 2;
          segStart = pos;
          continue;
        }
        pos += 1; // the closing quote
        closed = true;
        break;
      }
      if (c === 13) { // CRLF and a lone CR inside quotes are each one LF
        if (parts === null) parts = [];
        parts.push(T.slice(segStart, pos), '\n');
        dirty = true; // the value gains an LF
        line += 1;
        pos += T.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (c === 10) { // an LF inside quotes stays an LF in the value
        dirty = true;
        line += 1;
        pos += 1;
        continue;
      }
      if (c < 32) dirty = true; // another control character, kept as it stands
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted, from just past the quote, on its line.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      readUnquoted();
      fValue = '"' + fValue;
      fDirty = true; // the value opens with a quote
      return;
    }
    const value =
      parts === null
        ? T.slice(contentStart, pos - 1)
        : (parts.push(T.slice(segStart, pos - 1)), parts.join(''));
    if (pos >= N) {
      fValue = value;
      fDirty = dirty;
      fEnded = ENDED_END;
      return;
    }
    const c = T.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fDirty = dirty;
      fEnded = ENDED_COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fDirty = dirty;
      fEnded = ENDED_LINE_BREAK;
      return;
    }
    if (c === 13 && T.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fDirty = dirty;
      fEnded = ENDED_LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break (quote_junk, when anything was appended).
    readUnquoted();
    if (fKept > 0) pushError('quote_junk');
    fValue = value + fValue;
    fDirty = dirty || fDirty;
  }

  const recJson = []; // the record being read: one JSON literal per field
  while (true) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = T.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && T.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columnsJson === null ? null : rowsCount;

    recJson.length = 0;
    let firstEmpty = false;
    let lastQuoted = false;
    let ended;
    do {
      lastQuoted = T.charCodeAt(pos) === 34;
      if (lastQuoted) readQuoted();
      else readUnquoted();
      if (recJson.length === 0) firstEmpty = fValue === '';
      recJson.push(emitString(fValue, fDirty));
      ended = fEnded;
    } while (ended === ENDED_COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (recJson.length === 1 && firstEmpty && !lastQuoted) continue;

    if (width < 0) width = recJson.length;
    if (header && columnsJson === null) {
      columnsJson = '[' + recJson.join(',') + ']';
      continue;
    }
    if (recJson.length < width) {
      errParts.push(
        '{"code":"short_row","line":' + recordLine + ',"row":' +
          (recordRow === null ? 'null' : recordRow) + ',"fields":' + recJson.length + '}',
      );
      while (recJson.length < width) recJson.push('""');
    } else if (recJson.length > width) {
      const extra = recJson.splice(width);
      errParts.push(
        '{"code":"long_row","line":' + recordLine + ',"row":' +
          (recordRow === null ? 'null' : recordRow) + ',"extra":[' + extra.join(',') + ']}',
      );
    }
    rowParts.push('[' + recJson.join(',') + ']');
    rowsCount += 1;
  }

  const columns = header ? (columnsJson === null ? '[]' : columnsJson) : 'null';
  return (
    '{"columns":' + columns + ',"rows":[' + rowParts.join(',') +
    '],"errors":[' + errParts.join(',') + ']}'
  );
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  return JSON.parse(answerJson(String(input.text), input.header === true));
}
