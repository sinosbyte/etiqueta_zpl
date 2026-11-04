import React, { useState } from 'react';
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
import { useDesignerStore } from './store/useDesignerStore';
import { useAuthStore } from './store/useAuthStore';
import { useDesignsStore } from './store/useDesignsStore';
import { LoginPage } from './pages/LoginPage';
import { MyDesignsPage } from './pages/MyDesignsPage';

type View = 'designer' | 'my-designs';

export default function App() {
  const { activeTab, previewUrl, previewLoading, previewError } = useDesignerStore();
  const { token } = useAuthStore();
  const { showSaveModal } = useDesignsStore();
  const [currentView, setCurrentView] = useState<View>('designer');

  const previewActive = !!(previewUrl || previewLoading || previewError);

  let content: React.ReactNode;
  if (!token) {
    content = <LoginPage />;
  } else if (currentView === 'my-designs') {
    content = <MyDesignsPage onBack={() => setCurrentView('designer')} />;
  } else {
    content = (
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--chrome-bg)' }}>
        <KeyboardShortcuts />
        <Toolbar onNavigateToMyDesigns={() => setCurrentView('my-designs')} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar onNavigateToMyDesigns={() => setCurrentView('my-designs')} />
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
      <Toasts />
    </>
  );
}
