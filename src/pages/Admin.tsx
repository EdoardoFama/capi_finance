import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser, type AdminSecuritySummary } from '../api';
import { useAuth, useToast, useConfirm } from '../context';
import { Card, CollapseButton, PageTitle, Spinner, useCollapsible } from '../components/ui';

function eventBadge(eventType: string) {
  if (eventType.includes('FAILED') || eventType.includes('DESTROYED') || eventType.includes('BLOCKED')) {
    return {
      label: eventType,
      cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    };
  }
  if (eventType.includes('SUCCESS') || eventType === 'PASSWORD_CHANGED') {
    return {
      label: eventType,
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    };
  }
  return {
    label: eventType,
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  };
}

export default function Admin() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [security, setSecurity] = useState<AdminSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const usersCollapse = useCollapsible('admin_users', true);
  const logsCollapse = useCollapsible('admin_security_logs', true);

  const load = useCallback(async () => {
    try {
      const [userList, secData] = await Promise.all([
        api<AdminUser[]>('/admin/users'),
        api<AdminSecuritySummary>('/admin/security-logs').catch(() => null),
      ]);
      setUsers(userList);
      if (secData) setSecurity(secData);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Painel de Administração & Segurança"
          subtitle="Gerenciamento de contas, auditoria de acessos e proteção contra ataques"
        />
        <button
          onClick={load}
          className="rounded-xl border border-white/[0.1] bg-zinc-900 px-3.5 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-800 transition"
        >
          Atualizar Dados
        </button>
      </div>

      {/* Resumo da Blindagem de Segurança */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="!p-3.5 border-emerald-500/25 bg-emerald-950/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Status do Servidor</p>
          <p className="mt-1 text-base sm:text-lg font-extrabold text-white">Blindado</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">AES-256-GCM + PBKDF2</p>
        </Card>
        <Card className="!p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Usuários Totais</p>
          <p className="mt-1 text-base sm:text-lg font-extrabold text-white tabular-nums">{users?.length ?? 0}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Isolamento Anti-IDOR</p>
        </Card>
        <Card className="!p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sessões Ativas</p>
          <p className="mt-1 text-base sm:text-lg font-extrabold text-emerald-400 tabular-nums">
            {security?.active_sessions_count ?? '-'}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Cookie HttpOnly + SHA-256</p>
        </Card>
        <Card className="!p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Bloqueios Rate-Limit</p>
          <p className="mt-1 text-base sm:text-lg font-extrabold text-amber-400 tabular-nums">
            {security?.active_blocks_count ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Anti-DDoS & Brute-Force</p>
        </Card>
      </div>

      {loading || !users ? (
        <Spinner />
      ) : (
        <>
          {/* Lista de Usuários */}
          <Card className="!p-0 overflow-hidden">
            <div
              onClick={usersCollapse.toggle}
              className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-900 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-2.5">
                <CollapseButton isOpen={usersCollapse.isOpen} onToggle={usersCollapse.toggle} />
                <h2 className="font-bold text-sm text-white group-hover:text-emerald-300 transition">
                  Usuários Cadastrados ({users.length})
                </h2>
              </div>
            </div>

            {usersCollapse.isOpen && (
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
            )}
          </Card>

          {/* Logs de Auditoria de Segurança */}
          <Card className="!p-0 overflow-hidden">
            <div
              onClick={logsCollapse.toggle}
              className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-900 cursor-pointer select-none group"
            >
              <div className="flex items-center gap-2.5">
                <CollapseButton isOpen={logsCollapse.isOpen} onToggle={logsCollapse.toggle} />
                <div>
                  <h2 className="font-bold text-sm text-white group-hover:text-emerald-300 transition">
                    Auditoria de Eventos de Segurança ({security?.logs.length ?? 0})
                  </h2>
                  <p className="text-[11px] text-zinc-500">
                    Rastreamento de logins, tentativas de força bruta, códigos OTP e ações administrativas
                  </p>
                </div>
              </div>
            </div>

            {logsCollapse.isOpen && (
              <div className="max-h-96 overflow-y-auto divide-y divide-zinc-900/80">
                {!security || security.logs.length === 0 ? (
                  <p className="p-6 text-center text-xs text-zinc-500">
                    Nenhum evento de segurança registrado ainda.
                  </p>
                ) : (
                  security.logs.map((log) => {
                    const badge = eventBadge(log.event_type);
                    return (
                      <div key={log.id} className="p-3.5 hover:bg-zinc-900/30 transition text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                              {badge.label}
                            </span>
                            {log.username && (
                              <span className="font-semibold text-zinc-200">@{log.username}</span>
                            )}
                          </div>
                          <span className="text-[11px] text-zinc-500 tabular-nums">
                            {log.created_at} • IP: {log.ip_address || 'local'}
                          </span>
                        </div>
                        <p className="text-zinc-300">{log.details}</p>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
