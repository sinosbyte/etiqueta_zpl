import React from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { TabSwitcher } from './components/TabSwitcher';
import { CodeEditor } from './components/CodeEditor';
import { SaveDesignModal } from './components/SaveDesignModal';
import { PreviewPanel } from './components/PreviewPanel';
import { KeyboardShortcuts } from './components/KeyboardShortcuts';
import { Toasts } from './components/Toasts';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useDesignerStore } from './store/useDesignerStore';
import { useAuthStore } from './store/useAuthStore';
import { useDesignsStore } from './store/useDesignsStore';
import { useWarnBeforeUnload } from './hooks/useUnsavedChanges';
import { LoginPage } from './pages/LoginPage';
import { MyDesignsPage } from './pages/MyDesignsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TokensPage } from './pages/TokensPage';
import { navigate, useView } from './utils/navigation';

export default function App() {
  const { activeTab, previewUrl, previewLoading, previewError } = useDesignerStore();
  const { token } = useAuthStore();
  const { showSaveModal } = useDesignsStore();
  const currentView = useView();
  const goEditor = () => navigate('designer');
  useWarnBeforeUnload();

  const previewActive = !!(previewUrl || previewLoading || previewError);

  let content: React.ReactNode;
  if (!token) {
    content = <LoginPage />;
  } else if (currentView === 'my-designs') {
    content = <MyDesignsPage onBack={goEditor} />;
  } else if (currentView === 'tokens') {
    content = <TokensPage onBack={goEditor} />;
  } else if (currentView === 'templates') {
    content = <TemplatesPage onBack={goEditor} />;
  } else {
    content = (
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--chrome-bg)' }}>
        <KeyboardShortcuts />
        <Toolbar onNavigateToMyDesigns={() => navigate('my-designs')} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar onNavigateToMyDesigns={() => navigate('my-designs')} onNavigateToTemplates={() => navigate('templates')} onNavigateToTokens={() => navigate('tokens')} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TabSwitcher />
            <div className="flex flex-1 overflow-hidden">
              {activeTab !== 'code' && (
                <>
                  <div className="flex-1 overflow-hidden">
                    <Canvas />
                  </div>
                  <PreviewPanel />
                </>
              )}
              {activeTab === 'split' && (
                <div style={{ width: '40%', minWidth: 320, borderLeft: '1px solid var(--chrome-border)' }}>
                  <CodeEditor />
                </div>
              )}
              {activeTab === 'code' && <CodeEditor />}
            </div>
          </div>
          {activeTab !== 'code' && !previewActive && <PropertiesPanel />}
        </div>
        {showSaveModal && <SaveDesignModal />}
      </div>
    );
  }

  return (
    <>
      {content}
      <ConfirmDialog />
      <Toasts />
    </>
  );
}
