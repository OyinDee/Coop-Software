'use strict';

// Renders a member's monthly statement as a PDF, using the same figures and
// labels the member sees in the portal and receives by email.

const { PDFDocument, PAGE_WIDTH, PAGE_HEIGHT, fmt } = require('./pdf');

const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ROW_HEIGHT = 18;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function money(value) {
  return `NGN ${fmt(value)}`;
}

function statementRows(summary) {
  if (!summary) return [];
  return [
    { label: 'Savings added', value: (summary.savings_add || 0) + (summary.savings_add_bank || 0) },
    { label: 'Savings withdrawn', value: summary.savings_withdrawal },
    { label: 'Loan granted', value: summary.loan_granted },
    { label: 'Loan repayment', value: (summary.loan_repayment || 0) + (summary.loan_repayment_bank || 0) },
    { label: 'Loan interest charged', value: summary.loan_int_charged },
    { label: 'Loan interest paid', value: (summary.loan_int_paid || 0) + (summary.loan_int_paid_bank || 0) },
    { label: 'Commodity added', value: summary.comm_add },
    { label: 'Commodity repayment', value: (summary.comm_repayment || 0) + (summary.comm_repayment_bank || 0) },
    { label: 'Form fee', value: summary.form },
    { label: 'Other charges', value: summary.other_charges },
  ].filter((row) => Number(row.value) !== 0);
}

class StatementBuilder {
  constructor({ member, month, year, summary, commodities = [] }) {
    this.member = member || {};
    this.month = month;
    this.year = year;
    this.summary = summary || {};
    this.commodities = commodities || [];
    this.doc = new PDFDocument();
    this.y = PAGE_HEIGHT - 40;
    this.drawHeader();
  }

  ensureSpace(height) {
    if (this.y - height < 60) {
      this.drawFooter();
      this.doc.addPage();
      this.y = PAGE_HEIGHT - 40;
      this.drawCompactHeader();
    }
  }

  drawHeader() {
    const doc = this.doc;
    doc.rect(0, PAGE_HEIGHT - 74, PAGE_WIDTH, 74, { fill: '#eef1e0' });
    doc.rect(0, PAGE_HEIGHT - 74, PAGE_WIDTH, 2, { fill: '#8b5a11' });
    doc.text('SSANUCOOP', MARGIN, PAGE_HEIGHT - 32, { size: 16, bold: true, color: '#8b5a11' });
    doc.text('SSANU FUOYE Cooperative Society', MARGIN, PAGE_HEIGHT - 47, { size: 9, color: '#444444' });
    doc.textRight('MEMBER STATEMENT', PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 30, { size: 12, bold: true });
    doc.textRight(
      `${MONTHS[this.month - 1]} ${this.year}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - 47,
      { size: 10, color: '#444444' }
    );
    this.y = PAGE_HEIGHT - 96;
  }

  drawCompactHeader() {
    const doc = this.doc;
    doc.text('SSANUCOOP', MARGIN, PAGE_HEIGHT - 38, { size: 11, bold: true, color: '#8b5a11' });
    doc.textRight(
      `${this.member.full_name || ''} — ${MONTHS[this.month - 1]} ${this.year}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - 38,
      { size: 9, color: '#444444' }
    );
    doc.line(MARGIN, PAGE_HEIGHT - 46, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 46, { color: '#cccccc' });
    this.y = PAGE_HEIGHT - 64;
  }

  drawFooter() {
    if (this.y < 42) return;
    const page = this.doc.pageCount;
    this.doc.line(MARGIN, 42, PAGE_WIDTH - MARGIN, 42, { color: '#cccccc' });
    this.doc.text(
      `Generated ${new Date().toLocaleDateString('en-GB')} · This is an official statement of the cooperative society.`,
      MARGIN, 30, { size: 8, color: '#666666' }
    );
    this.doc.textRight(`Page ${page}`, PAGE_WIDTH - MARGIN, 30, { size: 8, color: '#666666' });
  }

