// Categories of the ready-made templates, the same keys as backend/src/templates/categories.ts.
// The names shown are in the i18n files (templates.cat.<key>).
export const TEMPLATE_CATEGORIES = [
  'picking', 'recebimento', 'expedicao', 'materiais', 'estoque', 'producao', 'patrimonio', 'outros',
] as const;

export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

/** What the tabs filter by: every template, or one category. */
export type CategoryFilter = 'all' | TemplateCategory;
