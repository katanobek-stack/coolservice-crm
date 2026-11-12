import * as XLSX from 'xlsx';
import type { ProcurementOrderDraft } from '../../shared/types/procurement';
import { calculateProcurement, parseDecimal, safeSupplierUrl } from './procurementLogic';

export function buildProcurementWorkbook(order: ProcurementOrderDraft) {
  const result = calculateProcurement(order.lines, order);
  const money = (minor: number | null) => minor === null ? 'Не указано' : minor / 100;
  const number = (value: string, scale: number) => { const n = parseDecimal(value, scale); return n === null ? 'Не указано' : n / scale; };
  const rows: (string | number | null)[][] = [
    [order.name],
    ['№', 'Ссылка на товар', 'Фото', 'Наименование / модификация', 'Количество', 'Цена за единицу, ¥', 'Товары, ¥', 'Доставка по Китаю, ¥', 'Примечание'],
    ...order.lines.map((line, index) => [index + 1, safeSupplierUrl(line.supplierUrl) ?? '', '', `${line.name}${line.variant && line.variant !== line.name ? ' · ' + line.variant : ''}`, number(line.quantity, 1000), number(line.unitPrice, 100), money(result.lines[index].productsFen), number(line.chinaDelivery, 100), 'Модификацию выбирать по описанию']),
    [], ['Стоимость товаров, ¥', money(result.productsFen)], ['Доставка по Китаю, ¥', money(result.chinaFen)],
    ['Комиссия посредника, %', number(order.commission, 100)], ['Комиссия посредника, ¥', money(result.commissionFen)], ['Итого посреднику, ¥', money(result.totalFen)],
  ];
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [6, 48, 14, 55, 12, 19, 16, 24, 40].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: `A2:I${order.lines.length + 2}` };
  order.lines.forEach((line, index) => { const cell = sheet[`B${index + 3}`], url = safeSupplierUrl(line.supplierUrl); if (cell && url) cell.l = { Target: url, Tooltip: 'Открыть товар' }; });
  XLSX.utils.book_append_sheet(workbook, sheet, 'Заказ посреднику');
  const costing = XLSX.utils.aoa_to_sheet([
    ['Курс, ₽/¥', number(order.exchange, 10000), 'Тариф доставки, ₽/кг', number(order.freightRate, 100)],
    ['Товар', 'Заказано', 'Получено', 'Общий вес, кг', 'Доставка к нам, ₽', 'Доля комиссии, ¥', 'Себестоимость, ₽/ед.', 'Состояние'],
    ...order.lines.map((line, index) => [line.name, number(line.quantity, 1000), number(line.receivedQuantity, 1000), number(line.weightKg, 1000), money(result.lines[index].freightCents), money(result.lines[index].commissionFen), money(result.lines[index].unitCostCents), result.lines[index].receiptMismatch ? 'Количество не совпадает: требуется сверка' : result.lines[index].unitCostCents === null ? 'Неполные данные' : 'Расчёт; приёмка на склад оформляется отдельно']),
  ]);
  costing['!cols'] = [50, 12, 12, 18, 22, 20, 25, 58].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, costing, 'Себестоимость');
  return workbook;
}

export function exportProcurementOrder(order: ProcurementOrderDraft) {
  const file = order.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'Закуп';
  XLSX.writeFile(buildProcurementWorkbook(order), file + '.xlsx');
}
