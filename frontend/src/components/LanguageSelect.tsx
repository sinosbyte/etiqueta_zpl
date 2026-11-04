import React from 'react';
import { LANGUAGES, Lang, useLangStore, useT } from '../i18n';

/** Interface language picker (Português / English). */
export function LanguageSelect({ style }: { style?: React.CSSProperties }) {
  const t = useT();
  const { lang, setLang } = useLangStore();
  return (
    <select
      className="chrome-input"
      value={lang}
      onChange={e => setLang(e.target.value as Lang)}
      title={t('toolbar.language')}
      style={{ width: 92, padding: '2px 4px', ...style }}
    >
      {LANGUAGES.map(l => <option key={l.lang} value={l.lang}>{l.label}</option>)}
    </select>
  );
}
