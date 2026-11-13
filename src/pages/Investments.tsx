import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type InvestmentAccount, type InvestmentSnapshot, type InvestmentsData, type RedeemResult, type UserAccount } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL, shiftMonth, todayISO } from '../format';
import { Card, IconArrowDownLeft, IconEdit, IconPlus, IconTrash, PageTitle, Spinner } from '../components/ui';
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
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal de Atualização de Saldos do Mês (Cálculo Automático)
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState('');
  const [formBalances, setFormBalances] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  // Modal de Adição de Corretora
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountColor, setNewAccountColor] = useState('#10b981');

  // Modal de Edição de Corretora
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<InvestmentAccount | null>(null);
  const [editAccountName, setEditAccountName] = useState('');
  const [editAccountColor, setEditAccountColor] = useState('#10b981');

  // Modal de Saque / Resgate de Investimento
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [redeemAccountId, setRedeemAccountId] = useState<number | null>(null);
  const [redeemDestAccount, setRedeemDestAccount] = useState<string>('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemDate, setRedeemDate] = useState(todayISO());
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [invRes, accsRes] = await Promise.all([
        api<InvestmentsData>('/investments'),
        api<UserAccount[]>('/accounts').catch(() => []),
      ]);
      setData(invRes);
      setUserAccounts(accsRes);
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

  // Saldo mais recente registrado de uma conta
  const getAccountLatestBalance = useCallback(
    (accountId: number): number => {
      if (!data) return 0;
      const pastSnaps = data.snapshots
        .filter((s) => s.account_id === accountId)
        .sort((a, b) => b.month.localeCompare(a.month));
      return pastSnaps[0]?.balance_cents ?? 0;
    },
    [data],
  );

  // Snapshot mais recente registrado de uma conta
  const getAccountLatestSnapshot = useCallback(
    (accountId: number): InvestmentSnapshot | undefined => {
      if (!data) return undefined;
      const pastSnaps = data.snapshots
        .filter((s) => s.account_id === accountId)
        .sort((a, b) => b.month.localeCompare(a.month));
      return pastSnaps[0];
    },
    [data],
  );

  // Saldo anterior a um mês de referência
  const getPreviousBalance = useCallback(
    (accountId: number, beforeMonth: string): number => {
      if (!data) return 0;
      const pastSnaps = data.snapshots
        .filter((s) => s.account_id === accountId && s.month < beforeMonth)
        .sort((a, b) => b.month.localeCompare(a.month));
      return pastSnaps[0]?.balance_cents ?? 0;
    },
    [data],
  );

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

  function openMonthEditor(monthStr: string) {
    setTargetMonth(monthStr);
    const balances: Record<number, string> = {};

    data?.accounts.forEach((acc) => {
      const snap = snapshotMap.get(`${acc.id}_${monthStr}`);
      const prevBal = getPreviousBalance(acc.id, monthStr);

      if (snap) {
        balances[acc.id] = centsToInput(snap.balance_cents);
      } else {
        // Pré-preenche com o saldo anterior para não zerar acidentalmente contas não editadas
        balances[acc.id] = prevBal > 0 ? centsToInput(prevBal) : '';
      }
    });

    setFormBalances(balances);
    setIsUpdateModalOpen(true);
  }

  async function handleSaveMonth(e: FormEvent) {
    e.preventDefault();
    if (!targetMonth || !data) return;
    setSaving(true);
    try {
      for (const acc of data.accounts) {
        const rawBal = formBalances[acc.id] || '';
        const prevBal = getPreviousBalance(acc.id, targetMonth);
        const balCents = rawBal.trim() ? (parseBRL(rawBal) ?? 0) : prevBal;
        // O próprio sistema calcula a variação com base no saldo anterior
        const autoDelta = balCents - prevBal;

        await api('/investments/snapshot', {
          method: 'POST',
          body: {
            account_id: acc.id,
            month: targetMonth,
            balance_cents: balCents,
            delta_cents: autoDelta,
          },
        });
      }
      toast(`Investimentos de ${formatMonthHeader(targetMonth)} atualizados com sucesso!`);
      setIsUpdateModalOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function openRedeemModal(preferredAccountId?: number) {
    if (!data || data.accounts.length === 0) return;
    const initialAccId =
      preferredAccountId ??
      data.accounts.find((acc) => getAccountLatestBalance(acc.id) > 0)?.id ??
      data.accounts[0].id;

    setRedeemAccountId(initialAccId);
    setRedeemAmount('');
    setRedeemDate(todayISO());

    // Conta de destino padrão: 'nubank' se existir, ou a primeira do usuário
    const defaultDest =
      userAccounts.find((a) => a.slug === 'nubank')?.slug ??
      userAccounts[0]?.slug ??
      'nubank';
    setRedeemDestAccount(defaultDest);

    setIsRedeemOpen(true);
  }

  async function handleConfirmRedeem(e: FormEvent) {
    e.preventDefault();
    if (!redeemAccountId) return;
    const amountCents = parseBRL(redeemAmount);
    if (!amountCents || amountCents <= 0) {
      return toast('Informe um valor de resgate válido', 'error');
    }

    const currentBal = getAccountLatestBalance(redeemAccountId);
    if (amountCents > currentBal) {
      return toast(`O valor informado excede o saldo disponível (${formatBRL(currentBal)})`, 'error');
    }

    const targetSnap = getAccountLatestSnapshot(redeemAccountId);
    const snapMonth = targetSnap?.month || activeLatestMonth || redeemDate.slice(0, 7);

    setRedeeming(true);
    try {
      const res = await api<RedeemResult>('/investments/redeem', {
        method: 'POST',
        body: {
          account_id: redeemAccountId,
          destination_account_id: redeemDestAccount || 'nubank',
          amount_cents: amountCents,
          month: snapMonth,
          snapshot_month: snapMonth,
          date: redeemDate,
        },
      });

      const destName = userAccounts.find((a) => a.slug === redeemDestAccount)?.name ?? 'conta';
      toast(`Resgate de ${formatBRL(res.redeemed_cents)} da ${res.account_name} creditado em ${destName}!`);
      setIsRedeemOpen(false);
      setRedeemAmount('');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setRedeeming(false);
    }
  }

  function openEditAccountModal(acc: InvestmentAccount) {
    setEditingAccount(acc);
    setEditAccountName(acc.name);
    setEditAccountColor(acc.color);
    setIsEditAccountOpen(true);
  }

  async function handleSaveEditAccount(e: FormEvent) {
    e.preventDefault();
    if (!editingAccount) return;
    const name = editAccountName.trim().toUpperCase();
    if (!name) return toast('Informe o nome da corretora', 'error');

    try {
      await api(`/investments/accounts/${editingAccount.id}`, {
        method: 'PUT',
        body: { name, color: editAccountColor },
      });
      toast(`Corretora ${name} atualizada!`);
      setIsEditAccountOpen(false);
      setEditingAccount(null);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function handleDeleteAccount(accId: number, accName: string) {
    const confirmDelete = window.confirm(
      `Deseja realmente excluir a corretora "${accName}" e todo o histórico de saldos dela? Esta ação não pode ser desfeita.`,
    );
    if (!confirmDelete) return;

    try {
      await api(`/investments/accounts/${accId}`, { method: 'DELETE' });
      toast(`Corretora "${accName}" excluída.`);
      if (isEditAccountOpen) setIsEditAccountOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
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
      toast(`Corretora ${name} adicionada!`);
      setNewAccountName('');
      setIsAddAccountOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Alocação por conta no mês ativo (carrega o saldo atual ou histórico mais recente de cada uma)
  const portfolioDistribution = useMemo(() => {
    if (!data) return [];
    return data.accounts.map((acc) => {
      let bal = 0;
      const snap = snapshotMap.get(`${acc.id}_${activeLatestMonth}`);
      if (snap) {
        bal = snap.balance_cents;
      } else {
        bal = getPreviousBalance(acc.id, activeLatestMonth);
      }
      return {
        id: acc.id,
        name: acc.name,
        amount_cents: bal,
        color: acc.color,
        onRedeem: () => openRedeemModal(acc.id),
        onEdit: () => openEditAccountModal(acc),
        onDelete: () => handleDeleteAccount(acc.id, acc.name),
      };
    });
  }, [data, activeLatestMonth, snapshotMap, getPreviousBalance]);

  if (loading || !data) return <Spinner />;

  const latestSummary = monthlySummaries[activeLatestMonth];
  const selectedRedeemAcc = data.accounts.find((a) => a.id === redeemAccountId);
  const selectedRedeemBal = selectedRedeemAcc ? getAccountLatestBalance(selectedRedeemAcc.id) : 0;
  const parsedRedeemCents = parseBRL(redeemAmount) ?? 0;
  const redeemRemainingCents = Math.max(0, selectedRedeemBal - parsedRedeemCents);
  const isRedeemOverLimit = parsedRedeemCents > selectedRedeemBal;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Carteira de Investimentos"
          subtitle="Evolução patrimonial, alocação por conta e rendimentos mensais"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsAddAccountOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-xs font-bold text-zinc-200 hover:bg-zinc-800 transition active:scale-95"
          >
            <IconPlus className="h-4 w-4 text-emerald-400" /> Nova Corretora
          </button>
          <button
            onClick={() => openRedeemModal()}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition active:scale-95"
          >
            <IconArrowDownLeft className="h-4 w-4" /> Sacar / Resgatar
          </button>
          <button
            onClick={() => openMonthEditor(activeLatestMonth || new Date().toISOString().slice(0, 7))}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2.5 text-xs font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-95"
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
            Soma de {data.accounts.length} {data.accounts.length === 1 ? 'corretora cadastrada' : 'corretoras cadastradas'}
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
          <p className="mt-1 text-[11px] text-zinc-500">Ganhos calculados automaticamente</p>
        </Card>

        <Card>
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Variação Líquida do Mês
          </p>
          <p
            className={`mt-1 text-2xl sm:text-3xl font-black tracking-tight tabular-nums ${
              (latestSummary?.totalDelta ?? 0) >= 0 ? 'text-blue-300' : 'text-amber-400'
            }`}
          >
            {(latestSummary?.totalDelta ?? 0) > 0 ? '+' : ''}
            {formatBRL(latestSummary?.totalDelta ?? 0)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">Diferença de patrimônio vs mês anterior</p>
        </Card>
      </div>

      {/* Distribuição da Carteira por Conta (Com botão de Sacar, Editar e Excluir) */}
      <DistributionChart
        title={`Alocação do Patrimônio (${formatMonthHeader(activeLatestMonth)})`}
        subtitle="Participação de cada corretora. Clique em Sacar para resgatar dinheiro para sua conta"
        items={portfolioDistribution}
      />

      {/* Tabela de Evolução Estilo Planilha */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-white/[0.06] bg-zinc-900/40">
          <div>
            <h2 className="font-bold text-sm text-white">Planilha de Evolução Patrimonial</h2>
            <p className="text-[11px] text-zinc-500">
              Clique no cabeçalho do mês para atualizar saldos ou no ícone da instituição para editar
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
                <th className="sticky left-0 z-20 bg-zinc-900 px-4 py-3 border-r border-white/[0.08] min-w-48">
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
                    <td className="sticky left-0 z-10 bg-zinc-950 px-4 py-3 border-r border-white/[0.06] font-bold flex items-center justify-between gap-2 text-zinc-100">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white/10"
                          style={{ backgroundColor: acc.color }}
                        />
                        <span className="truncate">{acc.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openRedeemModal(acc.id)}
                          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/20 transition"
                          title={`Sacar saldo de ${acc.name}`}
                        >
                          Sacar
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditAccountModal(acc)}
                          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                          title={`Editar ${acc.name}`}
                        >
                          <IconEdit className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAccount(acc.id, acc.name)}
                          className="rounded-md p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 transition"
                          title={`Excluir ${acc.name}`}
                        >
                          <IconTrash className="h-3 w-3" />
                        </button>
                      </div>
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
                      ↳ Variação / Rendimento
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

      {/* Modal: Atualizar Saldo do Mês (100% Automático) */}
      {isUpdateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-lg font-bold text-white">Atualizar Saldos do Mês</h3>
                <p className="text-xs text-zinc-400">
                  Defina o saldo final de cada corretora. O sistema calcula a rentabilidade sozinho!
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openMonthEditor(shiftMonth(targetMonth, -1))}
                  className="h-8 w-8 rounded-lg bg-zinc-900 text-zinc-400 hover:text-white flex items-center justify-center text-sm border border-white/[0.08] transition"
                  title="Mês anterior"
                >
                  ‹
                </button>
                <input
                  type="month"
                  value={targetMonth}
                  onChange={(e) => openMonthEditor(e.target.value)}
                  className="bg-zinc-900 text-xs font-bold px-2.5 py-1.5 rounded-xl border border-white/[0.1] text-zinc-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => openMonthEditor(shiftMonth(targetMonth, 1))}
                  className="h-8 w-8 rounded-lg bg-zinc-900 text-zinc-400 hover:text-white flex items-center justify-center text-sm border border-white/[0.08] transition"
                  title="Próximo mês"
                >
                  ›
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveMonth} className="mt-4 space-y-4">
              <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
                {data.accounts.map((acc) => {
                  const prevBal = getPreviousBalance(acc.id, targetMonth);
                  const rawVal = formBalances[acc.id] ?? '';
                  const currentCents = rawVal.trim() ? (parseBRL(rawVal) ?? 0) : prevBal;
                  const autoDiff = currentCents - prevBal;
                  const pct =
                    prevBal > 0
                      ? ((autoDiff / prevBal) * 100).toFixed(1)
                      : null;

                  return (
                    <div
                      key={acc.id}
                      className="rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: acc.color }}
                          />
                          <span className="font-bold text-sm text-zinc-100">{acc.name}</span>
                        </div>
                        <span className="text-[11px] text-zinc-500">
                          Saldo anterior: <strong className="text-zinc-300">{formatBRL(prevBal)}</strong>
                        </span>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">
                          Novo Saldo da Carteira (R$)
                        </label>
                        <input
                          placeholder={centsToInput(prevBal) || '0,00'}
                          inputMode="decimal"
                          value={formBalances[acc.id] ?? ''}
                          onChange={(e) =>
                            setFormBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="w-full rounded-xl border border-white/[0.08] bg-zinc-950 px-3.5 py-2 text-sm text-white font-bold tabular-nums outline-none focus:border-emerald-500/60"
                        />
                      </div>

                      {/* Variação calculada automaticamente em tempo real */}
                      <div className="flex items-center justify-between pt-1 text-xs px-1">
                        <span className="text-[11px] text-zinc-500">Rentabilidade / Variação calculada:</span>
                        <span
                          className={`text-xs font-bold tabular-nums ${
                            autoDiff > 0
                              ? 'text-emerald-400'
                              : autoDiff < 0
                              ? 'text-rose-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {autoDiff > 0 ? `+${formatBRL(autoDiff)}` : formatBRL(autoDiff)}
                          {pct !== null && ` (${autoDiff > 0 ? '+' : ''}${pct}%)`}
                          {autoDiff > 0 ? ' ↗' : autoDiff < 0 ? ' ↘' : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
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

      {/* Modal: Saque / Resgate de Investimento */}
      {isRedeemOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <IconArrowDownLeft className="h-5 w-5 text-amber-400" /> Saque / Resgate
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Abate da corretora e transfere o dinheiro para a conta selecionada.
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmRedeem} className="mt-4 space-y-4">
              {/* Seleção de Carteira de Origem */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
                  Corretora de Origem (Saque)
                </label>
                <select
                  value={redeemAccountId ?? ''}
                  onChange={(e) => setRedeemAccountId(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 font-bold outline-none focus:border-amber-500/60"
                >
                  {data.accounts.map((acc) => {
                    const bal = getAccountLatestBalance(acc.id);
                    return (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} — Saldo: {formatBRL(bal)} {bal <= 0 ? '(Sem saldo)' : ''}
                      </option>
                    );
                  })}
                </select>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                  <span>Disponível nesta corretora:</span>
                  <span className="font-bold text-zinc-200">{formatBRL(selectedRedeemBal)}</span>
                </div>
              </div>

              {/* Seleção de Conta de Destino */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
                  Conta de Destino (Receber Saldo)
                </label>
                <select
                  value={redeemDestAccount}
                  onChange={(e) => setRedeemDestAccount(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 font-bold outline-none focus:border-amber-500/60"
                >
                  {userAccounts.length === 0 ? (
                    <option value="nubank">NUBANK (Padrão)</option>
                  ) : (
                    userAccounts.map((uAcc) => (
                      <option key={uAcc.slug} value={uAcc.slug}>
                        {uAcc.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Valor do Resgate */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
                  Valor a Sacar (R$)
                </label>
                <input
                  placeholder="0,00"
                  inputMode="decimal"
                  value={redeemAmount}
                  onChange={(e) => setRedeemAmount(e.target.value)}
                  className={`w-full rounded-xl border bg-zinc-900 px-3.5 py-2.5 text-base text-white font-black tabular-nums outline-none transition ${
                    isRedeemOverLimit
                      ? 'border-red-500/60 focus:ring-2 focus:ring-red-500/20'
                      : 'border-white/[0.08] focus:border-amber-500/60'
                  }`}
                  required
                />

                {/* Chips de Atalho de Valor */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[10000, 50000, 100000].map((quickCents) => (
                    <button
                      key={quickCents}
                      type="button"
                      onClick={() => setRedeemAmount(centsToInput(quickCents))}
                      className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800 transition"
                    >
                      +{formatBRL(quickCents)}
                    </button>
                  ))}
                  {selectedRedeemBal > 0 && (
                    <button
                      type="button"
                      onClick={() => setRedeemAmount(centsToInput(selectedRedeemBal))}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 transition"
                    >
                      Sacar Tudo ({formatBRL(selectedRedeemBal)})
                    </button>
                  )}
                </div>
              </div>

              {/* Data do Resgate */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
                  Data da Operação
                </label>
                <input
                  type="date"
                  value={redeemDate}
                  onChange={(e) => setRedeemDate(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2 text-sm text-zinc-200 font-bold outline-none focus:border-amber-500/60"
                  required
                />
              </div>

              {/* Card de Pré-visualização da Transação */}
              {parsedRedeemCents > 0 && (
                <div
                  className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                    isRedeemOverLimit
                      ? 'border-red-500/30 bg-red-500/10 text-red-200'
                      : 'border-white/[0.08] bg-zinc-900/60 text-zinc-300'
                  }`}
                >
                  {isRedeemOverLimit ? (
                    <p className="font-bold text-red-400">
                      ⚠️ O valor a sacar ({formatBRL(parsedRedeemCents)}) é maior que o saldo disponível na corretora ({formatBRL(selectedRedeemBal)}).
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Origem ({selectedRedeemAcc?.name}):</span>
                        <span className="font-bold text-zinc-200">
                          {formatBRL(selectedRedeemBal)} ➔ {formatBRL(redeemRemainingCents)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">
                          Destino ({userAccounts.find((a) => a.slug === redeemDestAccount)?.name ?? 'Conta'}):
                        </span>
                        <span className="font-bold text-emerald-400">
                          +{formatBRL(parsedRedeemCents)} no saldo
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 pt-1 border-t border-white/[0.05]">
                        Será lançada uma Entrada no extrato dessa conta.
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsRedeemOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  disabled={redeeming || parsedRedeemCents <= 0 || isRedeemOverLimit}
                  className="flex-1 rounded-xl bg-amber-400 py-2.5 text-xs font-extrabold text-black hover:bg-amber-300 transition disabled:opacity-50"
                >
                  {redeeming ? 'Processando…' : 'Confirmar Saque'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Nova Corretora */}
      {isAddAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Nova Corretora / Carteira</h3>
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
                  Criar Corretora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Corretora */}
      {isEditAccountOpen && editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Editar Corretora</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Altere o nome, cor ou remova esta corretora.</p>

            <form onSubmit={handleSaveEditAccount} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Nome da Instituição
                </label>
                <input
                  value={editAccountName}
                  onChange={(e) => setEditAccountName(e.target.value)}
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
                    value={editAccountColor}
                    onChange={(e) => setEditAccountColor(e.target.value)}
                    className="h-10 w-14 rounded-xl border border-white/[0.08] bg-zinc-900 cursor-pointer p-1"
                  />
                  <span className="text-xs font-mono font-bold text-zinc-300">{editAccountColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleDeleteAccount(editingAccount.id, editingAccount.name)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/20 transition"
                  title="Excluir corretora"
                >
                  <IconTrash className="h-4 w-4" /> Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditAccountOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button className="flex-1 rounded-xl bg-emerald-400 py-2 text-xs font-extrabold text-black hover:bg-emerald-300">
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
