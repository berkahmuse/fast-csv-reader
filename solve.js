// fast-csv-reader — a faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader on every input {text, header} -> {columns, rows, errors},
// reached a different way. The reference walks the text one character at a time and
// builds every field a character at a time, allocating a small result object per
// field. This reader instead works record by record and takes the cheap road
// whenever a record allows it:
//
//   * Fast path — the record is one physical line with no double quote and no stray
//     carriage return in it. Its fields are then just line.split(','), found with
//     indexOf scans (C speed) instead of a JS loop. That covers the plain records.
//   * Slow path — the record holds a quote or a stray CR. Its fields are parsed by
//     a chunked re-implementation of the reference's exact policy: an unquoted field
//     ends at the next comma / LF / CR found by one global-regex scan, and a quoted
//     field is copied whole up to its next quote (indexOf), its CRs turned into LFs
//     in one replace. The readers write into shared out-variables instead of
//     allocating a result object per field.
//
// Every broken-row rule lands exactly where the reference puts it — stray_cr,
// quote_junk, unterminated_quote, short_row, long_row, blank lines, BOM, CRLF and
// lone CR inside quotes read as LF — so the answers are csv-reader's, byte for byte.
//
// No dependency, no cache between cases, no clock, no randomness. Pure function of
// the input, so two runs write byte-identical answers.
//
// SPDX-License-Identifier: MIT

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // a U+FEFF at the very start is dropped
  let line = 1; // the line the next character is on

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters an
  // unquoted read kept (a quoted field's junk check reads it).
  let fVal = '';
  let fEnd = END;
  let fAdd = 0;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Next comma / LF / CR at or after pos, found with one global-regex scan.
  const DELIM = /[,\r\n]/g;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Sets fVal, fEnd and fAdd.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      if (pos >= len) {
        fVal = value;
        fEnd = END;
        fAdd = added;
        return;
      }
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      const d = m === null ? len : m.index;
      if (d > pos) {
        value += text.slice(pos, d);
        added += d - pos;
        pos = d;
      }
      if (pos >= len) {
        fVal = value;
        fEnd = END;
        fAdd = added;
        return;
      }
      const kind = text.charCodeAt(pos);
      if (kind === 44) {
        pos += 1;
        fVal = value;
        fEnd = COMMA;
        fAdd = added;
        return;
      }
      if (kind === 10) {
        pos += 1;
        line += 1;
        fVal = value;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      // A CR: with a following LF it ends the record, alone it is dropped.
      if (text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fVal = value;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      err('stray_cr');
      pos += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Only the next quote is
  // searched for; the run in between is copied whole, its CRs turned into LFs.
  // Sets fVal, fEnd and fAdd.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    for (;;) {
      if (pos >= len) break;
      const qi = text.indexOf('"', pos);
      const q = qi === -1 ? len : qi;
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
          value += seg;
        } else {
          value += seg.replace(/\r\n?|\n/g, () => {
            line += 1;
            return '\n';
          });
        }
        pos = q;
      }
      if (pos >= len) break;
      if (text.charCodeAt(pos + 1) === 34) {
        value += '"';
        pos += 2;
        continue;
      }
      pos += 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it
      // is read again as unquoted.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      readUnquoted('"');
      return;
    }
    if (pos >= len) {
      fVal = value;
      fEnd = END;
      fAdd = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = value;
      fEnd = COMMA;
      fAdd = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdd = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdd = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    readUnquoted(value);
    if (fAdd > 0) err('quote_junk');
  }

  // Finishes a record: header, or a row padded / cut to the first record's width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this record is one physical line holding no quote and no stray CR,
    // so its fields are a plain split on commas.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= end) {
      const r = text.indexOf('\r', pos);
      if (r === -1 || r >= end || (nl !== -1 && r === end - 1)) {
        let segEnd = end;
        if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
        const fields = text.slice(pos, segEnd).split(',');
        pos = nl === -1 ? len : nl + 1;
        line += 1;
        // A line that held only stray CRs is left with no characters: no record.
        if (!(fields.length === 1 && fields[0] === '')) finishRecord(fields);
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR — parse it field by field.
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fVal);
    } while (fEnd === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
