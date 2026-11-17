'use strict';

// Minimal dependency-free PDF writer.
// Produces a valid PDF 1.4 document using the built-in Helvetica fonts, which
// every PDF reader ships with. Only the features this project needs are
// implemented: text (left/right/centre), filled and stroked rectangles, and
// lines. Content is written with WinAnsiEncoding, so text is normalised to
// Latin-1 and the Naira sign is rendered as "NGN".

const PAGE_WIDTH = 595.28;   // A4 portrait, points
const PAGE_HEIGHT = 841.89;

// Helvetica AFM advance widths (1/1000 em) for ASCII 32..126.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const REPLACEMENTS = {
  '\u20a6': 'NGN ',   // ₦
  '\u2013': '-',      // en dash
  '\u2014': '-',      // em dash
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
  '\u00a0': ' ',
  '\u2022': '-',
};

function normalizeText(value) {
  let text = value === null || value === undefined ? '' : String(value);
  for (const [from, to] of Object.entries(REPLACEMENTS)) {
    text = text.split(from).join(to);
  }
  // Drop anything WinAnsi cannot represent.
  return text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function escapePdfString(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(text, size) {
  let units = 0;
  for (const ch of normalizeText(text)) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] : 556;
  }
  return (units / 1000) * size;
}

function fmt(value, decimals = 2) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

class PDFDocument {
  constructor() {
    this.pages = [];
    this.current = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE_HEIGHT - 40;
    return this;
  }

  get pageCount() {
    return this.pages.length;
  }

  setY(y) {
    this.y = y;
    return this;
  }

  color(hex) {
    const clean = String(hex || '#000000').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const n = parseInt(full, 16);
    return [
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
    ].map((v) => v.toFixed(3)).join(' ');
  }

  text(text, x, y, opts = {}) {
    const size = opts.size || 9;
    const font = opts.bold ? '/F2' : '/F1';
    const fill = this.color(opts.color || '#111111');
    let drawX = x;
    const str = normalizeText(text);
    if (opts.align === 'right') drawX = x - textWidth(str, size);
    else if (opts.align === 'center') drawX = x - textWidth(str, size) / 2;
    this.current.push(
      `BT ${fill} rg ${font} ${size} Tf 1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(str)}) Tj ET`
    );
    return this;
  }

  textRight(text, rightX, y, opts = {}) {
    return this.text(text, rightX, y, { ...opts, align: 'right' });
  }

  textCenter(text, centerX, y, opts = {}) {
    return this.text(text, centerX, y, { ...opts, align: 'center' });
  }

  rect(x, y, w, h, opts = {}) {
    const draw = (hex) => this.color(hex);
    if (opts.fill) {
      this.current.push(`${draw(opts.fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }
    if (opts.stroke) {
      this.current.push(
        `${draw(opts.stroke)} RG ${(opts.lineWidth || 0.6).toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`
      );
    }
    return this;
  }

  line(x1, y1, x2, y2, opts = {}) {
    this.current.push(
      `${this.color(opts.color || '#222222')} RG ${(opts.lineWidth || 0.6).toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`
    );
    return this;
  }

  toBuffer() {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // object number
    };

    // Reserve 1 = catalog, 2 = pages, then one content + one page per sheet.
    const pageCount = this.pages.length;
    const fontRegular = 3 + pageCount * 2;
    const fontBold = fontRegular + 1;

    // 1 = catalog, 2 = pages, then content + page per sheet.
    const catalogNum = add('<< /Type /Catalog /Pages 2 0 R >>');
    const pageObjectNumbers = [];
    for (let i = 0; i < pageCount; i += 1) pageObjectNumbers.push(4 + i * 2);
    const pagesNum = add(
      `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`
    );

    this.pages.forEach((ops, i) => {
      const stream = ops.join('\n');
      add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      add(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${3 + i * 2} 0 R >>`
      );
    });

    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((off) => {
      out += `${String(off).padStart(10, '0')} 00000 n \n`;
    });
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

module.exports = { PDFDocument, PAGE_WIDTH, PAGE_HEIGHT, textWidth, fmt, normalizeText };
