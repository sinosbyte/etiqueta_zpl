import React, { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { PageHeader } from './AccountPage';
import { TemporaryPassword } from '../components/TemporaryPassword';
import { useAccountStore } from '../store/useAccountStore';
import { askConfirm } from '../store/useDialogStore';
import { toast } from '../store/useToastStore';
import {
  CompanySummary, Role, UserSummary, createCompany, createUser, listCompanies, listUsers, resetPassword, updateCompany, updateUser,
} from '../utils/accountClient';
import {
  assignableRoles, canManageCompanies, companyNameProblem, isAdmin, lockReason, newUserProblem, roleKey,
} from '../utils/admin';

const card: React.CSSProperties = { background: 'var(--chrome-surface)', border: '1px solid var(--chrome-border)', borderRadius: 8, padding: 16 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 500, color: 'var(--chrome-text-faint)', padding: '6px 8px', borderBottom: '1px solid var(--chrome-border)' };
const td: React.CSSProperties = { fontSize: 13, color: 'var(--chrome-text)', padding: '8px', borderBottom: '1px solid var(--chrome-border)', verticalAlign: 'middle' };
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type Shown = { username: string; password: string } | null;

/** Users of a company (administrators) and companies (Sinosbyte administrators) */
export function AdminPage({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { me, load } = useAccountStore();
  const [tab, setTab] = useState<'users' | 'companies'>('users');
  const [companyId, setCompanyId] = useState<number | undefined>(undefined);
  useEffect(() => { if (!me) void load(); }, [me, load]);

  if (!me) return <div style={{ padding: 24, color: 'var(--chrome-text-faint)' }}>{t('login.wait')}</div>;
  if (!isAdmin(me.role)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
        <PageHeader title={t('admin.title')} onBack={onBack} />
        <p style={{ padding: 24, fontSize: 13, color: 'var(--chrome-text-muted)' }}>{t('admin.notAllowed')}</p>
      </div>
    );
  }
  const platform = canManageCompanies(me.role);
  const tabBtn = (key: 'users' | 'companies', label: string) => (
    <button type="button" onClick={() => setTab(key)} className={tab === key ? 'chrome-btn chrome-btn-primary' : 'chrome-btn chrome-btn-ghost'} style={{ fontSize: 12 }} data-testid={`admin-tab-${key}`}>
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
      <PageHeader title={t('admin.title')} onBack={onBack} />
      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {platform && <div style={{ display: 'flex', gap: 8 }}>{tabBtn('users', t('admin.tab.users'))}{tabBtn('companies', t('admin.tab.companies'))}</div>}
          {tab === 'users' || !platform
            ? <UsersPanel companyId={companyId} setCompanyId={setCompanyId} />
            : <CompaniesPanel onShowUsers={id => { setCompanyId(id); setTab('users'); }} />}
        </div>
      </div>
    </div>
  );
}

export function UsersPanel({ companyId, setCompanyId }: { companyId?: number; setCompanyId(id?: number): void }) {
  const t = useT();
  const me = useAccountStore(s => s.me)!;
  const platform = canManageCompanies(me.role);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<Shown>(null);
  const [form, setForm] = useState({ username: '', email: '', role: 'member' as Role });
  const [formError, setFormError] = useState('');
  const company = companyId ?? me.company.id;
  // The platform company (Fase 06) holds the Sinosbyte administrators; a Sinosbyte admin sees only the administrators of
  // a client company
  const platformCompany = company === me.company.id && !!me.company.isPlatform;
  const roles = assignableRoles(me.role, platformCompany);
  useEffect(() => {
    setForm(f => (roles.includes(f.role) ? f : { ...f, role: roles[0] ?? 'member' }));
  }, [roles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    setLoading(true);
    try { setUsers(await listUsers(platform ? company : undefined)); }
    catch (e) { toast.error(errText(e, t('api.requestFailed'))); }
    finally { setLoading(false); }
  }, [company, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (platform) listCompanies().then(setCompanies).catch(() => undefined); }, [platform]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = newUserProblem(form.username, form.email);
    if (problem) { setFormError(t(problem)); return; }
    setFormError('');
    try {
      const r = await createUser({ username: form.username.trim(), email: form.email.trim(), role: form.role, companyId: platform ? company : undefined });
      setShown({ username: r.user.username, password: r.temporaryPassword });
      setForm({ username: '', email: '', role: roles[0] ?? 'member' });
      await reload();
    } catch (err) { setFormError(errText(err, t('api.requestFailed'))); }
  };

  const change = async (u: UserSummary, changes: { role?: Role; active?: boolean }) => {
    if (changes.active === false) {
      const ok = await askConfirm({ title: t('admin.deactivateTitle'), message: t('admin.deactivateConfirm', { name: u.username }), confirmLabel: t('admin.deactivate'), danger: true });
      if (!ok) return;
    }
    try {
      await updateUser(u.id, changes);
      toast.success(t('admin.saved', { name: u.username }));
      await reload();
    } catch (err) { toast.error(errText(err, t('api.requestFailed'))); await reload(); }
  };

  const reset = async (u: UserSummary) => {
    const ok = await askConfirm({ title: t('admin.resetTitle'), message: t('admin.resetConfirm', { name: u.username }), confirmLabel: t('admin.reset') });
    if (!ok) return;
    try {
      const r = await resetPassword(u.id);
      setShown({ username: u.username, password: r.temporaryPassword });
      await reload();
    } catch (err) { toast.error(errText(err, t('api.requestFailed'))); }
  };

  return (
    <>
      <div style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--chrome-text-muted)', flex: 1, minWidth: 240 }}>{t('admin.usersIntro')}</span>
        {platform && (
          <label style={{ fontSize: 12, color: 'var(--chrome-text-faint)', display: 'flex', gap: 6, alignItems: 'center' }}>
            {t('admin.company')}
            <select className="chrome-input" value={company} onChange={e => setCompanyId(Number(e.target.value))} data-testid="admin-company-select">
              {me.company.isPlatform && <option value={me.company.id}>{t('admin.platformCompany')}</option>}
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ` (${t('admin.inactive')})`}</option>)}
            </select>
          </label>
        )}
        {platform && !platformCompany && (
          <span style={{ width: '100%', fontSize: 12, color: 'var(--chrome-text-faint)' }} data-testid="admin-platform-scope">{t('admin.platformScopeNote')}</span>
        )}
      </div>

      {shown && <TemporaryPassword username={shown.username} password={shown.password} onClose={() => setShown(null)} />}

      <form onSubmit={create} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} data-testid="new-user">
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 }}>{t('admin.username')}</label>
          <input className="chrome-input" style={{ width: '100%' }} value={form.username} maxLength={50} onChange={e => setForm({ ...form, username: e.target.value })} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 }}>{t('admin.email')}</label>
          <input className="chrome-input" style={{ width: '100%' }} type="email" value={form.email} maxLength={254} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 }}>{t('admin.roleLabel')}</label>
          <select className="chrome-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
            {roles.map(r => <option key={r} value={r}>{t(roleKey(r))}</option>)}
          </select>
        </div>
        <button type="submit" className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }}>{t('admin.create')}</button>
        {formError && <div role="alert" style={{ width: '100%', fontSize: 12, color: 'var(--status-error)' }}>{formError}</div>}
      </form>

      <div style={card}>
        {loading ? <span style={{ fontSize: 13, color: 'var(--chrome-text-faint)' }}>{t('login.wait')}</span> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="users-table">
            <thead>
              <tr>
                <th style={th}>{t('admin.username')}</th><th style={th}>{t('admin.email')}</th><th style={th}>{t('admin.roleLabel')}</th>
                <th style={th}>{t('admin.status')}</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const lock = lockReason(me, u);
                return (
                  <tr key={u.id} data-testid={`user-row-${u.username}`} style={{ opacity: u.active ? 1 : 0.6 }}>
                    <td style={td}>
                      {u.username}
                      {u.id === me.userId && <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}> ({t('admin.you')})</span>}
                    </td>
                    <td style={td}>{u.email ?? '—'}</td>
                    <td style={td}>
                      {lock || roles.length < 2 || !roles.includes(u.role)
                        ? t(roleKey(u.role))
                        : (
                          <select className="chrome-input" value={u.role} onChange={e => void change(u, { role: e.target.value as Role })} aria-label={t('admin.roleLabel')}>
                            {roles.map(r => <option key={r} value={r}>{t(roleKey(r))}</option>)}
                          </select>
                        )}
                    </td>
                    <td style={td}>
                      {u.active ? t('admin.active') : t('admin.inactive')}
                      {u.mustChangePassword && <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}> · {t('admin.pendingPassword')}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} title={lock ? t(lock) : undefined}>
                      {!lock && (
                        <>
                          <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }} onClick={() => void reset(u)}>{t('admin.reset')}</button>
                          {u.active
                            ? <button type="button" className="chrome-btn chrome-btn-danger" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => void change(u, { active: false })}>{t('admin.deactivate')}</button>
                            : <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => void change(u, { active: true })}>{t('admin.activate')}</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function CompaniesPanel({ onShowUsers }: { onShowUsers(id: number): void }) {
  const t = useT();
  const me = useAccountStore(s => s.me)!;
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [shown, setShown] = useState<Shown>(null);
  const [form, setForm] = useState({ name: '', username: '', email: '' });
  const [formError, setFormError] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const reload = useCallback(async () => {
    try { setCompanies(await listCompanies()); } catch (e) { toast.error(errText(e, t('api.requestFailed'))); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = companyNameProblem(form.name) ?? newUserProblem(form.username, form.email);
    if (problem) { setFormError(t(problem)); return; }
    setFormError('');
    try {
      const r = await createCompany({ name: form.name.trim(), admin: { username: form.username.trim(), email: form.email.trim() } });
      setShown({ username: r.user.username, password: r.temporaryPassword });
      setForm({ name: '', username: '', email: '' });
      await reload();
    } catch (err) { setFormError(errText(err, t('api.requestFailed'))); }
  };

  const change = async (c: CompanySummary, changes: { name?: string; active?: boolean }) => {
    if (changes.active === false) {
      const ok = await askConfirm({ title: t('admin.companyDeactivateTitle'), message: t('admin.companyDeactivateConfirm', { name: c.name }), confirmLabel: t('admin.deactivate'), danger: true });
      if (!ok) return;
    }
    try {
      await updateCompany(c.id, changes);
      toast.success(t('admin.saved', { name: changes.name ?? c.name }));
      setRenaming(null);
      await reload();
    } catch (err) { toast.error(errText(err, t('api.requestFailed'))); }
  };

  const label: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 };
  return (
    <>
      {shown && <TemporaryPassword username={shown.username} password={shown.password} onClose={() => setShown(null)} />}
      <form onSubmit={create} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} data-testid="new-company">
        <div style={{ flex: 1, minWidth: 180 }}><label style={label}>{t('admin.companyName')}</label>
          <input className="chrome-input" style={{ width: '100%' }} value={form.name} maxLength={100} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 150 }}><label style={label}>{t('admin.firstAdmin')}</label>
          <input className="chrome-input" style={{ width: '100%' }} value={form.username} maxLength={50} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 190 }}><label style={label}>{t('admin.email')}</label>
          <input className="chrome-input" style={{ width: '100%' }} type="email" value={form.email} maxLength={254} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <button type="submit" className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }}>{t('admin.createCompany')}</button>
        {formError && <div role="alert" style={{ width: '100%', fontSize: 12, color: 'var(--status-error)' }}>{formError}</div>}
      </form>
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="companies-table">
          <thead><tr>
            <th style={th}>{t('admin.companyName')}</th><th style={th}>{t('admin.usersCount')}</th><th style={th}>{t('admin.designsCount')}</th>
            <th style={th}>{t('admin.status')}</th><th style={th} />
          </tr></thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.id} data-testid={`company-row-${c.name}`} style={{ opacity: c.active ? 1 : 0.6 }}>
                <td style={td}>
                  {renaming?.id === c.id ? (
                    <form onSubmit={e => { e.preventDefault(); void change(c, { name: renaming.name.trim() }); }} style={{ display: 'flex', gap: 6 }}>
                      <input className="chrome-input" value={renaming.name} maxLength={100} autoFocus onChange={e => setRenaming({ id: c.id, name: e.target.value })} />
                      <button type="submit" className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} disabled={!!companyNameProblem(renaming.name)}>{t('admin.save')}</button>
                      <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }} onClick={() => setRenaming(null)}>{t('common.cancel')}</button>
                    </form>
                  ) : <>{c.name}{c.id === me.company.id && <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}> ({t('admin.yours')})</span>}</>}
                </td>
                <td style={td}>{c.userCount}</td>
                <td style={td}>{c.designCount}</td>
                <td style={td}>{c.active ? t('admin.active') : t('admin.inactive')}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }} onClick={() => onShowUsers(c.id)}>{t('admin.showUsers')}</button>
                  <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => setRenaming({ id: c.id, name: c.name })}>{t('admin.rename')}</button>
                  {c.id !== me.company.id && (c.active
                    ? <button type="button" className="chrome-btn chrome-btn-danger" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => void change(c, { active: false })}>{t('admin.deactivate')}</button>
                    : <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12, marginLeft: 6 }} onClick={() => void change(c, { active: true })}>{t('admin.activate')}</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
