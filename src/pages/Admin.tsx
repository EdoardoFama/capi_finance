import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser } from '../api';
import { useAuth, useToast, useConfirm } from '../context';
import { Card, PageTitle, Spinner } from '../components/ui';

export default function Admin() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await api<AdminUser[]>('/admin/users');
      setUsers(list);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus(u: AdminUser) {
    const action = u.is_active === 1 ? 'bloquear' : 'desbloquear';
    const ok = await confirm({
      title: `${action === 'bloquear' ? 'Bloquear' : 'Desbloquear'} Usuário?`,
      message: `Deseja realmente ${action} o usuário "${u.username}"?`,
      confirmText: action === 'bloquear' ? 'Bloquear' : 'Desbloquear',
      cancelText: 'Cancelar',
      variant: action === 'bloquear' ? 'warning' : 'primary',
    });
    if (!ok) return;

    try {
      await api(`/admin/users/${u.id}/toggle-status`, { method: 'POST' });
      toast(`Usuário ${u.username} foi ${action === 'bloquear' ? 'bloqueado' : 'desbloqueado'}!`);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function deleteUser(u: AdminUser) {
    const ok = await confirm({
      title: 'Excluir Usuário Permanentemente?',
      message: `⚠️ ATENÇÃO: Deseja EXCLUIR permanentemente o usuário "${u.username}" e todos os seus dados?\n\nEsta ação é irreversível.`,
      confirmText: 'Excluir Permanentemente',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      toast(`Usuário ${u.username} excluído!`);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  if (!user?.is_admin) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-xl font-bold text-red-400">Acesso Restrito</h2>
        <p className="mt-1 text-sm text-zinc-500">Esta área é exclusiva para o administrador do sistema.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle
        title="Painel de Administração"
        subtitle="Gerenciamento de contas e usuários do Capi Finance"
      />

      {loading || !users ? (
        <Spinner />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-900">
            <h2 className="font-semibold text-sm">Usuários Cadastrados ({users.length})</h2>
          </div>

          <div className="divide-y divide-zinc-900">
            {users.map((u) => {
              const isMe = u.id === user.id;
              return (
                <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-zinc-900/30 transition">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{u.username}</span>
                      {u.is_admin === 1 && (
                        <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          ADMIN
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          u.is_active === 1
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-300'
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                        }`}
                      >
                        {u.is_active === 1 ? 'Ativo' : 'Bloqueado'}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-400 mt-1 truncate">
                      {u.email || <span className="text-zinc-600 italic">Sem e-mail cadastrado</span>}
                    </p>

                    <p className="text-[11px] text-zinc-600 mt-0.5">
                      Criado em: {u.created_at ? u.created_at.slice(0, 10) : '-'}
                    </p>
                  </div>

                  {!isMe && (
                    <div className="flex items-center gap-2 pt-2 sm:pt-0 shrink-0">
                      <button
                        onClick={() => toggleStatus(u)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition border ${
                          u.is_active === 1
                            ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
                            : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                        }`}
                      >
                        {u.is_active === 1 ? 'Bloquear' : 'Desbloquear'}
                      </button>

                      <button
                        onClick={() => deleteUser(u)}
                        className="rounded-xl border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition"
                      >
                        Excluir
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

