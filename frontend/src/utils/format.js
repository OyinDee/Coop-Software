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

/** Principal repaid on a single loan (from repayment records when available). */
export function loanPrincipalRepaid(loan) {
  const principal = parseFloat(loan.principal) || 0;
  if (loan.principal_repaid != null) {
    return Math.min(principal, Math.max(0, parseFloat(loan.principal_repaid) || 0));
  }
  const remaining = parseFloat(loan.remaining_balance) || 0;
  if (remaining <= principal) return Math.max(0, principal - remaining);
  const fromMonths = (parseFloat(loan.months_paid) || 0) * (parseFloat(loan.monthly_principal) || 0);
  return Math.min(principal, Math.max(0, fromMonths));
}

/** Principal still owed on a single loan. */
export function loanPrincipalRemaining(loan) {
  const principal = parseFloat(loan.principal) || 0;
  return Math.max(0, principal - loanPrincipalRepaid(loan));
}
