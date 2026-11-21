// A fast drop-in for csv-reader 1.0.0: readCsv's answer for one case's input,
// {text, header} -> {columns, rows, errors}, byte for byte the same values.
//
// The policy, restated from the competition rules:
//  - A U+FEFF at the very start of the text is dropped.
//  - A record ends at LF or CRLF; a line left with no characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//  - A field that opens with a quote runs to the next quote that is not
//    doubled ("" inside it is one quote; each CRLF or lone CR inside it is
//    read as LF). What follows its closing quote, up to the next comma or
//    line break, is appended as it stands (quote_junk, when the field ends).
//    A quote that never closes is a literal character, and the text after it
//    is read again as unquoted (unterminated_quote).
//  - A quote inside an unquoted field is a literal character. Fields stay
//    strings, never trimmed or converted.
//  - columns is the first record when header is true, else null; rows holds
//    the records after it, each padded with "" (short_row, with fields: its
//    field count) or cut (long_row, with extra: the cut fields) to the first
//    record's width.
//  - Each error is {code, line, row}, in the order met; line is the 1-based
//    line its record starts on (every LF, CRLF and lone CR inside quotes
//    counted) and row is its record's index in rows (null for the header).
//
// Speed strategy: the reference walks the text one character at a time and
// builds every field by appending one character at a time. This reader
// instead finds field boundaries with native indexOf scans and takes whole
// fields out with slice, which V8 performs in bulk:
//  - A record whose first line holds no quote and no stray CR is split in
//    one String.split(',') call (the common case by far).
//  - Otherwise each field is cut out between the next ',' or LF (one or two
//    indexOf calls); a CR inside an unquoted field can only be a stray one,
//    so it is stripped from the cut-out slice instead of ending the field.
//  - A quoted field is found with indexOf('"') (skipping doubled quotes),
//    its body taken as one slice, "" collapsed with replaceAll and CR/CRLF
//    folded to LF with one replace; line numbers inside it are counted with
//    scans bounded to that slice.
//  - Field results are written into one reused holder instead of allocating
//    a result object per field, and nothing is kept from one call to the
//    next; the result is deterministic.

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
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record now being read: the line it starts on and its index in rows.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters
  // were kept onto it (a dropped stray CR is not one). One holder, reused
  // for every field, so reading a field allocates nothing.
  const field = { value: '', ended: END, added: 0 };

  // Reads an unquoted field starting at pos, appending onto `value`.
  // A CR inside the field is never a boundary: it is either the CR of the
  // CRLF that ends the field, or a stray CR that is dropped with an error.
  function readUnquoted(value) {
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    const commaAt = comma === -1 ? Infinity : comma;
    const lfAt = lf === -1 ? Infinity : lf;
    if (commaAt < lfAt) {
      const raw = text.slice(pos, comma);
      const cut = raw.indexOf('\r');
      pos = comma + 1;
      field.ended = COMMA;
      if (cut === -1) {
        field.value = value + raw;
        field.added = raw.length;
        return;
      }
      for (let i = cut; i !== -1; i = raw.indexOf('\r', i + 1)) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      const kept = raw.split('\r').join('');
      field.value = value + kept;
      field.added = kept.length;
      return;
    }
    if (lfAt < Infinity) {
      const raw = text.slice(pos, lf);
      const crlf = raw.charCodeAt(raw.length - 1) === 13;
      const body = crlf ? raw.slice(0, -1) : raw;
      const cut = body.indexOf('\r');
      pos = lf + 1;
      line += 1;
      field.ended = LINE_BREAK;
      if (cut === -1) {
        field.value = value + body;
        field.added = body.length;
        return;
      }
      for (let i = cut; i !== -1; i = body.indexOf('\r', i + 1)) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      const kept = body.split('\r').join('');
      field.value = value + kept;
      field.added = kept.length;
      return;
    }
    // No comma or line break left: the rest of the text is the field.
    const raw = text.slice(pos);
    const cut = raw.indexOf('\r');
    pos = len;
    field.ended = END;
    if (cut === -1) {
      field.value = value + raw;
      field.added = raw.length;
      return;
    }
    for (let i = cut; i !== -1; i = raw.indexOf('\r', i + 1)) {
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    }
    const kept = raw.split('\r').join('');
    field.value = value + kept;
    field.added = kept.length;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = open + 1;
    let doubled = false;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', i);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        doubled = true;
        i = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      pos = open + 1;
      line = openLine;
      readUnquoted('"');
      return;
    }
    let value = text.slice(open + 1, close);
    // Line breaks inside the quotes: every LF, and every CR that is not
    // part of a CRLF, starts a new line. Most quoted fields hold none, so
    // the counting scans run only when one is present.
    const nlAt = value.indexOf('\n');
    const crAt = value.indexOf('\r');
    if (nlAt !== -1 || crAt !== -1) {
      let lfCount = 0;
      for (let n = nlAt; n !== -1; n = value.indexOf('\n', n + 1)) lfCount += 1;
      let loneCr = 0;
      for (let r = crAt; r !== -1; r = value.indexOf('\r', r + 1)) {
        if (value.charCodeAt(r + 1) !== 10) loneCr += 1;
      }
      line += lfCount + loneCr;
      if (crAt !== -1) value = value.replace(/\r\n?/g, '\n');
    }
    if (doubled) value = value.replaceAll('""', '"');
    pos = close + 1;
    if (pos >= len) {
      field.value = value;
      field.ended = END;
      field.added = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      field.value = value;
      field.ended = COMMA;
      field.added = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      field.value = value;
      field.ended = LINE_BREAK;
      field.added = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      field.value = value;
      field.ended = LINE_BREAK;
      field.added = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (field.added > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
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

    // Fast path: the record's first line holds no quote and no stray CR,
    // so the record ends at that line break and every field is unquoted.
    // The checks use indexOf on the whole text: a quote or CR before the
    // line break is the first one at or after pos, so finding it (or not)
    // settles the segment without slicing it out first.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const q = text.indexOf('"', pos);
    const r = text.indexOf('\r', pos);
    const hasQuote = q !== -1 && q < segEnd;
    const hasStrayCr = r !== -1 && r < segEnd && !(nl !== -1 && r === segEnd - 1);
    let fields;
    let lastQuoted = false;
    if (!hasQuote && !hasStrayCr) {
      const end = nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13 ? segEnd - 1 : segEnd;
      fields = text.slice(pos, end).split(',');
      pos = nl === -1 ? len : nl + 1;
      line += 1;
    } else {
      // Slow path: field by field, quotes and stray CRs handled exactly.
      fields = [];
      let ended;
      do {
        if (text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          readQuoted();
        } else {
          lastQuoted = false;
          readUnquoted('');
        }
        fields.push(field.value);
        ended = field.ended;
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
