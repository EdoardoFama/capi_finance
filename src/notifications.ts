import { formatBRL } from './format';
import type { Reminder } from './api';

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
}
