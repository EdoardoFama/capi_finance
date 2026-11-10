import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type InvestmentAccount, type InvestmentSnapshot, type InvestmentsData } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL } from '../format';
import { Card, IconPlus, PageTitle, Spinner } from '../components/ui';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function formatMonthHeader(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3).toUpperCase()}/${String(y).slice(2)}`;
}

export default function Investments() {
  const toast = useToast();
  const [data, setData] = useState<InvestmentsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal para atualizar ou lançar saldo de um mês
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState('');
  const [formBalances, setFormBalances] = useState<Record<number, string>>({});
  const [formDeltas, setFormDeltas] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  // Modal para adicionar nova conta/corretora
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

  // Lista ordenada de todos os meses disponíveis + mês atual se não existir
  const months = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.snapshots.forEach((s) => set.add(s.month));
    const nowMonth = new Date().toISOString().slice(0, 7);
    set.add(nowMonth);
    return Array.from(set).sort();
  }, [data]);

  // Mapa rápido de busca: `${account_id}_${month}` -> Snapshot
  const snapshotMap = useMemo(() => {
    const map = new Map<string, InvestmentSnapshot>();
    data?.snapshots.forEach((s) => {
      map.set(`${s.account_id}_${s.month}`, s);
    });
    return map;
  }, [data]);

  // Totais calculados por mês
  const monthlySummaries = useMemo(() => {
    if (!data) return {};
    const summaries: Record<
      string,
      { totalBalance: number; valorizacaoInvest: number; totalDelta: number; valorDiferenca: number }
    > = {};

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      let totalBalance = 0;
      let totalDelta = 0; // soma dos deltas (saques/aportes) do mês

      data.accounts.forEach((acc) => {
        const snap = snapshotMap.get(`${acc.id}_${m}`);
        if (snap) {
          totalBalance += snap.balance_cents;
          totalDelta += snap.delta_cents;
        }
      });

      // Valorização dos investimentos em relação ao mês anterior:
      // se houve mês anterior: totalBalance(atual) - totalBalance(anterior) - totalDelta(atual)
      let valorizacaoInvest = 0;
      if (i > 0) {
        const prevMonth = months[i - 1];
        const prevTotal = summaries[prevMonth]?.totalBalance ?? 0;
        if (prevTotal > 0 && totalBalance > 0) {
          valorizacaoInvest = totalBalance - prevTotal - totalDelta;
        }
      }

      // Valor Diferença: valorizacaoInvest + totalDelta (ou balanço direto do mês)
      const valorDiferenca = valorizacaoInvest + totalDelta;

      summaries[m] = {
        totalBalance,
        valorizacaoInvest,
        totalDelta,
        valorDiferenca,
      };
    }
    return summaries;
  }, [data, months, snapshotMap]);

  // Abre modal de edição para um mês específico
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
        // Permite delta negativo
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

  if (loading || !data) return <Spinner />;

  const latestMonth = months[months.length - 1];
  const latestSummary = monthlySummaries[latestMonth];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <PageTitle title="Investimentos" subtitle="Acompanhamento mensal de patrimônio e rendimentos" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddAccountOpen(true)}
            className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition"
          >
            <IconPlus className="h-4 w-4" /> Nova Conta
          </button>
          <button
            onClick={() => openMonthEditor(new Date().toISOString().slice(0, 7))}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-400 px-3.5 py-2 text-xs font-semibold text-black transition hover:bg-emerald-300"
          >
            <IconPlus className="h-4 w-4" /> Atualizar Mês
          </button>
        </div>
      </div>

      {/* Cards de Resumo do Último Mês */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-zinc-900 to-black">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Patrimônio Total ({formatMonthHeader(latestMonth)})</p>
          <p className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {formatBRL(latestSummary?.totalBalance ?? 0)}
          </p>
        </Card>

        <Card>
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Rendimento / Valorização</p>
          <p
            className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${
              (latestSummary?.valorizacaoInvest ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {formatBRL(latestSummary?.valorizacaoInvest ?? 0)}
          </p>
        </Card>

        <Card>
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Aporte / Saque Líquido</p>
          <p
            className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${
              (latestSummary?.totalDelta ?? 0) >= 0 ? 'text-zinc-200' : 'text-amber-400'
            }`}
          >
            {formatBRL(latestSummary?.totalDelta ?? 0)}
          </p>
        </Card>
      </div>

      {/* Tabela de Evolução Estilo Planilha */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-900">
          <h2 className="font-semibold text-sm">Planilha de Evolução Patrimonial</h2>
          <span className="text-xs text-zinc-500">Arraste para o lado para ver todos os meses</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3 border-r border-zinc-800 min-w-36">
                  Conta / Mês
                </th>
                {months.map((m) => (
                  <th key={m} className="px-4 py-3 text-right min-w-28 hover:text-white cursor-pointer" onClick={() => openMonthEditor(m)} title="Clique para editar este mês">
                    <span className="hover:underline">{formatMonthHeader(m)} ✏️</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-900 font-medium">
              {data.accounts.map((acc) => (
                <>
                  {/* Linha Saldo da Conta */}
                  <tr key={`bal_${acc.id}`} className="hover:bg-zinc-900/40 transition">
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2.5 border-r border-zinc-900 font-bold flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                      <span className="truncate">{acc.name}</span>
                    </td>
                    {months.map((m) => {
                      const snap = snapshotMap.get(`${acc.id}_${m}`);
                      return (
                        <td key={m} className="px-4 py-2.5 text-right tabular-nums text-zinc-200">
                          {snap ? formatBRL(snap.balance_cents) : '-'}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Linha Rendimento / Saque da Conta */}
                  <tr key={`delta_${acc.id}`} className="bg-zinc-950/60 hover:bg-zinc-900/30 transition text-[11px]">
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-1.5 border-r border-zinc-900 text-zinc-500 pl-8">
                      Rendeu / Saque
                    </td>
                    {months.map((m) => {
                      const snap = snapshotMap.get(`${acc.id}_${m}`);
                      const val = snap?.delta_cents ?? 0;
                      return (
                        <td
                          key={m}
                          className={`px-4 py-1.5 text-right tabular-nums font-mono ${
                            val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-zinc-600'
                          }`}
                        >
                          {snap ? (val > 0 ? `+${formatBRL(val)}` : formatBRL(val)) : '-'}
                        </td>
                      );
                    })}
                  </tr>
                </>
              ))}

              {/* Linha TOTAL PATRIMÔNIO */}
              <tr className="border-t-2 border-zinc-800 bg-zinc-900/60 font-bold text-white">
                <td className="sticky left-0 z-10 bg-zinc-900 px-4 py-3 border-r border-zinc-800">TOTAL</td>
                {months.map((m) => {
                  const s = monthlySummaries[m];
                  return (
                    <td key={m} className="px-4 py-3 text-right tabular-nums text-emerald-400">
                      {s?.totalBalance ? formatBRL(s.totalBalance) : '-'}
                    </td>
                  );
                })}
              </tr>

              {/* Linha Valorização Investimentos */}
              <tr className="bg-zinc-950 hover:bg-zinc-900/30 font-semibold text-zinc-300">
                <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 border-r border-zinc-900 text-[11px] text-zinc-400">
                  Valorização Invest.
                </td>
                {months.map((m) => {
                  const val = monthlySummaries[m]?.valorizacaoInvest ?? 0;
                  return (
                    <td
                      key={m}
                      className={`px-4 py-2 text-right tabular-nums text-[11px] ${
                        val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-zinc-500'
                      }`}
                    >
                      {val !== 0 ? formatBRL(val) : '-'}
                    </td>
                  );
                })}
              </tr>

              {/* Linha Valor Diferença */}
              <tr className="bg-zinc-950/80 hover:bg-zinc-900/30 text-zinc-400">
                <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-2 border-r border-zinc-900 text-[11px] text-zinc-500">
                  Valor Diferença
                </td>
                {months.map((m) => {
                  const val = monthlySummaries[m]?.valorDiferenca ?? 0;
                  return (
                    <td
                      key={m}
                      className={`px-4 py-2 text-right tabular-nums text-[11px] ${
                        val > 0 ? 'text-zinc-300' : val < 0 ? 'text-red-400' : 'text-zinc-600'
                      }`}
                    >
                      {val !== 0 ? formatBRL(val) : '-'}
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
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div>
                <h3 className="text-lg font-bold text-white">Atualizar Investimentos</h3>
                <p className="text-xs text-zinc-400">Mês de referência: {targetMonth}</p>
              </div>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => openMonthEditor(e.target.value)}
                className="bg-zinc-900 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-200 outline-none"
              />
            </div>

            <form onSubmit={handleSaveMonth} className="mt-4 space-y-4">
              <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
                {data.accounts.map((acc) => (
                  <div key={acc.id} className="rounded-xl border border-zinc-850 bg-zinc-900/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                      <span className="font-semibold text-sm text-zinc-200">{acc.name}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] uppercase font-semibold text-zinc-500 block mb-1">
                          Saldo Total (R$)
                        </label>
                        <input
                          placeholder="0,00"
                          inputMode="decimal"
                          value={formBalances[acc.id] ?? ''}
                          onChange={(e) =>
                            setFormBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-white font-semibold outline-none focus:border-emerald-500/60"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-semibold text-zinc-500 block mb-1">
                          Rendeu (+) / Saque (-)
                        </label>
                        <input
                          placeholder="0,00 ou -1.000"
                          inputMode="text"
                          value={formDeltas[acc.id] ?? ''}
                          onChange={(e) =>
                            setFormDeltas((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-white font-semibold outline-none focus:border-emerald-500/60"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                <button
                  type="button"
                  onClick={() => setIsUpdateModalOpen(false)}
                  className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-850"
                >
                  Cancelar
                </button>
                <button
                  disabled={saving}
                  className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-60"
                >
                  {saving ? 'Salvando…' : 'Salvar Mês'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Nova Conta */}
      {isAddAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Nova Conta de Investimento</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Ex: XP, BTG, NuInvest, etc.</p>

            <form onSubmit={handleAddAccount} className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Nome</label>
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="NOME DA CORRETORA/CONTA"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white font-semibold outline-none uppercase"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Cor da tag</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newAccountColor}
                    onChange={(e) => setNewAccountColor(e.target.value)}
                    className="h-9 w-12 rounded-lg border border-zinc-800 bg-zinc-900 cursor-pointer p-0.5"
                  />
                  <span className="text-xs font-mono text-zinc-400">{newAccountColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddAccountOpen(false)}
                  className="flex-1 rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-850"
                >
                  Cancelar
                </button>
                <button className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-sm font-semibold text-black hover:bg-emerald-300">
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
