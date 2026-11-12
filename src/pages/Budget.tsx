import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type Category, type Income } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL } from '../format';
import { Card, IconPlus, IconTrash, Input, PageTitle, Spinner } from '../components/ui';
import DistributionChart from '../components/DistributionChart';

/* =========================================================
   LINHA DE GANHO (Nome + Valor na mesma linha + Excluir)
   ========================================================= */
function IncomeRow({
  item,
  onSave,
  onDelete,
}: {
  item: Income;
  onSave: (id: number, patch: { name?: string; amount_cents?: number }) => Promise<void>;
  onDelete: (id: number, name: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(centsToInput(item.amount_cents));

  useEffect(() => {
    setName(item.name);
    setAmount(centsToInput(item.amount_cents));
  }, [item]);

  async function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) {
      setName(item.name);
      return;
    }
    await onSave(item.id, { name: trimmed }).catch(() => setName(item.name));
  }

  async function commitAmount() {
    const parsed = parseBRL(amount);
    if (parsed === null || parsed === item.amount_cents) {
      setAmount(centsToInput(item.amount_cents));
      return;
    }
    await onSave(item.id, { amount_cents: parsed }).catch(() => setAmount(centsToInput(item.amount_cents)));
  }

  return (
    <div className="flex items-center gap-2 py-2">
      {/* Campo Nome */}
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          placeholder="Nome do ganho"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="font-medium"
        />
      </div>

      {/* Campo Valor com prefixo R$ fixo */}
      <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <span className="text-xs font-semibold text-zinc-500 mr-1.5 select-none">R$</span>
        <input
          value={amount}
          placeholder="0,00"
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full bg-transparent text-right font-semibold text-emerald-400 tabular-nums outline-none placeholder:text-zinc-700"
        />
      </div>

      {/* Botão Excluir */}
      <button
        onClick={() => onDelete(item.id, item.name)}
        className="rounded-lg p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
        title="Excluir ganho"
        aria-label="Excluir"
      >
        <IconTrash className="h-5 w-5" />
      </button>
    </div>
  );
}

/* =========================================================
   LINHA DE CATEGORIA / GASTO PREVISTO
   Linha 1: Tipo (Fixa/Variável) + Nome + Valor (teto) + Excluir
   Linha 2: Observação (opcional)
   ========================================================= */
