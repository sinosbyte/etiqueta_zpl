// What the Save dialog offers first (Etapa 2, 27/11/2026). With a design open it is a new version: nothing that was
// saved is lost, and replacing the version is one click away in the tab next to it. Before, it opened on replacing
// the version, so someone who cleared the label to start another one and saved replaced the design without noticing.
export type SaveMode = 'overwrite' | 'version' | 'new';

export function defaultSaveMode(activeDesignId: number | null): SaveMode {
  return activeDesignId !== null ? 'version' : 'new';
}
