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
    <div className="flex items-center gap-2.5 py-2.5 px-2 rounded-xl transition hover:bg-zinc-900/40">
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          placeholder="Nome da fonte de renda"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="font-semibold"
        />
      </div>

      <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-white/[0.08] bg-zinc-900/90 px-3 py-2 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <span className="text-xs font-bold text-zinc-500 mr-1.5 select-none">R$</span>
        <input
          value={amount}
          placeholder="0,00"
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full bg-transparent text-right font-extrabold text-emerald-400 tabular-nums outline-none placeholder:text-zinc-700"
        />
      </div>

      <button
        onClick={() => onDelete(item.id, item.name)}
        className="rounded-xl p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
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
   ========================================================= */
function CategoryRow({
  item,
  totalIncome,
  onSave,
  onDelete,
}: {
  item: Category;
  totalIncome: number;
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

  const incomeShare =
    totalIncome > 0 && item.budget_cents > 0
      ? ((item.budget_cents / totalIncome) * 100).toFixed(1)
      : null;

  return (
    <div className="py-3 space-y-2 transition hover:bg-zinc-900/35 px-2.5 rounded-2xl">
      <div className="flex items-center gap-2">
        {/* Botão de Alternar Fixa / Variável */}
        <button
          type="button"
          onClick={toggleFixed}
          className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-extrabold border transition ${
            isFixed === 1
              ? 'bg-blue-500/15 text-blue-300 border-blue-500/35 hover:bg-blue-500/25'
              : 'bg-purple-500/15 text-purple-300 border-purple-500/35 hover:bg-purple-500/25'
          }`}
          title={
            isFixed === 1
              ? 'Categoria Fixa (com teto). Clique para mudar para Variável.'
              : 'Categoria Variável (Por Fora). Clique para mudar para Fixa.'
          }
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
            className="font-bold"
          />
        </div>

        {/* Campo Teto Mensal R$ */}
        <div
          className={`w-36 sm:w-44 shrink-0 flex items-center rounded-xl border px-3 py-2 focus-within:ring-2 ${
            isFixed === 1
              ? 'border-white/[0.08] bg-zinc-900/90 focus-within:border-blue-500/60 focus-within:ring-blue-500/20'
              : 'border-purple-500/25 bg-purple-950/15 focus-within:border-purple-500/60 focus-within:ring-purple-500/20'
          }`}
        >
          <span className="text-xs font-bold text-zinc-500 mr-1.5 select-none">R$</span>
          <input
            value={budget}
            placeholder="0,00"
            inputMode="decimal"
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={`w-full bg-transparent text-right font-extrabold tabular-nums outline-none placeholder:text-zinc-700 ${
              isFixed === 1 ? 'text-zinc-100' : 'text-purple-300'
            }`}
          />
        </div>

        {/* Botão Excluir */}
        <button
          onClick={() => onDelete(item.id, item.name)}
          className="rounded-xl p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
          title="Excluir categoria"
          aria-label="Excluir"
        >
          <IconTrash className="h-5 w-5" />
        </button>
      </div>

      {/* Linha auxiliar: Observação e indicador de % da renda ou Por Fora */}
      <div className="flex items-center gap-2 pl-2 sm:pl-14 pr-10">
        <input
          value={note}
          placeholder={
            isFixed === 1
              ? 'Adicionar nota / descrição (ex: XBOX - 20 + GEMINI IA - 36)...'
              : 'Observação da categoria variável...'
          }
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded-lg bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none border border-transparent focus:border-white/15 focus:bg-zinc-900"
        />
        {isFixed === 1 && incomeShare && (
          <span className="shrink-0 rounded-md bg-zinc-900 border border-white/[0.06] px-2 py-0.5 text-[10px] font-bold text-zinc-400 tabular-nums">
            {incomeShare}% da renda
          </span>
        )}
        {isFixed === 0 && (
          <span className="shrink-0 text-[10px] font-bold text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md border border-purple-500/25">
            Por Fora
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
    <form onSubmit={submit} className="flex items-center gap-2.5 border-t border-dashed border-white/[0.08] pt-3.5 mt-2">
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          placeholder="Adicionar nova fonte de renda..."
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-white/[0.08] bg-zinc-900/90 px-3 py-2">
        <span className="text-xs font-bold text-zinc-500 mr-1.5">R$</span>
        <input
          value={amount}
          placeholder="0,00"
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-transparent text-right font-extrabold text-emerald-400 tabular-nums outline-none placeholder:text-zinc-700"
        />
      </div>
      <button
        disabled={busy}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-black shadow-md shadow-emerald-500/20 hover:bg-emerald-300 transition disabled:opacity-60"
        aria-label="Adicionar ganho"
        title="Adicionar ganho"
      >
        <IconPlus className="h-5 w-5 stroke-[2.4]" />
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
  const [isFixed, setIsFixed] = useState(1);
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
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-dashed border-white/[0.1] bg-zinc-900/30 p-3.5 mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Criar Nova Categoria
        </span>
        <div className="inline-flex rounded-xl border border-white/[0.08] bg-zinc-950 p-1">
          <button
            type="button"
            onClick={() => setIsFixed(1)}
            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
              isFixed === 1
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Fixa (Com Teto)
          </button>
          <button
            type="button"
            onClick={() => setIsFixed(0)}
            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
              isFixed === 0
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-zinc-400 hover:text-white'
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
            placeholder={isFixed === 1 ? 'Ex: ACADEMIA, CONDOMÍNIO...' : 'Ex: LAZER, PRESENTES...'}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {isFixed === 1 ? (
          <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2">
            <span className="text-xs font-bold text-zinc-500 mr-1.5">R$</span>
            <input
              value={budget}
              placeholder="0,00"
              inputMode="decimal"
              onChange={(e) => setBudget(e.target.value)}
              className="w-full bg-transparent text-right font-extrabold text-zinc-100 tabular-nums outline-none placeholder:text-zinc-700"
            />
          </div>
        ) : (
          <div className="w-36 sm:w-44 shrink-0 flex items-center justify-center rounded-xl border border-dashed border-purple-500/30 bg-purple-500/10 px-3 py-2.5">
            <span className="text-xs font-bold text-purple-300">Usa o Por Fora</span>
          </div>
        )}
        <button
          disabled={busy}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-black shadow-md shadow-emerald-500/20 hover:bg-emerald-300 transition disabled:opacity-60"
          aria-label="Adicionar categoria"
          title="Adicionar categoria"
        >
          <IconPlus className="h-5 w-5 stroke-[2.4]" />
        </button>
      </div>
      <div>
        <input
          value={note}
          placeholder="Nota ou descrição (opcional)..."
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none border border-white/[0.05] focus:border-white/15"
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
  const committedPct = totalIncome > 0 ? Math.round((fixedBudget / totalIncome) * 100) : 0;

  const displayedCats =
    catFilter === 'fixed' ? fixedCats : catFilter === 'variable' ? variableCats : cats;

  return (
    <div className="space-y-5">
      <PageTitle
        title="Planejamento & Orçamento"
        subtitle="Configure suas fontes de renda, metas fixas mensais e categorias variáveis"
      />

      {/* Cards Executivos de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="border-emerald-500/20 bg-gradient-to-br from-zinc-950 to-emerald-950/20">
          <p className="text-[11px] font-bold tracking-wider text-emerald-400/90 uppercase">
            Renda Mensal Prevista
          </p>
          <p className="mt-1 text-2xl font-black text-white tabular-nums">
            {formatBRL(totalIncome)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {incomes.length} {incomes.length === 1 ? 'fonte cadastrada' : 'fontes cadastradas'}
          </p>
        </Card>

        <Card className="border-blue-500/20 bg-gradient-to-br from-zinc-950 to-blue-950/20">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-wider text-blue-300 uppercase">
              Total Fixos Orçados
            </p>
            <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">
              {committedPct}% da renda
            </span>
          </div>
          <p className="mt-1 text-2xl font-black text-white tabular-nums">
            {formatBRL(fixedBudget)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Soma de {fixedCats.length} categorias fixas
          </p>
        </Card>

        <Card
          className={
            leftover < 0
              ? 'border-red-500/30 bg-gradient-to-br from-zinc-950 to-red-950/20'
              : 'border-purple-500/25 bg-gradient-to-br from-zinc-950 to-purple-950/25'
          }
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-wider text-purple-300 uppercase">
              Margem "Por Fora"
            </p>
            <span className="rounded-md bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">
              {Math.max(0, 100 - committedPct)}% livre
            </span>
          </div>
          <p
            className={`mt-1 text-2xl font-black tabular-nums ${
              leftover < 0 ? 'text-red-400' : 'text-purple-300'
            }`}
          >
            {formatBRL(leftover)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Ganhos − Fixos (para gastos variáveis)
          </p>
        </Card>
      </div>

      {/* Dashboard de Distribuição do Orçamento */}
      <DistributionChart
        title="Distribuição do Orçamento Fixo"
        subtitle="Peso percentual de cada categoria planejada dentro do seu custo fixo mensal"
        items={budgetDistributionItems}
      />

      {/* Seção Ganhos */}
      <Card>
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h2 className="font-bold text-base text-white">Fontes de Renda</h2>
            <p className="text-xs text-zinc-500">Salário, adiantamentos e rendimentos recorrentes</p>
          </div>
          <span className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-sm font-extrabold text-emerald-300 tabular-nums">
            {formatBRL(totalIncome)}
          </span>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {incomes.map((it) => (
            <IncomeRow
              key={it.id}
              item={it}
              onSave={async (id, patch) => {
                const upd = await run(
                  () => api<Income>(`/incomes/${id}`, { method: 'PUT', body: patch }),
                  'Ganho atualizado',
                );
                setIncomes((l) => l!.map((x) => (x.id === id ? upd : x)));
              }}
              onDelete={async (id, name) => {
                if (!confirm(`Excluir ganho "${name}"?`)) return;
                await run(() => api(`/incomes/${id}`, { method: 'DELETE' }), 'Ganho excluído');
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

      {/* Seção Categorias */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3.5">
          <div>
            <h2 className="font-bold text-base text-white">Categorias de Gastos</h2>
            <p className="text-xs text-zinc-500">
              Alterne entre <strong>Fixa</strong> e <strong>Variável</strong> ou edite valores e notas diretamente
            </p>
          </div>

          {/* Abas de Filtro para visualização */}
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 p-1 text-xs">
            <button
              type="button"
              onClick={() => setCatFilter('all')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                catFilter === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Todas ({cats.length})
            </button>
            <button
              type="button"
              onClick={() => setCatFilter('fixed')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                catFilter === 'fixed' ? 'bg-blue-500/20 text-blue-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Fixas ({fixedCats.length})
            </button>
            <button
              type="button"
              onClick={() => setCatFilter('variable')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                catFilter === 'variable' ? 'bg-purple-500/20 text-purple-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Variáveis ({variableCats.length})
            </button>
          </div>
        </div>

        <div className="divide-y divide-white/[0.05]">
          {displayedCats.map((c) => (
            <CategoryRow
              key={c.id}
              item={c}
              totalIncome={totalIncome}
              onSave={async (id, patch) => {
                const isTypeChange = patch.is_fixed !== undefined;
                const message = isTypeChange
                  ? `Categoria alterada para ${patch.is_fixed === 1 ? 'Fixa' : 'Variável (Por Fora)'}`
                  : 'Categoria salva';
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
    </div>
  );
}
