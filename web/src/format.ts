import { Period } from '../../src/analytics/analytics';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** "Hoje, 13:51" · "Ontem, 09:15" · "qui, 12 nov · 08:46" */
export function friendlyTime(time: string): string {
  const date = time.slice(0, 10);
  const hm = time.slice(11, 16);
  const today = localToday();
  if (date === today) return `Hoje, ${hm}`;
  if (date === addDays(today, -1)) return `Ontem, ${hm}`;
  const [y, m, d] = date.split('-').map(Number);
  const wd = DIA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MES[m - 1]}${y !== +today.slice(0, 4) ? ' ' + y : ''} · ${hm}`;
}

export function dayHeading(date: string): string {
  const today = localToday();
  if (date === today) return 'Hoje';
  if (date === addDays(today, -1)) return 'Ontem';
  const [y, m, d] = date.split('-').map(Number);
  return `${DIA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MES[m - 1]} ${y}`;
}

export function shortDate(ms: number): string {
  const [, m, d] = new Date(ms).toISOString().slice(0, 10).split('-').map(Number);
  return `${d} ${MES[m - 1]}`;
}

export function groupLabel(key: string, p: Period): string {
  if (p === 'year') return key;
  if (p === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${MES[m - 1]} ${y}`;
  }
  const [y, m, d] = key.split('-').map(Number);
  return p === 'week' ? `sem. ${d} ${MES[m - 1]}` : `${d} ${MES[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
}
