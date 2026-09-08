import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import {
  GitCompare, LayoutDashboard, LogOut, MessageSquare, Network, Settings,
  UploadCloud, Users,
} from 'lucide-react';

import {
  clearSession, fetchDocuments, fetchHistory, fetchIdentity, fetchSessions,
  setUnauthorizedHandler, storedSession,
} from './api';
import { SettingsPanel, SidebarLink, Spinner } from './components/common';
import { AuthScreen } from './pages/AuthScreen';
import logoImg from './assets/logo.jpg';

/**
 * Every screen behind the sign-in wall is code-split.
 *
 * The whole application used to load on first paint, including the mind map
 * explorer's graph library and the markdown and diagram renderers - none of
 * which the sign-in screen needs, and most of which a given session never
 * opens. AuthScreen stays eager because it is the first thing rendered.
 */
const ChatScreen = lazy(() => import('./pages/ChatScreen'));
const GraphScreen = lazy(() => import('./pages/GraphScreen'));
const UserDashboard = lazy(() =>
  import('./pages/UserDashboard').then((m) => ({ default: m.UserDashboard })));
const Dashboard = lazy(() =>
  import('./pages/AdminDashboard').then((m) => ({ default: m.Dashboard })));
const UploadScreen = lazy(() =>
  import('./pages/UploadScreen').then((m) => ({ default: m.UploadScreen })));
const CompareScreen = lazy(() =>
  import('./pages/CompareScreen').then((m) => ({ default: m.CompareScreen })));
const UsersScreen = lazy(() =>
  import('./pages/UsersScreen').then((m) => ({ default: m.UsersScreen })));

const RouteFallback = () => (
  <div className="h-full flex items-center justify-center">
    <Spinner size={24} className="text-sky-500" />
  </div>
);

const App = () => {
  const [booting, setBooting] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');
  const [displayName, setDisplayName] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === '1');
  const [showSettings, setShowSettings] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);

  const isAdmin = role === 'admin';

  const handleLogout = useCallback(() => {
    clearSession();
    setIsAuthenticated(false);
    setUsername('');
    setRole('user');
    setDisplayName('');
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([]);
    setDocuments([]);
  }, []);

  // A 401 anywhere ends the session once, centrally.
  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  }, [handleLogout]);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode ? '1' : '0');
  }, [darkMode]);

  /**
   * Ask the server who we are rather than trusting the cached role.
   * localStorage is a hint for optimistic rendering; /auth/me is the authority,
   * and every protected route re-checks the role server-side regardless.
   */
  useEffect(() => {
    const { token, username: cachedName, role: cachedRole } = storedSession();
    if (!token) {
      setBooting(false);
      return;
    }
    setUsername(cachedName || '');
    setRole(cachedRole);
    fetchIdentity()
      .then((identity) => {
        setUsername(identity.username);
        setRole(identity.role);
        setDisplayName(identity.full_name || '');
        localStorage.setItem('role', identity.role);
        setIsAuthenticated(true);
      })
      .catch(() => handleLogout())
      .finally(() => setBooting(false));
  }, [handleLogout]);

  const refreshDocuments = useCallback(() => {
    if (!isAuthenticated) return;
    fetchDocuments().then(setDocuments).catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshDocuments();
    fetchSessions()
      .then((list) => {
        setSessions(list);
        if (list.length && !currentSessionId) setCurrentSessionId(list[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, refreshDocuments]);

  useEffect(() => {
    if (!isAuthenticated || !currentSessionId) {
      setMessages([]);
      return;
    }
    fetchHistory(currentSessionId).then(setMessages).catch(() => setMessages([]));
  }, [currentSessionId, isAuthenticated]);

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <Spinner size={28} className="text-sky-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        onLogin={(user, userRole) => {
          setUsername(user);
          setRole(userRole);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <Router>
      <div
        className={`flex h-screen font-sans selection:bg-sky-200 ${
          darkMode ? 'dark bg-slate-900' : 'bg-[#F8FAFC]'
        }`}
      >
        {showSettings && (
          <SettingsPanel
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            onClose={() => setShowSettings(false)}
            username={username}
            role={role}
            onProfileSaved={(profile) => setDisplayName(profile.full_name || '')}
          />
        )}

        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col shadow-sm z-10 shrink-0">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 text-slate-900 dark:text-white font-bold text-lg tracking-tight">
              <img src={logoImg} alt="" className="w-9 h-9 rounded-xl shadow-md object-cover" />
              <span>ArchiveMind <span className="text-sky-500">AI</span></span>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
            <SidebarLink to="/" icon={LayoutDashboard}>Dashboard</SidebarLink>
            <SidebarLink to="/chat" icon={MessageSquare}>Semantic Chat</SidebarLink>
            <SidebarLink to="/graph" icon={Network}>Knowledge Graph</SidebarLink>
            <SidebarLink to="/compare" icon={GitCompare}>Compare</SidebarLink>
            {isAdmin && (
              <>
                <div className="pt-4 pb-1 px-4">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                    Administration
                  </p>
                </div>
                <SidebarLink to="/upload" icon={UploadCloud}>Ingest Documents</SidebarLink>
                <SidebarLink to="/people" icon={Users}>People</SidebarLink>
              </>
            )}
          </nav>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-300 flex items-center justify-center border border-sky-200 dark:border-sky-700 font-bold uppercase shrink-0">
                {username.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {displayName || username}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isAdmin ? 'Administrator' : 'Reader'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setShowSettings(true)}
                className="text-slate-400 hover:text-sky-500 p-2 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/30"
                title="Settings"
              >
                <Settings size={19} />
              </button>
              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                title="Sign out"
              >
                <LogOut size={19} />
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto dark:bg-slate-900 dark:text-slate-100 min-w-0">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
            <Route
              path="/"
              element={
                isAdmin ? (
                  <Dashboard
                    username={username}
                    documents={documents}
                    sessions={sessions}
                    setSessions={setSessions}
                    setCurrentSessionId={setCurrentSessionId}
                    refreshDocuments={refreshDocuments}
                  />
                ) : (
                  <UserDashboard
                    username={username}
                    documents={documents}
                    sessions={sessions}
                    setSessions={setSessions}
                    setCurrentSessionId={setCurrentSessionId}
                  />
                )
              }
            />
            <Route
              path="/chat"
              element={
                <ChatScreen
                  sessions={sessions}
                  setSessions={setSessions}
                  currentSessionId={currentSessionId}
                  setCurrentSessionId={setCurrentSessionId}
                  messages={messages}
                  setMessages={setMessages}
                  documents={documents}
                  darkMode={darkMode}
                />
              }
            />
            <Route
              path="/graph"
              element={
                <GraphScreen
                  documents={documents}
                  sessions={sessions}
                  currentSessionId={currentSessionId}
                  darkMode={darkMode}
                />
              }
            />
            <Route
              path="/compare"
              element={<CompareScreen documents={documents} darkMode={darkMode} />}
            />
            <Route
              path="/upload"
              element={
                isAdmin ? (
                  <UploadScreen documents={documents} onUploadSuccess={refreshDocuments} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/people"
              element={
                isAdmin ? <UsersScreen currentUsername={username} /> : <Navigate to="/" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </Router>
  );
};

export default App;
