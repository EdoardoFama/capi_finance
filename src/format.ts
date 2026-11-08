const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatBRL = (cents: number) => brl.format(cents / 100);

/** Valor em centavos -> texto para input ("35,50") */
export const centsToInput = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Texto digitado ("1.234,56", "35.5", "40") -> centavos, ou null se inválido */
export function parseBRL(input: string): number | null {
  let s = input.replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}($|\.)/.test(s)) {
    s = s.replace(/\./g, ''); // "1.000" = mil
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

const pad = (n: number) => String(n).padStart(2, '0');

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const currentMonth = () => todayISO().slice(0, 7);

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = todayISO();
  if (iso === today) return 'Hoje';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (iso === `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`) return 'Ontem';
  return `${WEEKDAYS[date.getDay()]}, ${pad(d)}/${pad(m)}`;
}

export const percent = (spent: number, budget: number) =>
  budget > 0 ? Math.round((spent / budget) * 100) : spent > 0 ? 100 : 0;

