// V5: V3's indexOf-driven scanners + E5 (one shared unquoted scanner for plain
// fields, quote-junk tails and unterminated-quote fallback) + E10 (pre-sized
// row arrays once the width is known). Must return exactly csv-reader 1.0.0's
// answer for {text, header} -> {columns, rows, errors}.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1; // line the current record starts on
  let recordRow = null; // index in rows the current record takes (null: header)

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const presized = width >= 0;
    const fields = presized ? new Array(width) : [];
    let k = 0; // fields filled (presized) — fields.length otherwise
    let extra = null; // cut fields, for a long row
    let ended = 0; // 0: comma, 1: line break, 2: end of text
    let quoted = false;

    do {
      let value;
      let endedHere;
      let scan = true; // run the shared unquoted scan below
      let countAdded = false; // count kept chars (quote_junk needs it)
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        // Find the closing quote in one pass (d3 shape): a '"' followed by
        // another '"' is an escaped quote, not the close.
        let i = pos + 1;
        let close = -1;
        let hasDD = false; // a "" pair was skipped
        while (i < n) {
          if (text.charCodeAt(i) === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              hasDD = true;
              i += 2;
              continue;
            }
            close = i;
            break;
          }
          i += 1;
        }
        if (close === -1) {
          // The quote never closes: literal, text after it read again as unquoted.
          // (line was never advanced: the indexOf scan counts no line breaks.)
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          value = '"';
        } else {
          const raw = text.slice(open + 1, close);
          if (raw.indexOf('\r') === -1 && raw.indexOf('\n') === -1) {
            // Clean quoted field: one slice, replace only if "" was seen.
            value = hasDD ? raw.replace(/""/g, '"') : raw;
          } else {
            // Rare: embedded CR/LF (each becomes LF) and/or "" to collapse.
            let v2 = '';
            let s2 = 0;
            for (let kk = 0; kk < raw.length; kk++) {
              const c = raw.charCodeAt(kk);
              if (c === 34) {
                v2 += raw.slice(s2, kk);
                v2 += '"';
                kk += 1; // skip the second quote of the pair
                s2 = kk + 1;
              } else if (c === 13) {
                v2 += raw.slice(s2, kk);
                v2 += '\n';
                line += 1;
                if (raw.charCodeAt(kk + 1) === 10) kk += 1;
                s2 = kk + 1;
              } else if (c === 10) {
                v2 += raw.slice(s2, kk);
                v2 += '\n';
                line += 1;
                s2 = kk + 1;
              }
            }
            v2 += raw.slice(s2);
            value = v2;
          }
          pos = close + 1; // just past the closing quote
          if (pos >= n) {
            endedHere = 2;
            scan = false;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              endedHere = 0;
              scan = false;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              endedHere = 1;
              scan = false;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              endedHere = 1;
              scan = false;
            } else {
              // What follows the closing quote is appended as it stands.
              countAdded = true;
            }
          }
        }
      } else {
        quoted = false;
        value = '';
      }

      let added = 0;
      if (scan) {
        // Shared unquoted scan: appends to `value` from pos, up to the next
        // comma or line break. A CR not followed by LF is dropped (stray_cr).
        // charCodeAt loop + one slice per segment (segments only split on a
        // stray CR, which is rare).
        let v = value;
        let s = pos;
        let j = pos;
        for (;;) {
          while (j < n) {
            const c = text.charCodeAt(j);
            if (c === 44 || c === 10 || c === 13) break;
            j += 1;
          }
          if (j >= n) {
            added += j - s;
            v += text.slice(s, j);
            pos = j;
            endedHere = 2;
            break;
          }
          const c = text.charCodeAt(j);
          if (c === 44) {
            added += j - s;
            v += text.slice(s, j);
            pos = j + 1;
            endedHere = 0;
            break;
          }
          if (c === 10) {
            added += j - s;
            v += text.slice(s, j);
            pos = j + 1;
            line += 1;
            endedHere = 1;
            break;
          }
          if (text.charCodeAt(j + 1) === 10) {
            added += j - s;
            v += text.slice(s, j);
            pos = j + 2;
            line += 1;
            endedHere = 1;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          added += j - s;
          v += text.slice(s, j);
          j += 1;
          s = j;
        }
        value = v;
      }
      ended = endedHere;
      if (countAdded && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      if (presized) {
        if (k < width) fields[k] = value;
        else {
          if (extra === null) extra = [];
          extra.push(value);
        }
        k += 1;
      } else {
        fields.push(value);
      }
    } while (ended === 0);

    const count = presized ? k : fields.length;
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (count === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = count;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (count < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: count });
      if (presized) {
        while (k < width) {
          fields[k] = '';
          k += 1;
        }
      } else {
        while (fields.length < width) fields.push('');
      }
    } else if (count > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: presized ? extra : fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
