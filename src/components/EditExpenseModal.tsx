import { useState, type FormEvent } from 'react';
import { api, type Category, type Expense, type AccountId, type PaymentMethod, ACCOUNT_DEFINITIONS } from '../api';
import { formatBRL, formatCurrencyInput, parseBRL } from '../format';
import { useToast } from '../context';
import { CustomSelect } from './ui';

type Props = {
  expense: Expense | null;
  categories: Category[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditExpenseModal({ expense, categories, isOpen, onClose, onSaved }: Props) {
  const toast = useToast();

  if (!isOpen || !expense) return null;

  return <EditExpenseForm expense={expense} categories={categories} onClose={onClose} onSaved={onSaved} toast={toast} />;
}

function EditExpenseForm({
  expense,
  categories,
  onClose,
  onSaved,
  toast,
}: {
  expense: Expense;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [title, setTitle] = useState(expense.title || '');
  const [amount, setAmount] = useState((expense.amount_cents / 100).toFixed(2).replace('.', ','));
  const [categoryId, setCategoryId] = useState<number>(expense.category_id);
  const [spentOn, setSpentOn] = useState(expense.spent_on);
  const [accountId, setAccountId] = useState<AccountId>(expense.account_id || 'nubank');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(expense.payment_method || 'debit');
  const [description, setDescription] = useState(expense.description || '');
  const [allInstallments, setAllInstallments] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleAccountChange(acc: AccountId) {
    setAccountId(acc);
    if (acc !== 'nubank') {
      setPaymentMethod('voucher');
    } else if (paymentMethod === 'voucher') {
      setPaymentMethod('credit');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents || cents <= 0) return toast('Informe um valor válido', 'error');
    if (!title.trim()) return toast('Informe o título do lançamento', 'error');
    if (!categoryId) return toast('Selecione uma categoria', 'error');
    if (!spentOn) return toast('Informe a data', 'error');

    setSaving(true);
    try {
      await api(`/expenses/${expense.id}?all_installments=${allInstallments}`, {
        method: 'PUT',
        body: {
          title: title.trim(),
          amount_cents: cents,
          category_id: categoryId,
          spent_on: spentOn,
          account_id: accountId,
          payment_method: paymentMethod,
          description: description.trim(),
        },
      });

      toast('Lançamento atualizado com sucesso!');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message || 'Falha ao atualizar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
          <div>
            <h3 className="text-lg font-bold text-white">Editar Lançamento</h3>
            {expense.installment_total > 1 && (
              <p className="text-xs text-purple-400 font-medium">
                Parcela {expense.installment_current} de {expense.installment_total}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-900 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Título */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Título / Nome
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Compra do Mês, Supermercado..."
              required
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
            />
          </div>

          {/* Valor e Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                Valor (R$)
              </label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(formatCurrencyInput(e.target.value))}
                placeholder="0,00"
                required
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                Data
              </label>
              <input
                type="date"
                value={spentOn}
                onChange={(e) => setSpentOn(e.target.value)}
                required
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
              />
            </div>
          </div>

          {/* Categoria */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Categoria
            </label>
            <CustomSelect
              value={String(categoryId)}
              onChange={(val) => setCategoryId(Number(val))}
              options={categories.map((c) => ({
                value: String(c.id),
                label: c.name,
              }))}
              searchPlaceholder="Pesquisar categoria..."
            />
          </div>

          {/* Conta de Pagamento */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Conta de Pagamento
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ACCOUNT_DEFINITIONS.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => handleAccountChange(acc.id)}
                  className={`rounded-xl border p-2 text-center text-xs font-semibold transition ${
                    accountId === acc.id
                      ? `${acc.badgeClass} border-current ring-1 ring-current`
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {acc.tag}
                </button>
              ))}
            </div>
          </div>

          {/* Forma de Pagamento */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Forma de Pagamento
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {accountId === 'nubank' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('credit')}
                    className={`rounded-xl border p-2 text-center text-xs font-semibold transition ${
                      paymentMethod === 'credit'
                        ? 'border-purple-500/50 bg-purple-500/20 text-purple-300 ring-1 ring-purple-500'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Crédito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('debit')}
                    className={`rounded-xl border p-2 text-center text-xs font-semibold transition ${
                      paymentMethod === 'debit'
                        ? 'border-purple-500/50 bg-purple-500/20 text-purple-300 ring-1 ring-purple-500'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Débito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('pix')}
                    className={`rounded-xl border p-2 text-center text-xs font-semibold transition ${
                      paymentMethod === 'pix'
                        ? 'border-purple-500/50 bg-purple-500/20 text-purple-300 ring-1 ring-purple-500'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Pix
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('voucher')}
                  className="rounded-xl border border-emerald-500/50 bg-emerald-500/20 text-emerald-300 p-2 text-center text-xs font-semibold ring-1 ring-emerald-500 col-span-2"
                >
                  Benefício / Voucher
                </button>
              )}
            </div>
          </div>

          {/* Observação */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Observação (Opcional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Detalhe sobre o gasto..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
            />
          </div>

          {/* Opção para parcelas em lote */}
          {expense.installment_total > 1 && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-purple-200">
                <input
                  type="checkbox"
                  checked={allInstallments}
                  onChange={(e) => setAllInstallments(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-purple-500"
                />
                <span>
                  Aplicar título, categoria e conta em <strong>todas as {expense.installment_total} parcelas</strong>
                </span>
              </label>
            </div>
          )}

          {/* Ações */}
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-900">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-400 px-5 py-2 text-sm font-bold text-black hover:bg-emerald-300 transition disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

