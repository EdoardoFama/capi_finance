import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type Dashboard, type AccountBalance, type AccountId, ACCOUNT_DEFINITIONS } from '../api';
import { useMonth, useToast } from '../context';
import { formatBRL, parseBRL, percent } from '../format';
import { Card, IconPlus, MonthPicker, ProgressBar, Spinner, textColor } from '../components/ui';

function AccountCard({
  account,
  month,
  onUpdate,
}: {
  account: AccountBalance;
  month: string;
  onUpdate: (accountId: AccountId, newInitialCents: number) => void;
}) {
  const info = ACCOUNT_DEFINITIONS.find((a) => a.id === account.account_id) ?? {
    id: account.account_id,
    name: account.name,
    tag: account.name,
    color: '#10b981',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    borderClass: 'border-zinc-800',
  };

  const toast = useToast();
  const [val, setVal] = useState(
    account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setVal(account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '');
  }, [account.initial_cents]);

  async function handleSave() {
    const parsed = parseBRL(val);
    const newCents = parsed ?? 0;
    if (newCents === account.initial_cents) return;

    setIsSaving(true);
    try {
      await api('/accounts/balance', {
        method: 'PUT',
        body: { month, account_id: account.account_id, initial_cents: newCents },
      });
      onUpdate(account.account_id, newCents);
      toast(`Saldo de ${info.name} salvo!`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const isNegative = account.current_cents < 0;
  const spentPct = account.initial_cents > 0
    ? Math.min(100, Math.round((account.spent_cents / account.initial_cents) * 100))
    : (account.spent_cents > 0 ? 100 : 0);

  return (
    <Card className={`relative flex flex-col justify-between border transition hover:border-zinc-700 ${info.borderClass}`}>
      <div>
        {/* Header da Conta */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: info.color }}
            />
            <span className="text-xs font-bold tracking-wide text-zinc-200">{info.name}</span>
          </div>
          <Link
            to={`/lancar?conta=${account.account_id}`}
            title={`Lançar gasto em ${info.name}`}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-400 transition"
          >
            <IconPlus className="h-4 w-4" />
          </Link>
        </div>

        {/* Saldo Atual (Restante) */}
        <div className="mt-3">
          <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Saldo Atual</p>
          <p className={`mt-0.5 text-2xl font-bold tracking-tight ${isNegative ? 'text-red-400' : 'text-emerald-400'}`}>
            {formatBRL(account.current_cents)}
          </p>
        </div>

        {/* Barra de progresso de consumo */}
        <div className="mt-2.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full transition-all ${isNegative ? 'bg-red-500' : ''}`}
              style={{
                width: `${spentPct}%`,
                backgroundColor: isNegative ? undefined : info.color,
              }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
            <span>{spentPct}% consumido</span>
            <span>
              {account.initial_cents > 0
                ? `${formatBRL(account.current_cents)} livre`
                : 'Defina o saldo'}
            </span>
          </div>
        </div>
      </div>

      {/* Campo aberto para editar o Saldo em Conta */}
      <div className="mt-3.5 border-t border-zinc-800/80 pt-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-zinc-400">Saldo em conta:</label>
          <div className="relative flex items-center">
            <span className="text-xs text-zinc-500 mr-1">R$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              disabled={isSaving}
              className="w-24 rounded-lg border border-zinc-700/80 bg-zinc-950 px-2 py-1 text-right text-xs font-semibold text-zinc-100 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>Gastos abatidos:</span>
          <span className="font-medium text-zinc-400">
            {account.spent_cents > 0 ? `-${formatBRL(account.spent_cents)}` : formatBRL(0)}
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function Home() {
  const { month } = useMonth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    api<Dashboard>(`/dashboard?month=${month}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [month]);

  function handleAccountInitialUpdate(accountId: AccountId, newInitialCents: number) {
    setData((prev) => {
      if (!prev) return prev;
      const updatedAccounts = (prev.accounts ?? []).map((acc) => {
        if (acc.account_id === accountId) {
          return {
            ...acc,
            initial_cents: newInitialCents,
            spent_cents: 0,
            current_cents: newInitialCents,
          };
        }
        return acc;
      });
      return { ...prev, accounts: updatedAccounts };
    });
  }

  const totalPct = data ? percent(data.total_spent_cents, data.total_budget_cents) : 0;

  return (
    <div className="space-y-5">
      <MonthPicker />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!data && !error && <Spinner />}

      {data && (
        <>
          {/* ================= SALDO EM CONTA & BENEFÍCIOS ================= */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight text-zinc-100">
                Saldo em Conta & Benefícios
              </h2>
              <span className="text-[11px] text-zinc-500">
                Digite o valor para atualizar
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(data.accounts ?? []).map((acc) => (
                <AccountCard
                  key={acc.account_id}
                  account={acc}
                  month={month}
                  onUpdate={handleAccountInitialUpdate}
                />
              ))}
            </div>
          </div>

          {/* Resumo do orçamento do mês */}
          <Card className="bg-gradient-to-br from-zinc-900 to-black">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Gasto no mês</p>
                <p className="mt-1 text-3xl font-bold tracking-tight">{formatBRL(data.total_spent_cents)}</p>
                <p className="mt-0.5 text-sm text-zinc-500">de {formatBRL(data.total_budget_cents)} previstos</p>
              </div>
              <span className={`text-2xl font-bold ${textColor(totalPct)}`}>{totalPct}%</span>
            </div>
            <ProgressBar spent={data.total_spent_cents} budget={data.total_budget_cents} className="mt-4 h-2.5" />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 text-sm">
              <div>
                <p className="text-zinc-500">Restante do orçamento</p>
                <p className={`font-semibold ${data.total_budget_cents - data.total_spent_cents < 0 ? 'text-red-400' : ''}`}>
                  {formatBRL(data.total_budget_cents - data.total_spent_cents)}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Ganhos previstos</p>
                <p className="font-semibold">{formatBRL(data.total_income_cents)}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-zinc-900 pt-3">
              <Link
                to="/extrato"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition"
              >
                Ver extrato completo do mês →
              </Link>
            </div>
          </Card>

          {/* Categorias */}
          <div className="flex items-center justify-between pt-1">
            <h2 className="text-base font-semibold text-zinc-100">Por categoria</h2>
            <Link to="/orcamento" className="text-xs text-emerald-400 hover:underline">
              Editar orçamento
            </Link>
          </div>

          {data.categories.length === 0 ? (
            <Card className="text-center text-sm text-zinc-500">
              Nenhuma categoria ainda.{' '}
              <Link to="/orcamento" className="text-emerald-400">
                Crie seu orçamento
              </Link>
              .
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.categories.map((c) => {
                const pct = percent(c.spent_cents, c.budget_cents);
                const left = c.budget_cents - c.spent_cents;
                return (
                  <Link key={c.id} to={`/lancar?categoria=${c.id}`} className="block">
                    <Card className="transition hover:border-zinc-700 active:scale-[0.99]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold">{c.name}</p>
                        <span className={`shrink-0 text-sm font-bold ${textColor(pct)}`}>{pct}%</span>
                      </div>
                      <ProgressBar spent={c.spent_cents} budget={c.budget_cents} className="mt-3 h-2" />
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-zinc-400">
                          {formatBRL(c.spent_cents)} <span className="text-zinc-600">/ {formatBRL(c.budget_cents)}</span>
                        </span>
                        <span className={left < 0 ? 'text-red-400' : 'text-zinc-500'}>
                          {left < 0 ? `Excedeu ${formatBRL(-left)}` : `Resta ${formatBRL(left)}`}
                        </span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Botão flutuante (desktop) */}
      <Link
        to="/lancar"
        className="fixed right-6 bottom-6 hidden items-center gap-2 rounded-full bg-emerald-400 px-5 py-3 font-semibold text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-300 md:flex"
      >
        <IconPlus className="h-5 w-5" /> Lançar gasto
      </Link>
    </div>
  );
}
