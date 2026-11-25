import React, { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { TabSwitcher } from './components/TabSwitcher';
import { CodeEditor } from './components/CodeEditor';
import { SaveDesignModal } from './components/SaveDesignModal';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { Toasts } from './components/Toasts';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TestDataPanel } from './components/TestDataPanel';
import { useDesignerStore } from './store/useDesignerStore';
import { usePanelStore } from './store/usePanelStore';
import { useAuthStore } from './store/useAuthStore';
import { useDesignsStore } from './store/useDesignsStore';
import { useWarnBeforeUnload } from './hooks/useUnsavedChanges';
import { LoginPage } from './pages/LoginPage';
import { MyDesignsPage } from './pages/MyDesignsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TokensPage } from './pages/TokensPage';
import { HelpPage } from './pages/HelpPage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage, ChangePasswordPage } from './pages/AccountPage';
import { PlatformPage } from './pages/PlatformPage';
import { useTemplateEditStore } from './store/useTemplateEditStore';
import { useAccountStore } from './store/useAccountStore';
import { TutorialDialog } from './components/TutorialDialog';
import { useTutorialStore, shouldAutoOpen, tutorialSeen } from './store/useTutorialStore';
import { navigate, redirect, useView } from './utils/navigation';

export default function App() {
  const activeTab = useDesignerStore(s => s.activeTab);
  // The Test data environment can take the whole editor area: the canvas keeps its state, it is only hidden
  const maximized = usePanelStore(s => s.maximized);
  const { token } = useAuthStore();
  const { showSaveModal } = useDesignsStore();
  const currentView = useView();
  const { me, mustChangePassword, load: loadAccount, clear: clearAccount } = useAccountStore();
  // The Sinosbyte administrators live in their console (Fase 06, etapa 3); the editor is theirs only for a template
  const platform = me?.role === 'platform_admin';
  const editingTemplate = useTemplateEditStore(s => s.active);
  const goEditor = () => navigate(platform ? 'platform' : 'designer');
  useWarnBeforeUnload();
  const openTutorial = useTutorialStore(s => s.openFirstTime);

  // Screens someone may not stay on send them where they belong (without a history entry)
  useEffect(() => {
    if (!token || !me) return;
    if (platform) {
      if ((currentView === 'designer' && !editingTemplate) || currentView === 'my-designs' || currentView === 'tokens') redirect('platform');
    } else if (currentView === 'platform') {
      redirect('designer');
    }
  }, [token, me, platform, currentView, editingTemplate]);
  useEffect(() => { if (!token) useTemplateEditStore.getState().stop(); }, [token]);

  // Who is signed in (role, company, temporary password): read after the login and when the page opens with a session
  useEffect(() => {
    if (token && !me) void loadAccount();
    if (!token) clearAccount();
  }, [token, me, loadAccount, clearAccount]);

  // First access: the tutorial opens by itself once, in the editor, and never again on its own in this browser
  // (not while a temporary password must be changed: that screen comes first)
  useEffect(() => {
    if (mustChangePassword || (token && !me)) return;
    if (shouldAutoOpen({ loggedIn: !!token, view: currentView, seen: tutorialSeen() })) openTutorial();
  }, [token, me, mustChangePassword, currentView, openTutorial]);

  let content: React.ReactNode;
  if (!token) {
    content = <LoginPage />;
  } else if (mustChangePassword) {
    content = <ChangePasswordPage />;
  } else if (platform && (currentView === 'platform' || currentView === 'admin' || currentView === 'templates')) {
    content = <PlatformPage initialTab={currentView === 'admin' ? 'users' : currentView === 'templates' ? 'templates' : 'companies'} />;
  } else if (currentView === 'admin') {
    content = <AdminPage onBack={goEditor} />;
  } else if (currentView === 'account') {
    content = <AccountPage onBack={goEditor} />;
  } else if (currentView === 'my-designs') {
    content = <MyDesignsPage onBack={goEditor} />;
  } else if (currentView === 'tokens') {
    content = <TokensPage onBack={goEditor} />;
  } else if (currentView === 'templates') {
    content = <TemplatesPage onBack={goEditor} />;
  } else if (currentView === 'help') {
    content = <HelpPage onBack={goEditor} />;
  } else {
    content = (
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--chrome-bg)' }}>
        <KeyboardShortcuts />
        <Toolbar onNavigateToMyDesigns={() => navigate('my-designs')} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar onNavigateToMyDesigns={() => navigate('my-designs')} onNavigateToTemplates={() => navigate('templates')} onNavigateToTokens={() => navigate('tokens')} onNavigateToHelp={() => navigate('help')} onNavigateToAdmin={() => navigate('admin')} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TabSwitcher />
            <div className="flex flex-1 overflow-hidden" style={maximized && activeTab !== 'code' ? { display: 'none' } : undefined}>
              {activeTab !== 'code' && (
                <div className="flex-1 overflow-hidden">
                  <Canvas />
                </div>
              )}
              {activeTab === 'split' && (
                <div style={{ width: '40%', minWidth: 320, borderLeft: '1px solid var(--chrome-border)' }}>
                  <CodeEditor />
                </div>
              )}
              {activeTab === 'code' && <CodeEditor />}
            </div>
            {activeTab !== 'code' && <TestDataPanel />}
          </div>
          {activeTab !== 'code' && <PropertiesPanel />}
        </div>
        {showSaveModal && <SaveDesignModal />}
      </div>
    );
  }

  return (
    <>
      {content}
      <TutorialDialog />
      <ConfirmDialog />
      <Toasts />
    </>
  );
}
