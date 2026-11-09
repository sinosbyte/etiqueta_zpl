import { apiGetTemplate, TemplateDetail, TemplateSummary } from './templatesClient';

// Templates already fetched, shared by the card thumbnails, the hover preview and the
// preview window. A replaced template has a new updatedAt, so it is fetched again.
const loaded = new Map<string, TemplateDetail>();
const pending = new Map<string, Promise<TemplateDetail>>();

const keyOf = (t: TemplateSummary) => `${t.id}:${t.updatedAt}`;

/** The template's detail when it was already fetched, otherwise undefined. */
export const cachedTemplate = (t: TemplateSummary): TemplateDetail | undefined => loaded.get(keyOf(t));

/** Fetches the template's detail once, however many places ask for it at the same time. */
export function loadTemplate(t: TemplateSummary): Promise<TemplateDetail> {
  const key = keyOf(t);
  const hit = loaded.get(key);
  if (hit) return Promise.resolve(hit);
  let request = pending.get(key);
  if (!request) {
    request = apiGetTemplate(t.id)
      .then(detail => { loaded.set(key, detail); return detail; })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}
