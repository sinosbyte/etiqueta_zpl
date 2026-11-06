// Categories of the ready-made templates. The key is what is stored; the names
// shown are translated by the frontend. "outros" is the default.
export const TEMPLATE_CATEGORIES = [
  'picking', 'recebimento', 'expedicao', 'materiais', 'estoque', 'producao', 'patrimonio', 'outros',
] as const;

export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

export const DEFAULT_TEMPLATE_CATEGORY: TemplateCategory = 'outros';
