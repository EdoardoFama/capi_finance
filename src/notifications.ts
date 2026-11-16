import { formatBRL } from './format';
import type { DashboardCategory, Reminder } from './api';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const res = await Notification.requestPermission();
    return res === 'granted';
  }
  return false;
}

export function sendLocalNotification(title: string, options?: NotificationOptions) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      icon: '/logo.png',
      badge: '/logo.png',
      ...options,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (err) {
    console.error('Erro ao disparar notificação:', err);
  }
}

/** Agenda notificações no navegador para lembretes de hoje que ainda não venceram */
const scheduledTimers = new Map<number, number>();
let eveningTimerId: number | null = null;

export function scheduleRemindersNotifications(reminders: Reminder[]) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Limpa agendamentos anteriores
  scheduledTimers.forEach((timerId) => window.clearTimeout(timerId));
  scheduledTimers.clear();

  reminders.forEach((r) => {
    if (r.is_completed || !r.notify) return;
    if (r.date !== todayStr) return;

    // Se tem horário definido (ex: "09:30")
    if (r.time && /^\d{2}:\d{2}$/.test(r.time)) {
      const [h, m] = r.time.split(':').map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);

      const delay = target.getTime() - Date.now();
      if (delay > 0) {
        const timerId = window.setTimeout(() => {
          sendLocalNotification(`⏰ Lembrete: ${r.title}`, {
            body: `${r.amount_cents ? formatBRL(r.amount_cents) + ' • ' : ''}Horário: ${r.time} • Capi Finance`,
            tag: `reminder-${r.id}`,
          });
        }, delay);
        scheduledTimers.set(r.id, timerId);
      }
    }
  });

  scheduleEveningReminder();
}

/** Item 99: Lembrete Noturno às 21:00 ("Já conferiu seus gastos de hoje?") */
export function scheduleEveningReminder() {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    if (localStorage.getItem('capi:evening_reminder') === '0') return;
    if (eveningTimerId) window.clearTimeout(eveningTimerId);

    const target = new Date();
    target.setHours(21, 0, 0, 0);
    const delay = target.getTime() - Date.now();
    if (delay > 0 && delay < 18 * 3600 * 1000) {
      eveningTimerId = window.setTimeout(() => {
        sendLocalNotification('🌙 Fechamento do Dia — Capi Finance', {
          body: 'Já conferiu ou lançou seus gastos de hoje? Mantenha seu orçamento em dia!',
          tag: 'evening-reminder',
        });
      }, delay);
    }
  } catch {}
}

/** Item 25: Alerta Push quando Categoria atingir 80% ou 100% do Teto */
export function notifyCeilingAlerts(categories: DashboardCategory[], month: string) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    categories.forEach((c) => {
      if (c.budget_cents <= 0 || c.is_checked) return;
      const pct = Math.round((c.spent_cents / c.budget_cents) * 100);
      if (pct >= 100) {
        const key = `capi:notified_100:${month}:${c.id}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          sendLocalNotification(`🚨 Teto Estourado: ${c.name}`, {
            body: `A categoria ${c.name} atingiu ${pct}% da meta (${formatBRL(c.spent_cents)} / ${formatBRL(c.budget_cents)}).`,
            tag: key,
          });
        }
      } else if (pct >= 80) {
        const key = `capi:notified_80:${month}:${c.id}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          sendLocalNotification(`⚠️ Atenção ao Teto: ${c.name} (${pct}%)`, {
            body: `Você já consumiu ${formatBRL(c.spent_cents)} de ${formatBRL(c.budget_cents)}. Resta ${formatBRL(c.budget_cents - c.spent_cents)}.`,
            tag: key,
          });
        }
      }
    });
  } catch {}
}

/** Item 33: Gera link direto para adicionar lembrete ao Google Calendar */
export function buildGoogleCalendarUrl(r: Reminder): string {
  const cleanDate = r.date.replace(/-/g, '');
  let datesParam = `${cleanDate}/${cleanDate}`;
  if (r.time && /^\d{2}:\d{2}$/.test(r.time)) {
    const [hh, mm] = r.time.split(':');
    const endH = String(Math.min(23, Number(hh) + 1)).padStart(2, '0');
    datesParam = `${cleanDate}T${hh}${mm}00/${cleanDate}T${endH}${mm}00`;
  }
  const title = `Capi Finance: ${r.title}${r.amount_cents ? ` (${formatBRL(r.amount_cents)})` : ''}`;
  const details = `Lembrete financeiro agendado no Capi Finance.${r.category_name ? `\nCategoria: ${r.category_name}` : ''}${r.amount_cents ? `\nValor previsto: ${formatBRL(r.amount_cents)}` : ''}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
