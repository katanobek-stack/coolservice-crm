import type { ServiceController, ServiceControllerLog, ServiceCommandStatus, ServiceControllerCommand, ServiceLogLevel } from '../../shared/types/serviceMonitor';
import type { SourceStatus } from '../../shared/context/dataReadiness';
import { isServiceControllerOnline } from '../../shared/serviceMonitorStatus';

export type ServiceState = 'online' | 'offline' | 'unknown' | 'disabled';
export const SERVICE_STATE_LABELS: Record<ServiceState, string> = { online: 'На связи', offline: 'Нет связи', unknown: 'Нет контакта', disabled: 'Отключён' };
export const COMMAND_STATUS_LABELS: Record<ServiceCommandStatus, string> = { queued: 'В очереди', claimed: 'В обработке', dispatched: 'Ожидает ответа', completed: 'Выполнена', failed: 'Ошибка выполнения', unknown: 'Неизвестный статус' };
export const COMMAND_LABELS: Record<ServiceControllerCommand, { title: string; description: string }> = {
  'SERVICE PING': { title: 'Проверить связь', description: 'Запросить отклик контроллера.' },
  'SERVICE STATUS': { title: 'Запросить состояние', description: 'Получить текущую диагностику.' },
  'SERVICE INFO': { title: 'Сведения об устройстве', description: 'Запросить сведения о системе и прошивке.' },
};
export function serviceContact(controller: ServiceController): Date | null {
  return [controller.lastHeartbeatAt, controller.lastStatusAt].filter((d): d is Date => d instanceof Date && Number.isFinite(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}
export function serviceHealth(controller: ServiceController, nowMs: number): { state: ServiceState; attention: boolean; issues: string[]; explanation: string } {
  if (!controller.enabled) return { state: 'disabled', attention: false, issues: [], explanation: 'Контроллер отключён в реестре. Диагностические запросы недоступны.' };
  const online = isServiceControllerOnline(controller.enabled, controller.lastHeartbeatAt, nowMs, controller.connectionState, controller.lastStatusAt);
  const state: ServiceState = online ? 'online' : serviceContact(controller) ? 'offline' : 'unknown';
  const issues: string[] = [];
  if (state === 'offline') issues.push('Нет свежего подтверждения связи');
  if (state === 'unknown') issues.push('Контроллер ещё не выходил на связь');
  if (online && controller.simSignal !== null && controller.simSignal < 10) issues.push('Слабый сигнал SIM');
  if (online && controller.gprsConnected === false) issues.push('Нет подключения GPRS');
  if (online && controller.uartConnected === false) issues.push('Нет связи UART');
  return { state, attention: issues.length > 0, issues, explanation: online ? 'Есть свежий heartbeat или MQTT-статус за последние 5 минут.' : state === 'unknown' ? 'Данные о контакте ещё не поступали.' : 'Связь не подтверждена свежими данными или получен MQTT-статус «оффлайн».' };
}
export interface ServiceFilters { search: string; state: ServiceState | 'all'; attention: boolean; sort: 'attention' | 'name' | 'recent' }
export function selectServiceControllers(controllers: ServiceController[], filters: ServiceFilters, nowMs: number): ServiceController[] {
  const words = filters.search.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  return controllers.filter(c => {
    const health = serviceHealth(c, nowMs);
    const searchable = `${c.name} ${c.objectName} ${c.deviceId} ${c.id} ${c.firmwareVersion ?? ''}`.toLocaleLowerCase('ru').replace(/ё/g, 'е');
    return words.every(w => searchable.includes(w)) && (filters.state === 'all' || health.state === filters.state) && (!filters.attention || health.attention);
  }).sort((a, b) => {
    const name = a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
    if (filters.sort === 'recent') return (serviceContact(b)?.getTime() ?? 0) - (serviceContact(a)?.getTime() ?? 0) || name;
    if (filters.sort === 'attention') return Number(serviceHealth(b, nowMs).attention) - Number(serviceHealth(a, nowMs).attention) || name;
    return name;
  });
}
export function serviceSummary(controllers: ServiceController[], nowMs: number) {
  const health = controllers.map(c => serviceHealth(c, nowMs));
  return { total: controllers.length, online: health.filter(h => h.state === 'online').length, attention: health.filter(h => h.attention).length, disabled: health.filter(h => h.state === 'disabled').length };
}
export const serviceCanCommand = (role: string, controller: ServiceController) => ['owner', 'admin', 'manager'].includes(role) && controller.enabled;
export function serviceDateTime(date: Date | null): string {
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { timeZone: 'Asia/Vladivostok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Нет данных';
}
export function serviceRelative(date: Date | null, nowMs: number): string {
  if (!date || !Number.isFinite(date.getTime())) return 'Нет данных';
  const seconds = Math.floor((nowMs - date.getTime()) / 1000);
  if (seconds < -60) return 'Время опережает сервер';
  if (seconds < 30) return 'Только что';
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} мин. назад` : minutes < 1440 ? `${Math.floor(minutes / 60)} ч. назад` : `${Math.floor(minutes / 1440)} дн. назад`;
}
export function serviceBytes(value: number | null): string {
  return value === null ? 'Нет данных' : value < 1024 ? `${value} Б` : value < 1048576 ? `${(value / 1024).toFixed(1)} КБ` : `${(value / 1048576).toFixed(1)} МБ`;
}
export function serviceUptime(value: number | null): string {
  return value === null ? 'Нет данных' : `${Math.floor(value / 86400) ? `${Math.floor(value / 86400)} д ` : ''}${Math.floor(value % 86400 / 3600)} ч ${Math.floor(value % 3600 / 60)} мин`;
}
export function filterServiceLogs(logs: ServiceControllerLog[], level: ServiceLogLevel | 'ALL', search: string): ServiceControllerLog[] {
  const words = search.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
  return logs.filter(l => (level === 'ALL' || l.level === level) && words.every(w => l.message.toLocaleLowerCase('ru').includes(w)));
}
export function serviceLogText(controller: ServiceController, logs: ServiceControllerLog[]): string {
  return [`Сервисный монитор · ${controller.name} · ${controller.deviceId}`, 'Время получения · Владивосток (UTC+10) · Только отображаемые строки', ...logs.map(l => `${serviceDateTime(l.receivedAt ?? l.reportedAt)} [${l.level}] ${l.message}`)].join('\n');
}
export interface ServiceFeed<T> { controllerId: string | null; status: SourceStatus; data: T[]; error: string }
export function scopedServiceFeed<T>(feed: ServiceFeed<T>, id: string): ServiceFeed<T> {
  return feed.controllerId !== id ? { controllerId: id, status: 'loading', data: [], error: '' } : feed.status !== 'ready' ? { ...feed, data: [] } : feed;
}
