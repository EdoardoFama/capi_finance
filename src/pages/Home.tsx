import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type Dashboard } from '../api';
import { useMonth } from '../context';
import { formatBRL, percent } from '../format';
import { Card, IconPlus, MonthPicker, ProgressBar, Spinner, textColor } from '../components/ui';

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

  const totalPct = data ? percent(data.total_spent_cents, data.total_budget_cents) : 0;

  return (
    <div className="space-y-4">
      <MonthPicker />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!data && !error && <Spinner />}

      {data && (
        <>
          {/* Resumo do mês */}
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
          </Card>

          {/* Categorias */}
          <div className="flex items-center justify-between pt-2">
            <h2 className="text-lg font-semibold">Por categoria</h2>
            <Link to="/orcamento" className="text-sm text-emerald-400 hover:underline">
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

