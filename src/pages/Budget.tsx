import { useEffect, useState, type FormEvent } from 'react';
import { api, type Category, type Income } from '../api';
import { useToast } from '../context';
import { centsToInput, formatBRL, parseBRL } from '../format';
import { Card, IconPlus, IconTrash, Input, PageTitle, Spinner } from '../components/ui';

type Field = { key: string; placeholder: string; money?: boolean; className?: string };

/** Linha editável: salva automaticamente ao sair do campo */
function EditableRow<T extends { id: number }>({
  item,
  fields,
  onSave,
  onDelete,
}: {
  item: T;
  fields: Field[];
  onSave: (id: number, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (item: T) => void;
}) {
  const toText = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = (item as Record<string, unknown>)[f.key];
        return [f.key, f.money ? centsToInput(v as number) : String(v ?? '')];
      }),
    );
  const [values, setValues] = useState<Record<string, string>>(toText);
  useEffect(() => setValues(toText()), [item]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(f: Field) {
    const raw = values[f.key];
    const current = (item as Record<string, unknown>)[f.key];
    let next: unknown = raw.trim();
    if (f.money) {
      next = parseBRL(raw);
      if (next === null) return setValues(toText());
    } else if (f.key === 'name' && !next) {
      return setValues(toText());
    }
    if (next === current) return setValues(toText());
    await onSave(item.id, { [f.key]: next }).catch(() => setValues(toText()));
  }

  return (
    <div className="flex items-start gap-2 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            value={values[f.key]}
            placeholder={f.placeholder}
            inputMode={f.money ? 'decimal' : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            onBlur={() => commit(f)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={f.className}
          />
        ))}
      </div>
      <button
        onClick={() => onDelete(item)}
        className="mt-1 rounded-lg p-2 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
        aria-label="Excluir"
      >
        <IconTrash className="h-5 w-5" />
      </button>
    </div>
  );
}

/** Formulário para adicionar nova linha */
function AddRow({ fields, onAdd }: { fields: Field[]; onAdd: (values: Record<string, unknown>) => Promise<void> }) {
  const empty = () => Object.fromEntries(fields.map((f) => [f.key, '']));
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.money) {
        const c = parseBRL(values[f.key] || '0');
        if (c === null) return toast('Valor inválido', 'error');
        out[f.key] = c;
      } else out[f.key] = values[f.key].trim();
    }
    if (!out.name) return toast('Informe o nome', 'error');
    setBusy(true);
    try {
      await onAdd(out);
      setValues(empty());
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-start gap-2 border-t border-dashed border-zinc-800 pt-3">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {fields.map((f) => (
          <Input
            key={f.key}
            value={values[f.key]}
            placeholder={f.placeholder}
            inputMode={f.money ? 'decimal' : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={f.className}
          />
        ))}
      </div>
      <button
        disabled={busy}
        className="mt-1 rounded-lg bg-emerald-400 p-2 text-black hover:bg-emerald-300 disabled:opacity-60"
        aria-label="Adicionar"
      >
        <IconPlus className="h-5 w-5" />
      </button>
    </form>
  );
}

const INCOME_FIELDS: Field[] = [
  { key: 'name', placeholder: 'Nome', className: 'flex-1 min-w-0 basis-32 font-medium' },
  { key: 'amount_cents', placeholder: '0,00', money: true, className: 'w-32 shrink-0 text-right tabular-nums' },
];
const CATEGORY_FIELDS: Field[] = [
  { key: 'name', placeholder: 'Categoria', className: 'flex-1 min-w-0 basis-32 font-medium' },
  { key: 'budget_cents', placeholder: '0,00', money: true, className: 'w-32 shrink-0 text-right tabular-nums' },
  { key: 'note', placeholder: 'Observação (opcional)', className: 'basis-full !py-1.5 text-sm text-zinc-400' },
];

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

  // Helpers genéricos de CRUD com feedback
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

      {/* Resumo */}
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

      {/* Ganhos */}
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Ganhos</h2>
          <span className="text-sm font-semibold text-emerald-400 tabular-nums">{formatBRL(totalIncome)}</span>
        </div>
        <div className="divide-y divide-zinc-900">
          {incomes.map((it) => (
            <EditableRow
              key={it.id}
              item={it}
              fields={INCOME_FIELDS}
              onSave={async (id, patch) => {
                const upd = await run(() => api<Income>(`/incomes/${id}`, { method: 'PUT', body: patch }), 'Salvo');
                setIncomes((l) => l!.map((x) => (x.id === id ? upd : x)));
              }}
              onDelete={async (item) => {
                if (!confirm(`Excluir "${item.name}"?`)) return;
                await run(() => api(`/incomes/${item.id}`, { method: 'DELETE' }), 'Excluído');
                setIncomes((l) => l!.filter((x) => x.id !== item.id));
              }}
            />
          ))}
        </div>
        <AddRow
          fields={INCOME_FIELDS}
          onAdd={async (v) => {
            const created = await run(() => api<Income>('/incomes', { method: 'POST', body: v }), 'Ganho adicionado');
            setIncomes((l) => [...l!, created]);
          }}
        />
      </Card>

      {/* Gastos previstos */}
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Gastos previstos (teto por categoria)</h2>
          <span className="text-sm font-semibold text-red-400 tabular-nums">{formatBRL(totalBudget)}</span>
        </div>
        <div className="divide-y divide-zinc-900">
          {cats.map((c) => (
            <EditableRow
              key={c.id}
              item={c}
              fields={CATEGORY_FIELDS}
              onSave={async (id, patch) => {
                const upd = await run(() => api<Category>(`/categories/${id}`, { method: 'PUT', body: patch }), 'Salvo');
                setCats((l) => l!.map((x) => (x.id === id ? upd : x)));
              }}
              onDelete={async (item) => {
                if (!confirm(`Excluir a categoria "${item.name}"?`)) return;
                await run(() => api(`/categories/${item.id}`, { method: 'DELETE' }), 'Categoria excluída');
                setCats((l) => l!.filter((x) => x.id !== item.id));
              }}
            />
          ))}
        </div>
        <AddRow
          fields={CATEGORY_FIELDS}
          onAdd={async (v) => {
            const created = await run(() => api<Category>('/categories', { method: 'POST', body: v }), 'Categoria adicionada');
            setCats((l) => [...l!, created]);
          }}
        />
      </Card>

      {/* Gastos por fora */}
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

