import { useEffect, useState, type FormEvent } from 'react';
import { api, type Category, type Income } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL } from '../format';
import { Card, IconPlus, IconTrash, Input, PageTitle, Spinner } from '../components/ui';

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
   Linha 1: Nome + Valor (teto) + Excluir
   Linha 2: Observação (opcional)
   ========================================================= */
function CategoryRow({
  item,
  onSave,
  onDelete,
}: {
  item: Category;
  onSave: (id: number, patch: { name?: string; budget_cents?: number; note?: string }) => Promise<void>;
  onDelete: (id: number, name: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [budget, setBudget] = useState(centsToInput(item.budget_cents));
  const [note, setNote] = useState(item.note);

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

  return (
    <div className="py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        {/* Campo Categoria */}
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

        {/* Campo Teto Mensal R$ */}
        <div className="w-36 sm:w-44 shrink-0 flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
          <span className="text-xs font-semibold text-zinc-500 mr-1.5 select-none">R$</span>
          <input
            value={budget}
            placeholder="0,00"
            inputMode="decimal"
            onChange={(e) => setBudget(e.target.value)}
            onBlur={commitBudget}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full bg-transparent text-right font-semibold text-red-400 tabular-nums outline-none placeholder:text-zinc-700"
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

      {/* Observação logo abaixo (indentada) */}
      <div className="pr-12">
        <input
          value={note}
          placeholder="Adicionar observação (ex: Água inclusa)..."
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded-lg bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-400 placeholder:text-zinc-600 outline-none border border-transparent focus:border-zinc-800"
        />
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
  onAdd: (name: string, budgetCents: number, note: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast('Informe o nome da categoria', 'error');
    const cents = parseBRL(budget || '0');
    if (cents === null) return toast('Valor inválido', 'error');

    setBusy(true);
    try {
      await onAdd(trimmed, cents, note.trim());
      setName('');
      setBudget('');
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-dashed border-zinc-800 pt-3 mt-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Input
            value={name}
            placeholder="Nova categoria..."
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
  const totalBudget = cats.reduce((s, x) => s + x.budget_cents, 0);
  const leftover = totalIncome - totalBudget;

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
          <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Gastos</p>
          <p className="mt-1 text-sm font-bold text-red-400 tabular-nums sm:text-base">{formatBRL(totalBudget)}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[11px] tracking-wide text-zinc-500 uppercase">Por fora</p>
          <p className={`mt-1 text-sm font-bold tabular-nums sm:text-base ${leftover < 0 ? 'text-red-400' : 'text-white'}`}>
            {formatBRL(leftover)}
          </p>
        </Card>
      </div>

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

      {/* Seção Gastos Previstos */}
      <Card>
        <div className="mb-2 flex items-center justify-between border-b border-zinc-900 pb-2">
          <div>
            <h2 className="font-semibold text-base">Gastos previstos</h2>
            <p className="text-xs text-zinc-500">Teto máximo estipulado por categoria</p>
          </div>
          <span className="text-sm font-semibold text-red-400 tabular-nums">{formatBRL(totalBudget)}</span>
        </div>
        <div className="divide-y divide-zinc-900">
          {cats.map((c) => (
            <CategoryRow
              key={c.id}
              item={c}
              onSave={async (id, patch) => {
                const upd = await run(() => api<Category>(`/categories/${id}`, { method: 'PUT', body: patch }), 'Salvo');
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
          onAdd={async (name, budgetCents, note) => {
            const created = await run(
              () => api<Category>('/categories', { method: 'POST', body: { name, budget_cents: budgetCents, note } }),
              'Categoria adicionada',
            );
            setCats((l) => [...l!, created]);
          }}
        />
      </Card>

      {/* Card Gastos por fora */}
      <Card className={leftover < 0 ? 'border-red-500/40' : 'border-emerald-500/30'}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Gastos por fora</p>
            <p className="text-xs text-zinc-500">Ganhos − gastos previstos</p>
          </div>
          <p className={`text-xl font-bold tabular-nums ${leftover < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {formatBRL(leftover)}
          </p>
        </div>
      </Card>
    </div>
  );
}
