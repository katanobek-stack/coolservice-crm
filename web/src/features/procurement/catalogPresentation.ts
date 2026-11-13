export type CatalogLayout = 'cards' | 'compact' | 'list';
export type CatalogPageSize = 20 | 50 | 100;
export interface CatalogPresentation { layout: CatalogLayout; pageSize: CatalogPageSize }
export const catalogPresentationKey = 'crm-procurement-presentation';
export function parseCatalogPresentation(raw: string | null): CatalogPresentation {
  const defaults: CatalogPresentation = { layout: 'list', pageSize: 50 };
  try {
    if (!raw) return defaults;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return defaults;
    return { layout: ['cards', 'compact', 'list'].includes(value.layout) ? value.layout : defaults.layout, pageSize: [20, 50, 100].includes(value.pageSize) ? value.pageSize : defaults.pageSize };
  } catch { return defaults; }
}
export function readCatalogPresentation(): CatalogPresentation {
  try { return parseCatalogPresentation(typeof window === 'undefined' ? null : window.localStorage.getItem(catalogPresentationKey)); }
  catch { return parseCatalogPresentation(null); }
}