  sectionTitle(title) {
    this.ensureSpace(34);
    this.doc.text(title, MARGIN, this.y, { size: 10, bold: true, color: '#8b5a11' });
    this.y -= 8;
    this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y, { color: '#8b5a11', lineWidth: 0.8 });
    this.y -= 14;
  }

  keyValueRow(label, value, opts = {}) {
    this.ensureSpace(ROW_HEIGHT);
    if (opts.zebra) {
      this.doc.rect(MARGIN, this.y - 5, CONTENT_WIDTH, ROW_HEIGHT, { fill: '#f7f7f2' });
    }
    this.doc.text(label, MARGIN + 8, this.y, { size: 9, color: '#333333' });
    this.doc.textRight(value, PAGE_WIDTH - MARGIN - 8, this.y, { size: 9, bold: Boolean(opts.bold) });
    this.y -= ROW_HEIGHT;
    this.doc.line(MARGIN, this.y + 13, PAGE_WIDTH - MARGIN, this.y + 13, { color: '#e2e2dc' });
  }

  drawIdentity() {
    const doc = this.doc;
    const rows = [
      ['Name', this.member.full_name || '—'],
      ['Ledger No', this.member.ledger_no || '—'],
      ['Staff No', this.member.staff_no || '—'],
      ['Email', this.member.email || '—'],
    ];
    const boxHeight = rows.length * 17 + 10;
    doc.rect(MARGIN, this.y - boxHeight, CONTENT_WIDTH, boxHeight, { fill: '#fbfbf8', stroke: '#dddddd' });
    let top = this.y - 6;
    for (const [label, value] of rows) {
      doc.text(label.toUpperCase(), MARGIN + 10, top - 8, { size: 7, color: '#777777' });
      doc.text(value, MARGIN + 95, top - 8, { size: 9.5 });
      top -= 17;
    }
    this.y -= boxHeight + 22;
  }

  drawBalances() {
    const doc = this.doc;
    const items = [
      ['Savings balance', this.summary.savings_cf, '#2f6b3a'],
      ['Loan balance', this.summary.loan_ledger_bal, '#9c2f2f'],
      ['Interest due', this.summary.loan_int_cf, '#8a6d1f'],
      ['Commodity balance', this.summary.comm_bal_cf, '#8b5a11'],
    ];
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * (items.length - 1)) / items.length;
    this.ensureSpace(64);
    items.forEach(([label, value, color], i) => {
      const x = MARGIN + i * (width + gap);
      doc.rect(x, this.y - 46, width, 46, { fill: '#ffffff', stroke: '#dddddd' });
      doc.text(label.toUpperCase(), x + 8, this.y - 16, { size: 6.5, color: '#777777' });
      doc.textRight(money(value), x + width - 8, this.y - 34, { size: 10, bold: true, color });
    });
    this.y -= 66;
  }

  drawTransactions() {
    const rows = statementRows(this.summary);
    this.sectionTitle(`Transactions for ${MONTHS[this.month - 1]} ${this.year}`);
    if (rows.length === 0) {
      this.ensureSpace(ROW_HEIGHT);
      this.doc.text('No transactions were recorded for this month.', MARGIN + 8, this.y, { size: 9, color: '#777777' });
      this.y -= ROW_HEIGHT;
    } else {
      rows.forEach((row, i) => this.keyValueRow(row.label, money(row.value), { zebra: i % 2 === 1 }));
    }
    this.ensureSpace(ROW_HEIGHT);
    this.doc.line(MARGIN, this.y + 12, PAGE_WIDTH - MARGIN, this.y + 12, { color: '#222222' });
    this.doc.text('Total deduction this month', MARGIN + 8, this.y - 2, { size: 9.5, bold: true });
    this.doc.textRight(money(this.summary.total_deduction), PAGE_WIDTH - MARGIN - 8, this.y - 2, {
      size: 9.5, bold: true,
    });
    this.y -= 30;
  }

  drawCommodities() {
    if (!this.commodities.length) return;
    const total = this.commodities.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    this.sectionTitle('Commodity & Gadgets');
    this.ensureSpace(ROW_HEIGHT);
    this.doc.rect(MARGIN, this.y - 5, CONTENT_WIDTH, ROW_HEIGHT, { fill: '#f1ede1' });
    this.doc.text('ITEM', MARGIN + 8, this.y, { size: 7, bold: true, color: '#666666' });
    this.doc.textRight('MONTH', PAGE_WIDTH - MARGIN - 130, this.y, { size: 7, bold: true, color: '#666666' });
    this.doc.textRight('AMOUNT', PAGE_WIDTH - MARGIN - 8, this.y, { size: 7, bold: true, color: '#666666' });
    this.y -= ROW_HEIGHT;

    this.commodities.forEach((item, i) => {
      this.ensureSpace(ROW_HEIGHT);
      if (i % 2 === 1) {
        this.doc.rect(MARGIN, this.y - 5, CONTENT_WIDTH, ROW_HEIGHT, { fill: '#faf8f3' });
      }
      const description = item.description && String(item.description).trim()
        ? String(item.description).trim()
        : 'Commodity / gadget purchase';
      const label = description.length > 62 ? `${description.slice(0, 59)}...` : description;
      this.doc.text(label, MARGIN + 8, this.y, { size: 9, color: '#333333' });
      this.doc.textRight(
        `${MONTHS[(Number(item.month) || this.month) - 1]} ${item.year || this.year}`,
        PAGE_WIDTH - MARGIN - 130, this.y, { size: 8, color: '#555555' }
      );
      this.doc.textRight(money(item.amount), PAGE_WIDTH - MARGIN - 8, this.y, { size: 9 });
      this.y -= ROW_HEIGHT;
      this.doc.line(MARGIN, this.y + 13, PAGE_WIDTH - MARGIN, this.y + 13, { color: '#e2e2dc' });
    });

    this.ensureSpace(ROW_HEIGHT);
    this.doc.line(MARGIN, this.y + 12, PAGE_WIDTH - MARGIN, this.y + 12, { color: '#222222' });
    this.doc.text('Total commodity purchases', MARGIN + 8, this.y - 2, { size: 9.5, bold: true });
    this.doc.textRight(money(total), PAGE_WIDTH - MARGIN - 8, this.y - 2, { size: 9.5, bold: true });
    this.y -= 26;
  }

  build() {
    this.drawIdentity();
    this.drawBalances();
    this.drawTransactions();
    this.drawCommodities();

    this.ensureSpace(40);
    this.doc.text(
      'Contact the cooperative office if any figure on this statement looks wrong.',
      MARGIN, this.y - 6, { size: 8, color: '#666666' }
    );
    this.drawFooter();
    return this.doc.toBuffer();
  }
}

function buildStatementPdf(payload) {
  return new StatementBuilder(payload).build();
}

module.exports = { buildStatementPdf, statementRows };
