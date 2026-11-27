import React, { useEffect, useState } from 'react';
import { requestLogout } from '../utils/logout';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { useAccountStore } from '../store/useAccountStore';
import { canManageCompanies } from '../utils/admin';
import { navigate } from '../utils/navigation';
import { UsersPanel, CompaniesPanel } from './AdminPage';
import { TemplatesPage } from './TemplatesPage';

export type PlatformTab = 'companies' | 'users' | 'templates';

/**
 * The console of the Sinosbyte administrators (Fase 06, etapa 3): where they land after the login. Companies, the
 * Sinosbyte administrators and the administrators of each client, and the templates (edited in the label editor).
 * They have no designs: the editor opens only on a template.
 */
export function PlatformPage({ initialTab = 'companies' }: { initialTab?: PlatformTab }) {
  const t = useT();
  const { me, load } = useAccountStore();
  const [tab, setTab] = useState<PlatformTab>(initialTab);
  const [companyId, setCompanyId] = useState<number | undefined>(undefined);
  useEffect(() => { if (!me) void load(); }, [me, load]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const header = (
    <div style={{ height: 44, background: 'var(--chrome-surface)', borderBottom: '1px solid var(--chrome-border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)' }}>{t('platform.title')}</span>
      <div style={{ flex: 1 }} />
      <LanguageSelect />
      {me && (
        <button type="button" onClick={() => navigate('account')} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }} data-testid="platform-account">
          {me.username}
        </button>
      )}
      <button type="button" onClick={() => void requestLogout()} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }}>{t('toolbar.logout')}</button>
    </div>
  );

  if (!me) return <div style={{ padding: 24, color: 'var(--chrome-text-faint)' }}>{t('login.wait')}</div>;
  if (!canManageCompanies(me.role)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
        {header}
        <p style={{ padding: 24, fontSize: 13, color: 'var(--chrome-text-muted)' }}>{t('platform.notAllowed')}</p>
      </div>
    );
  }

  const tabBtn = (key: PlatformTab, label: string) => (
    <button type="button" onClick={() => setTab(key)} className={tab === key ? 'chrome-btn chrome-btn-primary' : 'chrome-btn chrome-btn-ghost'} style={{ fontSize: 12 }} data-testid={`platform-tab-${key}`}>
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }} data-testid="platform-console">
      {header}
      <div style={{ padding: '16px 24px 0', display: 'flex', gap: 8, flexShrink: 0 }}>
        {tabBtn('companies', t('admin.tab.companies'))}
        {tabBtn('users', t('admin.tab.users'))}
        {tabBtn('templates', t('sidebar.templates'))}
      </div>
      {tab === 'templates'
        ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><TemplatesPage onBack={() => undefined} embedded /></div>
        : (
          <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {tab === 'users'
                ? <UsersPanel companyId={companyId} setCompanyId={setCompanyId} />
                : <CompaniesPanel onShowUsers={id => { setCompanyId(id); setTab('users'); }} />}
            </div>
          </div>
        )}
    </div>
  );
}
