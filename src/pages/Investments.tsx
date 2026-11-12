import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type InvestmentSnapshot, type InvestmentsData } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL } from '../format';
import { Card, IconEdit, IconPlus, PageTitle, Spinner } from '../components/ui';
import DistributionChart from '../components/DistributionChart';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatMonthHeader(ym: string) {
  if (!ym || !ym.includes('-')) return ym;
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1].slice(0, 3).toUpperCase()}/${String(y).slice(2)}`;
}

export default function Investments() {
  const toast = useToast();
  const [data, setData] = useState<InvestmentsData | null>(null);
  const [loading, setLoading] = useState(true);

  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState('');
  const [formBalances, setFormBalances] = useState<Record<number, string>>({});
  const [formDeltas, setFormDeltas] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountColor, setNewAccountColor] = useState('#10b981');

  const load = useCallback(async () => {
    try {
      const res = await api<InvestmentsData>('/investments');
      setData(res);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const months = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.snapshots.forEach((s) => set.add(s.month));
    const nowMonth = new Date().toISOString().slice(0, 7);
    set.add(nowMonth);
    return Array.from(set).sort();
  }, [data]);

  const snapshotMap = useMemo(() => {
    const map = new Map<string, InvestmentSnapshot>();
    data?.snapshots.forEach((s) => {
      map.set(`${s.account_id}_${s.month}`, s);
    });
    return map;
  }, [data]);

  const monthlySummaries = useMemo(() => {
    if (!data) return {};
    const summaries: Record<
      string,
      { totalBalance: number; valorizacaoInvest: number; totalDelta: number; valorDiferenca: number }
    > = {};

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      let totalBalance = 0;
      let totalDelta = 0;
      let valorizacaoInvest = 0;

      data.accounts.forEach((acc) => {
        const snap = snapshotMap.get(`${acc.id}_${m}`);
        if (snap) {
          totalBalance += snap.balance_cents;
          totalDelta += snap.delta_cents;
          if (snap.delta_cents > 0) {
            valorizacaoInvest += snap.delta_cents;
          }
        }
      });

      summaries[m] = {
        totalBalance,
        valorizacaoInvest,
        totalDelta,
        valorDiferenca: totalDelta,
      };
    }
    return summaries;
  }, [data, months, snapshotMap]);

  function openMonthEditor(monthStr: string) {
    setTargetMonth(monthStr);
    const balances: Record<number, string> = {};
    const deltas: Record<number, string> = {};

    data?.accounts.forEach((acc) => {
      const snap = snapshotMap.get(`${acc.id}_${monthStr}`);
      balances[acc.id] = snap ? centsToInput(snap.balance_cents) : '';
      deltas[acc.id] = snap ? centsToInput(snap.delta_cents) : '';
    });

    setFormBalances(balances);
    setFormDeltas(deltas);
    setIsUpdateModalOpen(true);
  }

  async function handleSaveMonth(e: FormEvent) {
    e.preventDefault();
    if (!targetMonth || !data) return;
    setSaving(true);
    try {
      for (const acc of data.accounts) {
        const rawBal = formBalances[acc.id] || '0';
        const rawDelta = formDeltas[acc.id] || '0';

        const balCents = parseBRL(rawBal) ?? 0;
        let deltaCents = 0;
        const cleanDelta = rawDelta.trim();
        const isNegative = cleanDelta.startsWith('-');
        const parsedAbs = parseBRL(cleanDelta.replace('-', ''));
        if (parsedAbs !== null) {
          deltaCents = isNegative ? -parsedAbs : parsedAbs;
        }

        await api('/investments/snapshot', {
          method: 'POST',
          body: {
            account_id: acc.id,
            month: targetMonth,
            balance_cents: balCents,
            delta_cents: deltaCents,
          },
        });
      }
      toast(`Investimentos de ${formatMonthHeader(targetMonth)} atualizados!`);
      setIsUpdateModalOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAccount(e: FormEvent) {
    e.preventDefault();
    const name = newAccountName.trim().toUpperCase();
    if (!name) return toast('Informe o nome da conta', 'error');
    try {
      await api('/investments/accounts', {
        method: 'POST',
        body: { name, color: newAccountColor },
      });
      toast(`Conta ${name} adicionada!`);
      setNewAccountName('');
      setIsAddAccountOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Encontra o último mês que possui saldo registrado (ou o último mês da lista)
  const activeLatestMonth = useMemo(() => {
    if (months.length === 0) return '';
    for (let i = months.length - 1; i >= 0; i--) {
      if ((monthlySummaries[months[i]]?.totalBalance ?? 0) > 0) {
        return months[i];
      }
    }
    return months[months.length - 1];
  }, [months, monthlySummaries]);

  const portfolioDistribution = useMemo(() => {
    if (!data || !activeLatestMonth) return [];
    return data.accounts.map((acc) => {
      const snap = snapshotMap.get(`${acc.id}_${activeLatestMonth}`);
      return {
        name: acc.name,
        amount_cents: snap?.balance_cents ?? 0,
        color: acc.color,
      };
    });
  }, [data, activeLatestMonth, snapshotMap]);

  if (loading || !data) return <Spinner />;

  const latestSummary = monthlySummaries[activeLatestMonth];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Carteira de Investimentos"
          subtitle="Evolução patrimonial, alocação por conta e rendimentos mensais"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddAccountOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-xs font-bold text-zinc-200 hover:bg-zinc-800 transition"
          >
            <IconPlus className="h-4 w-4 text-emerald-400" /> Nova Corretora
          </button>
          <button
            onClick={() => openMonthEditor(activeLatestMonth || new Date().toISOString().slice(0, 7))}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
          >
            <IconEdit className="h-4 w-4" /> Atualizar Saldos
          </button>
        </div>
      </div>

      {/* Cards Executivos de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-emerald-500/25 bg-gradient-to-br from-zinc-900/95 via-zinc-950 to-emerald-950/25">
          <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
            Patrimônio Acumulado ({formatMonthHeader(activeLatestMonth)})
          </p>
          <p className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums">
            {formatBRL(latestSummary?.totalBalance ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Soma de {data.accounts.length} {data.accounts.length === 1 ? 'conta ativa' : 'contas ativas'}
          </p>
        </Card>

        <Card>
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Rendimento Positivo no Mês
          </p>
          <p
            className={`mt-1 text-2xl sm:text-3xl font-black tracking-tight tabular-nums ${
              (latestSummary?.valorizacaoInvest ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            +{formatBRL(latestSummary?.valorizacaoInvest ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">Ganhos de capital / juros registrados</p>
        </Card>

        <Card>
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Variação Líquida (Aportes − Saques)
          </p>
          <p
            className={`mt-1 text-2xl sm:text-3xl font-black tracking-tight tabular-nums ${
              (latestSummary?.totalDelta ?? 0) >= 0 ? 'text-blue-300' : 'text-amber-400'
            }`}
          >
            {(latestSummary?.totalDelta ?? 0) > 0 ? '+' : ''}
            {formatBRL(latestSummary?.totalDelta ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">Resultado líquido de movimentações</p>
        </Card>
      </div>

      {/* Distribuição da Carteira por Conta */}
      <DistributionChart
        title={`Alocação do Patrimônio (${formatMonthHeader(activeLatestMonth)})`}
        subtitle="Participação percentual de cada conta/corretora no seu patrimônio total"
        items={portfolioDistribution}
      />

      {/* Tabela de Evolução Estilo Planilha */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-white/[0.06] bg-zinc-900/40">
          <div>
            <h2 className="font-bold text-sm text-white">Planilha de Evolução Patrimonial</h2>
            <p className="text-[11px] text-zinc-500">
              Clique no cabeçalho de qualquer mês para editar os saldos e rendimentos daquele período
            </p>
          </div>
          <span className="rounded-lg bg-zinc-900 border border-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-400">
            Arraste horizontalmente ↔
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-zinc-900/90 text-zinc-400 font-bold uppercase tracking-wider text-[11px]">
                <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3 border-r border-white/[0.08] min-w-40">
                  Instituição / Mês
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-4 py-3 text-right min-w-28 hover:text-emerald-300 cursor-pointer transition"
                    onClick={() => openMonthEditor(m)}
                    title="Clique para editar este mês"
                  >
                    <span className="inline-flex items-center gap-1 hover:underline">
                      {formatMonthHeader(m)}
                      <span className="text-[10px] opacity-60">✏️</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.05] font-medium">
              {data.accounts.map((acc) => (
                <Fragment key={acc.id}>
                  {/* Linha Saldo da Conta */}
                  <tr className="hover:bg-zinc-900/40 transition">
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-3 border-r border-white/[0.06] font-bold flex items-center gap-2.5 text-zinc-100">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white/10"
                        style={{ backgroundColor: acc.color }}
                      />
                      <span className="truncate">{acc.name}</span>
                    </td>
                    {months.map((m) => {
                      const snap = snapshotMap.get(`${acc.id}_${m}`);
                      return (
                        <td key={m} className="px-4 py-3 text-right tabular-nums font-bold text-zinc-100">
                          {snap ? formatBRL(snap.balance_cents) : '—'}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Linha Rendimento / Saque da Conta */}
                  <tr className="bg-zinc-950/60 hover:bg-zinc-900/30 transition text-[11px]">
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-1.5 border-r border-white/[0.06] text-zinc-500 pl-8">
                      ↳ Rendeu / Saque
                    </td>
                    {months.map((m) => {
                      const snap = snapshotMap.get(`${acc.id}_${m}`);
                      const val = snap?.delta_cents ?? 0;
                      return (
                        <td
                          key={m}
                          className={`px-4 py-1.5 text-right tabular-nums font-semibold ${
                            val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-zinc-600'
                          }`}
                        >
                          {snap ? (val > 0 ? `+${formatBRL(val)}` : formatBRL(val)) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}

              {/* Linha TOTAL PATRIMÔNIO */}
              <tr className="border-t-2 border-white/[0.1] bg-zinc-900/80 font-extrabold text-white">
                <td className="sticky left-0 z-10 bg-zinc-900 px-4 py-3.5 border-r border-white/[0.08]">
                  PATRIMÔNIO TOTAL
                </td>
                {months.map((m) => {
                  const s = monthlySummaries[m];
                  return (
                    <td key={m} className="px-4 py-3.5 text-right tabular-nums text-emerald-400 text-sm">
                      {s?.totalBalance ? formatBRL(s.totalBalance) : '—'}
                    </td>
                  );
                })}
              </tr>

              {/* Linha Valorização Investimentos */}
              <tr className="bg-zinc-950 hover:bg-zinc-900/30 font-semibold text-zinc-300">
                <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 border-r border-white/[0.06] text-[11px] text-zinc-400">
                  Valorização Positiva
                </td>
                {months.map((m) => {
                  const val = monthlySummaries[m]?.valorizacaoInvest ?? 0;
                  return (
                    <td
                      key={m}
                      className={`px-4 py-2 text-right tabular-nums text-[11px] font-bold ${
                        val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-zinc-600'
                      }`}
                    >
                      {val !== 0 ? `+${formatBRL(val)}` : '—'}
                    </td>
                  );
                })}
              </tr>

              {/* Linha Valor Diferença */}
              <tr className="bg-zinc-950/80 hover:bg-zinc-900/30 text-zinc-400">
                <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 border-r border-white/[0.06] text-[11px] text-zinc-500">
                  Variação Líquida
                </td>
                {months.map((m) => {
                  const val = monthlySummaries[m]?.valorDiferenca ?? 0;
                  return (
                    <td
                      key={m}
                      className={`px-4 py-2 text-right tabular-nums text-[11px] font-semibold ${
                        val > 0 ? 'text-zinc-300' : val < 0 ? 'text-red-400' : 'text-zinc-600'
                      }`}
                    >
                      {val !== 0 ? formatBRL(val) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal: Atualizar Saldo do Mês */}
      {isUpdateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-lg font-bold text-white">Atualizar Saldos do Mês</h3>
                <p className="text-xs text-zinc-400">Referência: {formatMonthHeader(targetMonth)}</p>
              </div>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => openMonthEditor(e.target.value)}
                className="bg-zinc-900 text-xs font-bold px-2.5 py-1.5 rounded-xl border border-white/[0.1] text-zinc-200 outline-none"
              />
            </div>

            <form onSubmit={handleSaveMonth} className="mt-4 space-y-4">
              <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                {data.accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: acc.color }}
                      />
                      <span className="font-bold text-sm text-zinc-100">{acc.name}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">
                          Saldo Final (R$)
                        </label>
                        <input
                          placeholder="0,00"
                          inputMode="decimal"
                          value={formBalances[acc.id] ?? ''}
                          onChange={(e) =>
                            setFormBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="w-full rounded-xl border border-white/[0.08] bg-zinc-950 px-3 py-2 text-sm text-white font-bold tabular-nums outline-none focus:border-emerald-500/60"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">
                          Rendeu (+) / Saque (-)
                        </label>
                        <input
                          placeholder="0,00 ou -500,00"
                          inputMode="text"
                          value={formDeltas[acc.id] ?? ''}
                          onChange={(e) =>
                            setFormDeltas((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="w-full rounded-xl border border-white/[0.08] bg-zinc-950 px-3 py-2 text-sm text-white font-bold tabular-nums outline-none focus:border-emerald-500/60"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2.5 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsUpdateModalOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  disabled={saving}
                  className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-300 transition disabled:opacity-60"
                >
                  {saving ? 'Salvando…' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Nova Conta */}
      {isAddAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Nova Conta / Corretora</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Ex: XP, BTG, Nubank Caixinha, Inter...</p>

            <form onSubmit={handleAddAccount} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Nome da Instituição
                </label>
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="EX: NUBANK RESERVA"
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-white font-bold outline-none uppercase focus:border-emerald-500/60"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={newAccountColor}
                    onChange={(e) => setNewAccountColor(e.target.value)}
                    className="h-10 w-14 rounded-xl border border-white/[0.08] bg-zinc-900 cursor-pointer p-1"
                  />
                  <span className="text-xs font-mono font-bold text-zinc-300">{newAccountColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-300">
                  Criar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
