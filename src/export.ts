import { api } from './api';
import { formatBRL, monthLabel } from './format';

export type ExportData = {
  generated_at: string;
  user: string;
  incomes: { name: string; amount_cents: number }[];
  categories: { name: string; budget_cents: number; note: string }[];
  expenses: {
    spent_on: string;
    title: string;
    description: string;
    category: string;
    amount_cents: number;
    payment_method: string;
    installment_current: number;
    installment_total: number;
  }[];
  investment_accounts: { id: number; name: string }[];
  investment_snapshots: { account_id: number; month: string; balance_cents: number; delta_cents: number }[];
};

/** 'all' = todos os meses; 'YYYY-MM' = apenas aquele mês (gastos). Orçamento e investimentos sempre completos. */
export type ExportScope = 'all' | string;

const PAYMENT_LABEL: Record<string, string> = { debit: 'debito', pix: 'pix', credit: 'credito' };
const num = (cents: number) => (cents / 100).toFixed(2); // decimal com ponto: ideal para análise por IA/planilhas

function scoped(data: ExportData, scope: ExportScope): ExportData {
  if (scope === 'all') return data;
  return { ...data, expenses: data.expenses.filter((e) => e.spent_on.startsWith(scope)) };
}

export const fetchExportData = () => api<ExportData>('/export');

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = (data: ExportData, scope: ExportScope) =>
  `capi-finance_${scope === 'all' ? 'completo' : scope}_${data.generated_at.slice(0, 10)}`;

// ===================== CSV =====================
const CSV_HEADER = [
  'tipo', 'mes', 'data', 'titulo', 'descricao', 'categoria', 'forma_pagamento',
  'parcela_atual', 'parcela_total', 'valor_brl', 'teto_mensal_brl', 'percentual_do_teto',
  'conta_investimento', 'saldo_brl', 'rendimento_ou_saque_brl', 'observacao',
];

const esc = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(full: ExportData, scope: ExportScope) {
  const data = scoped(full, scope);
  const rows: (string | number)[][] = [];
  const row = (o: Record<string, string | number>) => rows.push(CSV_HEADER.map((k) => o[k] ?? ''));

  // Orçamento: ganhos previstos (mensais)
  for (const i of data.incomes) row({ tipo: 'GANHO_PREVISTO', titulo: i.name, valor_brl: num(i.amount_cents) });

  // Orçamento: teto mensal por categoria
  const budget = new Map(data.categories.map((c) => [c.name, c.budget_cents]));
  for (const c of data.categories) {
    row({ tipo: 'TETO_CATEGORIA', categoria: c.name, valor_brl: num(c.budget_cents), teto_mensal_brl: num(c.budget_cents), observacao: c.note });
  }

  // Lançamentos (cada parcela é uma linha, na data/mês em que cai)
  for (const e of data.expenses) {
    row({
      tipo: 'GASTO', mes: e.spent_on.slice(0, 7), data: e.spent_on, titulo: e.title, descricao: e.description,
      categoria: e.category, forma_pagamento: PAYMENT_LABEL[e.payment_method] ?? e.payment_method,
      parcela_atual: e.installment_current, parcela_total: e.installment_total, valor_brl: num(e.amount_cents),
    });
  }

  // Resumo por mês x categoria (já calculado, com % do teto)
  const agg = new Map<string, number>();
  for (const e of data.expenses) {
    const k = `${e.spent_on.slice(0, 7)}|${e.category}`;
    agg.set(k, (agg.get(k) ?? 0) + e.amount_cents);
  }
  for (const [k, total] of [...agg.entries()].sort()) {
    const [mes, categoria] = k.split('|');
    const teto = budget.get(categoria) ?? 0;
    row({
      tipo: 'RESUMO_MES_CATEGORIA', mes, categoria, valor_brl: num(total), teto_mensal_brl: num(teto),
      percentual_do_teto: teto > 0 ? ((total / teto) * 100).toFixed(1) : '',
    });
  }

  // Investimentos
  const accName = new Map(data.investment_accounts.map((a) => [a.id, a.name]));
  for (const s of data.investment_snapshots) {
    row({
      tipo: 'INVESTIMENTO', mes: s.month, conta_investimento: accName.get(s.account_id) ?? s.account_id,
      saldo_brl: num(s.balance_cents), rendimento_ou_saque_brl: num(s.delta_cents),
    });
  }

  const csv = [CSV_HEADER, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  // BOM para o Excel reconhecer UTF-8 (acentos)
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `${stamp(data, scope)}.csv`);
}