function CategoryRow({
  item,
  onSave,
  onDelete,
}: {
  item: Category;
  onSave: (id: number, patch: { name?: string; budget_cents?: number; note?: string; is_fixed?: number }) => Promise<void>;
  onDelete: (id: number, name: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [budget, setBudget] = useState(centsToInput(item.budget_cents));
  const [note, setNote] = useState(item.note);
  const isFixed = item.is_fixed === undefined ? 1 : Number(item.is_fixed);

  useEffect(() => {
    setName(item.name);
    setBudget(centsToInput(item.budget_cents));
    setNote(item.note);
  }, [item]);

  async function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) {
      setName(item.name);
      return;
    }
    await onSave(item.id, { name: trimmed }).catch(() => setName(item.name));
  }

  async function commitBudget() {
    const parsed = parseBRL(budget);
    if (parsed === null || parsed === item.budget_cents) {
      setBudget(centsToInput(item.budget_cents));
      return;
    }
    await onSave(item.id, { budget_cents: parsed }).catch(() => setBudget(centsToInput(item.budget_cents)));
  }

  async function commitNote() {
    const trimmed = note.trim();
    if (trimmed === item.note) return;
    await onSave(item.id, { note: trimmed }).catch(() => setNote(item.note));
  }

  async function toggleFixed() {
    const next = isFixed === 1 ? 0 : 1;
    await onSave(item.id, { is_fixed: next });
  }

  return (
    <div className="py-2.5 space-y-1.5 transition hover:bg-zinc-900/30 px-2 rounded-xl">
      <div className="flex items-center gap-2">
        {/* Botão de Alternar Fixa / Variável */}
        <button
          type="button"
          onClick={toggleFixed}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold border transition ${
            isFixed === 1
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30 ring-1 ring-blue-500/30'
              : 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30 ring-1 ring-purple-500/30'
          }`}
          title={isFixed === 1 ? 'Categoria Fixa (com teto). Clique para mudar para Variável.' : 'Categoria Variável (Por Fora). Clique para mudar para Fixa.'}
        >
          {isFixed === 1 ? 'Fixa' : 'Variável'}
        </button>

        {/* Campo Nome da Categoria */}
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            placeholder="Nome da categoria"
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="font-medium"
          />
        </div>

        {/* Campo Teto Mensal R$ (Permanece sempre visível para não causar sustos) */}
        <div className={`w-36 sm:w-44 shrink-0 flex items-center rounded-xl border bg-zinc-900 px-3 py-1.5 focus-within:ring-2 ${
          isFixed === 1
            ? 'border-zinc-800 focus-within:border-emerald-500/60 focus-within:ring-emerald-500/20'
            : 'border-purple-500/30 bg-purple-950/10 focus-within:border-purple-500/60 focus-within:ring-purple-500/20'
        }`}>
          <span className="text-xs font-semibold text-zinc-500 mr-1.5 select-none">R$</span>
          <input
            value={budget}
            placeholder="0,00"
            inputMode="decimal"
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={`w-full bg-transparent text-right font-semibold tabular-nums outline-none placeholder:text-zinc-700 ${
              isFixed === 1 ? 'text-red-400' : 'text-purple-300'
            }`}
          />
        </div>

        {/* Botão Excluir */}
        <button
          onClick={() => onDelete(item.id, item.name)}
          className="rounded-lg p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
          title="Excluir categoria"
          aria-label="Excluir"
        >
          <IconTrash className="h-5 w-5" />
        </button>
      </div>

      {/* Linha auxiliar: Observação e indicador de Por Fora se for variável */}
      <div className="flex items-center gap-2 pl-12 pr-12">
        <input
          value={note}
          placeholder={isFixed === 1 ? 'Adicionar observação (ex: Água inclusa)...' : 'Observação (Consome do valor Por Fora)...'}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded-lg bg-zinc-900/40 px-3 py-1 text-xs text-zinc-400 placeholder:text-zinc-600 outline-none border border-transparent focus:border-zinc-800"
        />
        {isFixed === 0 && (
          <span className="shrink-0 text-[10px] font-semibold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
            Consome do Por Fora
          </span>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   FORMULÁRIO PARA ADICIONAR NOVO GANHO
   ========================================================= */
function AddIncomeRow({ onAdd }: { onAdd: (name: string, amountCents: number) => Promise<void> }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast('Informe o nome do ganho', 'error');
    const cents = parseBRL(amount || '0');
    if (cents === null) return toast('Valor inválido', 'error');

    setBusy(true);
    try {
      await onAdd(trimmed, cents);
      setName('');
      setAmount('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t border-dashed border-zinc-800 pt-3 mt-1">
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          placeholder="Novo ganho..."
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5">
        <span className="text-xs font-semibold text-zinc-500 mr-1.5">R$</span>
        <input
          value={amount}
          placeholder="0,00"
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-transparent text-right font-semibold text-emerald-400 tabular-nums outline-none placeholder:text-zinc-700"
        />
      </div>
      <button
        disabled={busy}
        className="rounded-xl bg-emerald-400 p-2 text-black hover:bg-emerald-300 transition disabled:opacity-60"
        aria-label="Adicionar ganho"
        title="Adicionar ganho"
      >
        <IconPlus className="h-5 w-5" />
      </button>
    </form>
  );
}

/* =========================================================
   FORMULÁRIO PARA ADICIONAR NOVA CATEGORIA
   ========================================================= */
function AddCategoryRow({
  onAdd,
}: {
  onAdd: (name: string, budgetCents: number, note: string, isFixed: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');
  const [isFixed, setIsFixed] = useState(1); // 1 = Fixa, 0 = Variável
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast('Informe o nome da categoria', 'error');
    const cents = isFixed === 1 ? parseBRL(budget || '0') : 0;
    if (cents === null) return toast('Valor inválido', 'error');

    setBusy(true);
    try {
      await onAdd(trimmed, cents, note.trim(), isFixed);
      setName('');
      setBudget('');
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-dashed border-zinc-800 pt-3 mt-1">
      {/* Seletor de Tipo: Fixa ou Variável */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-zinc-400">Tipo:</span>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          <button
            type="button"
            onClick={() => setIsFixed(1)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              isFixed === 1 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'text-zinc-400'
            }`}
          >
            Fixa (com teto)
          </button>
          <button
            type="button"
            onClick={() => setIsFixed(0)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              isFixed === 0 ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'text-zinc-400'
            }`}
          >
            Variável (Por Fora)
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            placeholder={isFixed === 1 ? 'Nova categoria fixa...' : 'Nova categoria variável...'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {isFixed === 1 ? (
          <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5">
            <span className="text-xs font-semibold text-zinc-500 mr-1.5">R$</span>
            <input
              value={budget}
              placeholder="0,00"
              inputMode="decimal"
              onChange={(e) => setBudget(e.target.value)}
              className="w-full bg-transparent text-right font-semibold text-red-400 tabular-nums outline-none placeholder:text-zinc-700"
            />
          </div>
        ) : (
          <div className="w-36 sm:w-44 shrink-0 flex items-center justify-end rounded-xl border border-dashed border-purple-500/30 bg-purple-500/5 px-3 py-2 text-right">
            <span className="text-xs font-medium text-purple-300">Consome Por Fora</span>
          </div>
        )}
        <button
          disabled={busy}
          className="rounded-xl bg-emerald-400 p-2 text-black hover:bg-emerald-300 transition disabled:opacity-60"
          aria-label="Adicionar categoria"
          title="Adicionar categoria"
        >
          <IconPlus className="h-5 w-5" />
        </button>
      </div>
      <div className="pr-12">
        <input
          value={note}
          placeholder="Observação (opcional)..."
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-400 placeholder:text-zinc-600 outline-none border border-transparent focus:border-zinc-800"
        />
      </div>
    </form>
  );
}

/* =========================================================
   TELA PRINCIPAL: ORÇAMENTO PESSOAL
   ========================================================= */
export default function Budget() {
  const toast = useToast();
  const [incomes, setIncomes] = useState<Income[] | null>(null);
  const [cats, setCats] = useState<Category[] | null>(null);
  const [catFilter, setCatFilter] = useState<'all' | 'fixed' | 'variable'>('all');

  const budgetDistributionItems = useMemo(() => {
    return (cats ?? []).map((c) => ({
      name: c.name,
      amount_cents: c.budget_cents,
    }));
  }, [cats]);

  useEffect(() => {
    Promise.all([api<Income[]>('/incomes'), api<Category[]>('/categories')])
      .then(([i, c]) => {
        setIncomes(i);
        setCats(c);
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const run = async <R,>(fn: () => Promise<R>, ok?: string) => {
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
      throw e;
    }
  };

  if (!incomes || !cats) return <Spinner />;

  const totalIncome = incomes.reduce((s, x) => s + x.amount_cents, 0);
  const fixedCats = cats.filter((c) => c.is_fixed === undefined || c.is_fixed === 1);
  const variableCats = cats.filter((c) => c.is_fixed === 0);

  const fixedBudget = fixedCats.reduce((s, x) => s + x.budget_cents, 0);
  const leftover = totalIncome - fixedBudget;

  const displayedCats =
    catFilter === 'fixed' ? fixedCats : catFilter === 'variable' ? variableCats : cats;

  return (
    <div className="space-y-4">
      <PageTitle title="Orçamento Pessoal" subtitle="Sua meta mensal. Os gastos previstos viram o teto de cada categoria." />

      {/* Cards de Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="!p-3">
          <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Ganhos</p>
          <p className="mt-1 text-sm font-bold text-emerald-400 tabular-nums sm:text-base">{formatBRL(totalIncome)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Gastos Fixos</p>
          <p className="mt-1 text-sm font-bold text-red-400 tabular-nums sm:text-base">{formatBRL(fixedBudget)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Por fora</p>
          <p className={`mt-1 text-sm font-bold tabular-nums sm:text-base ${leftover < 0 ? 'text-red-400' : 'text-purple-300'}`}>
            {formatBRL(leftover)}
          </p>
        </Card>
      </div>

      {/* Dashboard de Distribuição do Orçamento */}
      <DistributionChart
        title="Distribuição do Orçamento Previsto"
        subtitle="Representatividade percentual e cores de cada categoria no orçamento estipulado"
        items={budgetDistributionItems}
      />

      {/* Seção Ganhos */}
      <Card>
        <div className="mb-2 flex items-center justify-between border-b border-zinc-900 pb-2">
          <h2 className="font-semibold text-base">Ganhos</h2>
          <span className="text-sm font-semibold text-emerald-400 tabular-nums">{formatBRL(totalIncome)}</span>
        </div>
        <div className="divide-y divide-zinc-900">
          {incomes.map((it) => (
            <IncomeRow
              key={it.id}
              item={it}
              onSave={async (id, patch) => {
                const upd = await run(() => api<Income>(`/incomes/${id}`, { method: 'PUT', body: patch }), 'Salvo');
                setIncomes((l) => l!.map((x) => (x.id === id ? upd : x)));
              }}
              onDelete={async (id, name) => {
                if (!confirm(`Excluir ganho "${name}"?`)) return;
                await run(() => api(`/incomes/${id}`, { method: 'DELETE' }), 'Excluído');
                setIncomes((l) => l!.filter((x) => x.id !== id));
              }}
            />
          ))}
        </div>
        <AddIncomeRow
          onAdd={async (name, amountCents) => {
            const created = await run(
              () => api<Income>('/incomes', { method: 'POST', body: { name, amount_cents: amountCents } }),
              'Ganho adicionado',
            );
            setIncomes((l) => [...l!, created]);
          }}
        />
      </Card>

      {/* Seção Categorias (Lista Unificada Estável com Filtros) */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 pb-3">
          <div>
            <h2 className="font-semibold text-base">Categorias de Gastos</h2>
            <p className="text-xs text-zinc-500">
              Fixas: teto estipulado • Variáveis: consomem do valor Por Fora
            </p>
          </div>

          {/* Abas de Filtro para visualização */}
          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-1 text-xs">
            <button
              type="button"
              onClick={() => setCatFilter('all')}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                catFilter === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Todas ({cats.length})
            </button>
            <button
              type="button"
              onClick={() => setCatFilter('fixed')}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                catFilter === 'fixed' ? 'bg-blue-500/20 text-blue-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Fixas ({fixedCats.length})
            </button>
            <button
              type="button"
              onClick={() => setCatFilter('variable')}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                catFilter === 'variable' ? 'bg-purple-500/20 text-purple-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Variáveis ({variableCats.length})
            </button>
          </div>
        </div>

        <div className="divide-y divide-zinc-900">
          {displayedCats.map((c) => (
            <CategoryRow
              key={c.id}
              item={c}
              onSave={async (id, patch) => {
                const isTypeChange = patch.is_fixed !== undefined;
                const message = isTypeChange
                  ? `Categoria alterada para ${patch.is_fixed === 1 ? 'Fixa' : 'Variável (Por Fora)'}`
                  : 'Salvo';
                const upd = await run(
                  () => api<Category>(`/categories/${id}`, { method: 'PUT', body: patch }),
                  message,
                );
                setCats((l) => l!.map((x) => (x.id === id ? upd : x)));
              }}
              onDelete={async (id, name) => {
                if (!confirm(`Excluir a categoria "${name}"?`)) return;
                await run(() => api(`/categories/${id}`, { method: 'DELETE' }), 'Categoria excluída');
                setCats((l) => l!.filter((x) => x.id !== id));
              }}
            />
          ))}
        </div>

        <AddCategoryRow
          onAdd={async (name, budgetCents, note, isFixed) => {
            const created = await run(
              () =>
                api<Category>('/categories', {
                  method: 'POST',
                  body: { name, budget_cents: budgetCents, note, is_fixed: isFixed },
                }),
              'Categoria adicionada',
            );
            setCats((l) => [...l!, created]);
          }}
        />
      </Card>

      {/* Card Gastos por fora */}
      <Card className={leftover < 0 ? 'border-red-500/40' : 'border-purple-500/30'}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Gastos por fora</p>
            <p className="text-xs text-zinc-500">Ganhos − gastos fixos previstos</p>
          </div>
          <p className={`text-xl font-bold tabular-nums ${leftover < 0 ? 'text-red-400' : 'text-purple-300'}`}>
            {formatBRL(leftover)}
          </p>
        </div>
      </Card>
    </div>
  );
}
