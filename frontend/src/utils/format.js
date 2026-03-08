export function fmtNGN(amount) {
  if (amount == null || amount === '') return '—';
  const n = parseFloat(amount);
  if (isNaN(n)) return '—';
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function monthName(month) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1] || '';
}

export function calcLoan({ principal, months, monthlyPayment, rate = 0.05 }) {
  const p = parseFloat(principal);
  if (!p) return null;
  let m, monthly_principal;
  if (months) {
    m = parseInt(months);
    monthly_principal = p / m;
  } else if (monthlyPayment) {
    // monthlyPayment is the total monthly repayment (principal + interest combined)
    const totalRepayment = parseFloat(monthlyPayment);
    m = Math.ceil((p * (1 + rate)) / totalRepayment);
    monthly_principal = p / m;
  } else {
    return null;
  }
  const total_interest = p * rate;
  const monthly_interest = total_interest / m;
  return {
    months: m,
    monthly_principal,
    total_interest,
    monthly_interest,
    monthly_repayment: monthly_principal + monthly_interest,
    total_payable: p + total_interest,
  };
}