// ===================== PDF =====================
export async function exportPdf(full: ExportData, scope: ExportScope) {
  const data = scoped(full, scope);
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const GREEN: [number, number, number] = [16, 185, 129];
  const head = { fillColor: [24, 24, 27] as [number, number, number], textColor: 255 };
  const base = { styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, margin: { left: 30, right: 30 } };
  let y = 40;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const title = (t: string) => {
    if (y > 520) { doc.addPage(); y = 40; }
    doc.setFontSize(12).setTextColor(...GREEN).text(t, 30, y);
    y += 8;
  };
  const table = (opts: Parameters<typeof autoTable>[1]) => {
    autoTable(doc, { ...base, startY: y, ...opts });
    y = lastY() + 22;
  };

  // Cabeçalho
  doc.setFontSize(18).setTextColor(20).text('Capi Finance - Relatório financeiro', 30, y);
  y += 18;
  doc.setFontSize(9).setTextColor(100).text(
    `Usuário: ${data.user}  |  Gerado em: ${data.generated_at.slice(0, 10)}  |  Gastos: ${scope === 'all' ? 'todos os meses' : monthLabel(scope)}  |  Valores em R$`,
    30, y,
  );
  y += 24;

  const totalIncome = data.incomes.reduce((s, i) => s + i.amount_cents, 0);
  const totalBudget = data.categories.reduce((s, c) => s + c.budget_cents, 0);
  const totalSpent = data.expenses.reduce((s, e) => s + e.amount_cents, 0);

  title('Resumo do orçamento mensal');
  table({
    head: [['Ganhos previstos', 'Tetos de gasto (total)', 'Sobra prevista ("por fora")', 'Total gasto no período']],
    body: [[formatBRL(totalIncome), formatBRL(totalBudget), formatBRL(totalIncome - totalBudget), formatBRL(totalSpent)]],
  });

  title('Ganhos previstos');
  table({ head: [['Origem', 'Valor']], body: data.incomes.map((i) => [i.name, formatBRL(i.amount_cents)]), columnStyles: { 1: { halign: 'right' } } });

  // Gasto por categoria x mês
  const months = [...new Set(data.expenses.map((e) => e.spent_on.slice(0, 7)))].sort();
  const cats = [...new Set([...data.categories.map((c) => c.name), ...data.expenses.map((e) => e.category)])];
  const grid = new Map<string, number>();
  for (const e of data.expenses) {
    const k = `${e.category}|${e.spent_on.slice(0, 7)}`;
    grid.set(k, (grid.get(k) ?? 0) + e.amount_cents);
  }
  const budgetOf = new Map(data.categories.map((c) => [c.name, c.budget_cents]));
  title('Gasto por categoria e mês (teto mensal na 2ª coluna)');
  table({
    head: [['Categoria', 'Teto', ...months.map((m) => m.slice(2)), 'Total']],
    body: [
      ...cats.map((cat) => {
        const vals = months.map((m) => grid.get(`${cat}|${m}`) ?? 0);
        return [cat, formatBRL(budgetOf.get(cat) ?? 0), ...vals.map((v) => (v ? formatBRL(v) : '-')), formatBRL(vals.reduce((a, b) => a + b, 0))];
      }),
      ['TOTAL', formatBRL(totalBudget), ...months.map((m) => formatBRL(cats.reduce((s, c) => s + (grid.get(`${c}|${m}`) ?? 0), 0))), formatBRL(totalSpent)],
    ],
    styles: { fontSize: 7, cellPadding: 2 },
  });

  // Investimentos
  if (data.investment_accounts.length) {
    const invMonths = [...new Set(data.investment_snapshots.map((s) => s.month))].sort();
    const snap = new Map(data.investment_snapshots.map((s) => [`${s.account_id}|${s.month}`, s]));
    const body: string[][] = [];
    for (const a of data.investment_accounts) {
      body.push([a.name + ' (saldo)', ...invMonths.map((m) => { const s = snap.get(`${a.id}|${m}`); return s ? formatBRL(s.balance_cents) : '-'; })]);
      body.push([a.name + ' (rendeu/saque)', ...invMonths.map((m) => { const s = snap.get(`${a.id}|${m}`); return s ? formatBRL(s.delta_cents) : '-'; })]);
    }
    body.push(['TOTAL PATRIMÔNIO', ...invMonths.map((m) => formatBRL(data.investment_accounts.reduce((s, a) => s + (snap.get(`${a.id}|${m}`)?.balance_cents ?? 0), 0)))]);
    title('Investimentos');
    table({ head: [['Conta', ...invMonths.map((m) => m.slice(2))]], body, styles: { fontSize: 7, cellPadding: 2 } });
  }

  // Lançamentos
  doc.addPage();
  y = 40;
  title(`Lançamentos (${data.expenses.length})`);
  table({
    head: [['Data', 'Título', 'Descrição', 'Categoria', 'Pagamento', 'Parcela', 'Valor']],
    body: data.expenses.map((e) => [
      e.spent_on, e.title, e.description, e.category,
      PAYMENT_LABEL[e.payment_method] ?? e.payment_method,
      e.installment_total > 1 ? `${e.installment_current}/${e.installment_total}` : '-',
      formatBRL(e.amount_cents),
    ]),
    columnStyles: { 6: { halign: 'right' } },
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { ...head, fillColor: [24, 24, 27] },
  });

  download(doc.output('blob'), `${stamp(data, scope)}.pdf`);
}

