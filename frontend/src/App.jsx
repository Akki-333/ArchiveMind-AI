import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UploadCloud, MessageSquare, Network, FileText, Database, Shield, LogOut, Key, User, ArrowRight, Plus, Trash2, MessageCircle, Pencil, Check, ChevronDown, CheckCircle, BrainCircuit, ChevronRight, Copy, Activity, Tag, Clock, Download, Settings, Moon, Sun, X, ChevronLeft } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { ReactFlow, Controls, Background, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import logoImg from './assets/logo.jpg';

// Configure Axios Base URL dynamically
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

// --- DOMAIN KEYWORD MAPPING ---
const DOMAIN_LIST = [
  { label: 'Agriculture & Farming', keywords: ['agri', 'farm', 'crop', 'kisan', 'irrigation', 'rural', 'soil', 'fertilizer', 'harvest', 'horticulture'] },
  { label: 'Education & Learning', keywords: ['edu', 'school', 'ncert', 'university', 'college', 'student', 'curriculum', 'learning', 'scholarship', 'literacy'] },
  { label: 'Budget & Finance', keywords: ['budget', 'finance', 'tax', 'fiscal', 'revenue', 'gst', 'economy', 'fund', 'expenditure', 'allocation'] },
  { label: 'Health & Medicine', keywords: ['health', 'medical', 'hospital', 'disease', 'ayushman', 'pharma', 'medicine', 'nutrition', 'sanitation', 'vaccination'] },
  { label: 'Legal & Justice', keywords: ['legal', 'law', 'court', 'justice', 'act', 'rights', 'constitution', 'regulation', 'penalty', 'judiciary'] },
  { label: 'Environment & Climate', keywords: ['environment', 'climate', 'pollution', 'carbon', 'forest', 'energy', 'solar', 'green', 'ecology', 'biodiversity'] },
  { label: 'Infrastructure & Transport', keywords: ['infra', 'road', 'railway', 'highway', 'bridge', 'port', 'metro', 'transport', 'construction', 'airport'] },
  { label: 'Science & Technology', keywords: ['science', 'tech', 'digital', 'ai', 'innovation', 'research', 'space', 'isro', 'satellite', 'cyber'] },
  { label: 'Rural Development', keywords: ['rural', 'village', 'panchayat', 'gram', 'mgnrega', 'swachh', 'toilet', 'sanitation', 'self help'] },
  { label: 'Defence & Security', keywords: ['defence', 'military', 'army', 'navy', 'air force', 'security', 'border', 'strategic', 'weapon'] },
  { label: 'Social Welfare', keywords: ['welfare', 'pension', 'scheme', 'beneficiary', 'subsidy', 'ration', 'bpl', 'empowerment', 'minorities'] },
  { label: 'Housing & Urban', keywords: ['housing', 'urban', 'city', 'municipality', 'smart city', 'pmay', 'slum', 'real estate', 'property'] },
  { label: 'Women & Child', keywords: ['women', 'child', 'maternal', 'beti', 'gender', 'anganwadi', 'nutrition', 'adolescent', 'empowerment'] },
  { label: 'Other / General', keywords: [] },
];

const getDocumentDomain = (doc) => {
  const text = ((doc.filename || '') + ' ' + (doc.summary || '')).toLowerCase();
  for (const domain of DOMAIN_LIST.slice(0, -1)) {
    if (domain.keywords.some(kw => text.includes(kw))) {
      return domain.label;
    }
  }
  return 'Other / General';
};

// --- CUSTOM REACT FLOW NODE ---
const CustomEntityNode = ({ data }) => {
  return (
    <div className="px-4 py-2.5 shadow-md border border-sky-200 bg-white rounded-xl text-slate-800 font-semibold text-sm text-center min-w-[120px] max-w-[300px] truncate">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-sky-400 !border-white" />
      {data.label}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-sky-400 !border-white" />
    </div>
  );
};
const nodeTypes = { entity: CustomEntityNode };

// --- DAGRE AUTO-LAYOUT ---
const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const autoDirection = nodes.length < 6 ? 'LR' : direction;
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  const nodeHeight = 50;
  dagreGraph.setGraph({ rankdir: autoDirection, ranksep: 120, nodesep: 100, marginx: 40, marginy: 40 });
  nodes.forEach((node) => {
    const dynamicWidth = Math.min(Math.max(node.data.label.length * 9 + 40, 150), 350);
    dagreGraph.setNode(node.id, { width: dynamicWidth, height: nodeHeight });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const dynamicWidth = Math.min(Math.max(node.data.label.length * 9 + 40, 150), 350);
    return {
      ...node,
      targetPosition: autoDirection === 'TB' ? 'top' : 'left',
      sourcePosition: autoDirection === 'TB' ? 'bottom' : 'right',
      position: {
        x: nodeWithPosition.x - dynamicWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });
  return { nodes: layoutedNodes, edges };
};

// --- STYLED COMPONENTS ---

const SidebarLink = ({ to, icon: Icon, children, darkMode }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  return (
    <Link to={to} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
      isActive 
        ? 'bg-sky-50 text-sky-600 border border-sky-200 dark:bg-sky-900/30 dark:border-sky-700' 
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
    }`}>
      <Icon size={20} className={isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'} />
      <span className="font-medium text-sm tracking-wide">{children}</span>
    </Link>
  );
};

// --- NEW CHAT MODAL ---
const NewChatModal = ({ documents, onClose, onConfirm }) => {
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');

  const filteredDocs = selectedDomain
    ? documents.filter(doc => getDocumentDomain(doc) === selectedDomain)
    : [];

  const domainsWithDocs = DOMAIN_LIST.filter(d =>
    d.label === 'Other / General'
      ? documents.some(doc => getDocumentDomain(doc) === 'Other / General')
      : documents.some(doc => getDocumentDomain(doc) === d.label)
  );

  const handleConfirm = () => {
    const doc = documents.find(d => d.id === selectedDocId);
    onConfirm(doc || null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8 w-full max-w-lg mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus size={20} className="text-sky-500" /> Start New Chat
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">1. Select Domain</label>
          <div className="relative">
            <select
              value={selectedDomain}
              onChange={e => { setSelectedDomain(e.target.value); setSelectedDocId(''); }}
              className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all appearance-none cursor-pointer"
            >
              <option value="">-- Choose a government domain --</option>
              {domainsWithDocs.map(d => (
                <option key={d.label} value={d.label}>{d.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
          </div>
        </div>

        {selectedDomain && (
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">2. Select Document</label>
            {filteredDocs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 p-4 rounded-xl">No documents found for this domain.</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
                {filteredDocs.map(doc => (
                  <div
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${
                      selectedDocId === doc.id
                        ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-600 text-sky-700 dark:text-sky-300'
                        : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:border-sky-200 dark:hover:border-sky-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <FileText size={16} className={selectedDocId === doc.id ? 'text-sky-500' : 'text-slate-400'} />
                    <div>
                      <p className="text-sm font-medium">{doc.filename}</p>
                      {doc.summary && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-1">{doc.summary}</p>}
                    </div>
                    {selectedDocId === doc.id && <Check size={16} className="text-sky-500 ml-auto shrink-0" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 rounded-xl bg-sky-500 text-white font-semibold hover:bg-sky-600 transition-colors shadow-md disabled:opacity-50"
          >
            Start Chat
          </button>
        </div>
      </div>
    </div>
  );
};

// --- SETTINGS PANEL ---
const SettingsPanel = ({ darkMode, setDarkMode, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8 w-full max-w-sm mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings size={20} className="text-sky-500" /> Settings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600">
            <div className="flex items-center gap-3">
              {darkMode ? <Moon size={20} className="text-sky-400" /> : <Sun size={20} className="text-amber-400" />}
              <div>
                <p className="font-semibold text-slate-900 dark:text-white text-sm">Interface Mode</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{darkMode ? 'Dark Mode Active' : 'Light Mode Active'}</p>
              </div>
            </div>
            <button
              onClick={() => {
                const next = !darkMode;
                setDarkMode(next);
                localStorage.setItem('darkMode', next ? '1' : '0');
              }}
              className={`relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none ${darkMode ? 'bg-sky-500' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ${darkMode ? 'translate-x-7' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center mt-5">ArchiveMind AI · Settings</p>
      </div>
    </div>
  );
};

// --- AUTH SCREEN ---

const AuthScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin ? { username, password } : { username, password, role };
      const response = await axios.post(`${endpoint}`, payload);
      
      if (response.data) { 
        localStorage.setItem('token', response.data.access_token);
        localStorage.setItem('username', response.data.username);
        localStorage.setItem('role', response.data.role);
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
        onLogin(response.data.username, response.data.role);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Authentication failed. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-sky-50 via-white to-sky-50/30 min-h-screen flex items-center justify-center font-sans">
      
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl border border-slate-200 relative z-10 animate-fade-in">
        <div className="text-center mb-10">
          <img src={logoImg} alt="ArchiveMind AI" className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-sm border border-slate-200 object-cover" />
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ArchiveMind <span className="text-sky-500">AI</span></h1>
          <p className="text-slate-600 mt-2 text-sm">{isLogin ? 'Welcome back. Please sign in.' : 'Create your account to begin.'}</p>
        </div>

        {error && (
          <div className={`p-4 rounded-xl text-sm font-medium mb-6 text-center border ${
            error.includes('successful') 
            ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
            : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Username</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-400"
                placeholder="Enter username"
                required
              />
            </div>
          </div>
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Account Role</label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all appearance-none cursor-pointer"
                >
                  <option value="user">Citizen (Read-Only Portal)</option>
                  <option value="admin">Government Official (Admin)</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-400"
                placeholder="Enter password"
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3.5 rounded-xl font-bold tracking-wide disabled:opacity-50 transition-colors shadow-md mt-2 flex items-center justify-center gap-2 group"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
            {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-600 text-sm">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              onClick={() => {setIsLogin(!isLogin); setError('');}} 
              className="text-sky-600 hover:text-sky-700 font-semibold ml-2 transition-colors"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

// --- PAGES ---

const UserDashboard = ({ username, documents, sessions, setSessions, setCurrentSessionId }) => {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const res = await axios.get('/api/chat/recommendations');
        setRecommendations(res.data.recommendations || []);
      } catch (e) {
        console.error(e);
        setRecommendations(["Public Health", "Tax Policies", "Education Reform"]);
      }
      setLoadingRecs(false);
    };
    fetchRecommendations();
  }, []);

  const handleTopicClick = (topic) => {
    navigate('/chat', { state: { initialQuery: `Tell me everything about ${topic} based on current policies.` } });
  };

  const handleQuickJump = async (doc, targetPath) => {
    const existingSession = sessions.find(s => (s.doc_id || '') === doc.id);
    if (existingSession) {
      setCurrentSessionId(existingSession.id);
    } else {
      try {
        const title = doc.filename;
        const res = await axios.post('/api/chat/sessions', { title: title, doc_id: doc.id });
        setSessions(prev => [res.data, ...prev]);
        setCurrentSessionId(res.data.id);
      } catch (err) {
        console.error(err);
      }
    }
    navigate(targetPath);
  };

  return (
    <div className="p-8 animate-fade-in max-w-5xl mx-auto pb-20">
      {/* Greeting */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Welcome back, <span className="text-sky-500">{username}</span> 👋</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 text-lg">Explore government policies and documents below.</p>
      </div>

      {/* AI Recommendations */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-3"><Tag className="text-purple-500"/> Recommended For You</h2>
        {loadingRecs ? (
          <div className="text-slate-400 flex items-center gap-2 animate-pulse"><div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div> AI is analyzing your history...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendations.map((topic, i) => (
              <div key={i} onClick={() => handleTopicClick(topic)} className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-600 transition-all cursor-pointer shadow-sm hover:shadow-md group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-purple-200 dark:bg-purple-700 group-hover:bg-purple-400 dark:group-hover:bg-purple-500 transition-colors"></div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-purple-500 transition-colors mb-2 pr-6">{topic}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">Click to explore policies related to this topic.</p>
                <ArrowRight size={18} className="absolute right-6 top-6 text-slate-400 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Policy Directory */}
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-3"><FileText className="text-sky-500"/> Available Policy Directory</h2>
      {documents.length === 0 ? (
         <div className="text-center py-10 text-slate-400">No documents are currently available. Check back later.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {documents.map((doc, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-600 transition-all hover:-translate-y-1 shadow-sm hover:shadow-md flex flex-col group">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3 group-hover:text-sky-500 transition-colors">{doc.filename}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 flex-1 leading-relaxed">{doc.summary || "No summary available for this document."}</p>
              <div className="flex items-center gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                <button onClick={() => handleQuickJump(doc, '/chat')} className="flex-1 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-sky-600 dark:text-sky-400 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-sky-200 dark:border-sky-700">
                  <MessageSquare size={16} /> Chat
                </button>
                <button onClick={() => handleQuickJump(doc, '/graph')} className="flex-1 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-purple-600 dark:text-purple-400 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-purple-200 dark:border-purple-700">
                  <Network size={16} /> Explore Graph
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Dashboard = ({ username, documents, sessions, setSessions, setCurrentSessionId, fetchDocuments }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total_entities: 0, top_entities: [] });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/stats');
        setStats(res.data);
      } catch (e) {
        // Fallback: compute from documents client-side
        const entityCounts = {};
        let total = 0;
        documents.forEach(doc => {
          try {
            const entities = JSON.parse(doc.key_entities || "[]");
            entities.forEach(e => {
              const clean = e.trim();
              if (clean) { entityCounts[clean] = (entityCounts[clean] || 0) + 1; total++; }
            });
          } catch(err) {}
        });
        const top = Object.entries(entityCounts).sort((a,b) => b[1]-a[1]).slice(0,15).map(([name,count]) => ({name,count}));
        setStats({ total_entities: total, top_entities: top });
      }
      setLoadingStats(false);
    };
    fetchStats();
  }, [documents]);

  const handleQuickJump = async (doc, targetPath) => {
    const existingSession = sessions.find(s => (s.doc_id || '') === doc.id);
    if (existingSession) {
      setCurrentSessionId(existingSession.id);
    } else {
      try {
        const res = await axios.post('/api/chat/sessions', { title: doc.filename, doc_id: doc.id });
        setSessions(prev => [res.data, ...prev]);
        setCurrentSessionId(res.data.id);
      } catch (err) { console.error(err); }
    }
    navigate(targetPath);
  };

  const recentDocs = documents.slice(0, 4);

  const handleDeleteDoc = async (docId) => {
    if (window.confirm("Are you sure you want to completely delete this document from Pinecone, Neo4j, and the database?")) {
      try {
        await axios.delete(`/api/documents/${docId}`);
        if (fetchDocuments) fetchDocuments();
      } catch (err) {
        alert("Failed to delete document: " + (err.response?.data?.detail || err.message));
      }
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-7xl mx-auto">
      <div className="mb-10 flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Welcome back, <span className="text-sky-500">{username}</span> 👋</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 text-lg">Your intelligent government policy assistant is ready.</p>
        </div>
      </div>
      
      {/* TOP STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><FileText size={64} /></div>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase mb-1">Documents Ingested</p>
          <p className="text-4xl font-bold text-slate-900 dark:text-white">{documents.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><MessageCircle size={64} /></div>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase mb-1">Chat Sessions</p>
          <p className="text-4xl font-bold text-slate-900 dark:text-white">{sessions.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><Network size={64} /></div>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase mb-1">Entities Mapped</p>
          <p className="text-4xl font-bold text-emerald-500">{loadingStats ? '...' : stats.total_entities}</p>
        </div>
      </div>
      
      {/* MIDDLE ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <Clock size={18} className="text-sky-500"/> Recent Documents
          </h3>
          {recentDocs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-8">
              <FileText size={48} className="opacity-20 mb-3" />
              <p>No documents uploaded yet.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-3">
              {recentDocs.map((doc, i) => (
                <div key={i} className="bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 p-4 rounded-xl flex justify-between items-center hover:border-slate-300 dark:hover:border-slate-500 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="bg-sky-50 dark:bg-sky-900/30 text-sky-500 p-2 rounded-lg border border-sky-100 dark:border-sky-800">
                      <FileText size={20} />
                    </div>
                    <div>
                      <p className="text-slate-900 dark:text-white font-medium">{doc.filename}</p>
                      <p className="text-xs text-slate-400 mt-1">{new Date(doc.created_at).toLocaleDateString()} • Graph Extracted</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleQuickJump(doc, '/chat')} className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-lg transition-colors" title="Semantic Chat">
                      <MessageSquare size={18} />
                    </button>
                    <button onClick={() => handleQuickJump(doc, '/graph')} className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-lg transition-colors" title="Knowledge Graph">
                      <Network size={18} />
                    </button>
                    <button onClick={() => handleDeleteDoc(doc.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors ml-2 border border-slate-200 dark:border-slate-600 hover:border-red-200" title="Delete Document">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <Tag size={18} className="text-sky-500"/> Top Extracted Concepts
          </h3>
          {loadingStats ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : stats.top_entities.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <p className="text-sm text-center">Upload documents to build<br/>your Knowledge Graph.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-wrap content-start gap-2">
              {stats.top_entities.map((e, idx) => (
                <span key={idx} className="bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 border border-sky-200 dark:border-sky-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors cursor-default">
                  {e.name} <span className="opacity-50 ml-1 text-xs">×{e.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* SYSTEM HEALTH */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">System Health</h3>
        <div className="flex flex-wrap gap-4">
          {[
            { title: 'Vector Database', value: 'Pinecone Connected', icon: Database, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
            { title: 'Graph Database', value: 'Neo4j Connected', icon: Network, color: 'text-sky-500', bg: 'bg-sky-50 dark:bg-sky-900/20', border: 'border-sky-200 dark:border-sky-800' },
            { title: 'LLM Engine', value: 'Groq Ready', icon: Shield, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
          ].map((stat, i) => (
            <div key={i} className={`bg-white dark:bg-slate-800 px-4 py-3 rounded-xl border ${stat.border} flex items-center gap-3`}>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={16} className={stat.color} />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">{stat.title}</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const UploadScreen = ({ documents, onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingDocs, setDeletingDocs] = useState({});

  const handleUpload = async () => {
    if (!file) return;
    setStatus('Uploading and processing... This may take a minute.');
    setLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setStatus('Success: ' + response.data.message);
      if (onUploadSuccess) onUploadSuccess();
      setFile(null);
    } catch (err) {
      setStatus('Error: ' + (err.response?.data?.detail || err.message));
    }
    setLoading(false);
  };

  const handleQuickDelete = async (docId) => {
    if(!window.confirm("Are you sure you want to completely erase this document and its graph data?")) return;
    setDeletingDocs(prev => ({ ...prev, [docId]: true }));
    try {
      await axios.delete(`/api/documents/${docId}`);
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      setStatus('Error deleting document: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeletingDocs(prev => ({ ...prev, [docId]: false }));
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-4xl mx-auto mt-10">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 mb-8">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
          <UploadCloud className="text-sky-500" /> Document Ingestion
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">Upload documents (.pdf, .docx, .pptx, .txt, .csv, .md) to vectorize them into Pinecone and extract Graph entities to Neo4j.</p>
        
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-12 text-center bg-slate-50/50 dark:bg-slate-700/30 hover:border-sky-400 hover:bg-sky-50/30 transition-all">
          <input 
            type="file" 
            accept=".pdf,.docx,.pptx,.txt,.csv,.md" 
            onChange={(e) => setFile(e.target.files[0])} 
            className="mb-8 block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-600 hover:file:bg-sky-100 cursor-pointer" 
          />
          <button 
            onClick={handleUpload}
            disabled={!file || loading}
            className="bg-sky-500 text-white px-8 py-3 rounded-xl font-semibold tracking-wide hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
          >
            {loading ? 'Processing AI Data...' : 'Upload to Knowledge Base'}
          </button>
        </div>
        {status && (
          <div className={`mt-6 p-4 rounded-xl font-medium text-center border ${status.includes('Error') ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
            {status}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
          <Clock className="text-sky-500" /> Recent Uploads
        </h3>
        {documents && documents.length > 0 ? (
          <div className="space-y-3">
            {documents.slice(0, 5).map((doc, i) => (
              <div key={i} className="bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 p-4 rounded-xl flex justify-between items-center hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-sky-50 dark:bg-sky-900/30 text-sky-500 p-2 rounded-lg border border-sky-100 dark:border-sky-800">
                    <FileText size={20} />
                  </div>
                  <div>
                    <p className="text-slate-900 dark:text-white font-medium">{doc.filename}</p>
                    <p className="text-xs text-slate-400 mt-1">{new Date(doc.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleQuickDelete(doc.id)}
                  disabled={deletingDocs[doc.id]}
                  className="px-3 py-1.5 text-sm text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200 font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingDocs[doc.id] ? (
                    <><div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div> Erasing...</>
                  ) : (
                    <><Trash2 size={14} /> Erase</>
                  )}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400">No documents uploaded yet.</p>
        )}
      </div>
    </div>
  );
};

const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline) {
    return (
      <div className="relative group my-6 rounded-lg overflow-hidden bg-[#0a0f1c] border border-slate-700/60 shadow-lg">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#05080f] border-b border-slate-800">
          <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">{match ? match[1] : 'text'}</span>
          <button 
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors bg-slate-800/50 hover:bg-slate-700 px-2.5 py-1 rounded-md"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
        </div>
        <div className="p-4 overflow-x-auto text-sm text-slate-300 font-mono leading-relaxed custom-scrollbar">
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      </div>
    );
  }
  
  return (
    <code className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded text-sm font-mono border border-sky-200" {...props}>
      {children}
    </code>
  );
};

const ChatMessage = ({ message, msgRef }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div ref={msgRef} className={`mb-5 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`group relative px-4 py-3 rounded-2xl max-w-[80%] leading-relaxed ${
        message.role === 'user'
          ? 'bg-sky-500 text-white rounded-tr-sm shadow-md break-words whitespace-pre-wrap'
          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm prose prose-slate dark:prose-invert prose-sm max-w-none break-words min-w-0 prose-chat'
      }`}>
        {message.role === 'user' ? message.content : <ReactMarkdown components={{ code: CodeBlock }}>{message.content}</ReactMarkdown>}
        <button
          onClick={handleCopy}
          className={`absolute -bottom-3 ${message.role === 'user' ? 'right-2' : 'left-2'} opacity-0 group-hover:opacity-100 transition-all bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-slate-400 hover:text-sky-500 p-1.5 rounded-lg`}
          title="Copy to clipboard"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
};

const ChatScreen = ({ sessions, setSessions, currentSessionId, setCurrentSessionId, messages, setMessages, setLastQuery, documents }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const editInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageRefs = useRef({});
  const location = useLocation();
  const navigate = useNavigate();

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const selectedDocId = currentSession?.doc_id || '';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingSessionId]);

  const handleCreateChat = () => {
    setShowNewChatModal(true);
  };

  const handleNewChatConfirm = async (doc) => {
    setShowNewChatModal(false);
    try {
      const title = doc ? doc.filename : "New Chat";
      const docId = doc ? doc.id : null;
      const res = await axios.post('/api/chat/sessions', { title, doc_id: docId });
      setSessions(prev => [res.data, ...prev]);
      setCurrentSessionId(res.data.id);
      setMessages([]);
    } catch(err) {
      console.error(err);
    }
  };

  const handleDeleteChat = async (id, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`/api/chat/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch(err) {
      console.error(err);
    }
  };

  const handleRenameSubmit = async (id, e) => {
    e?.stopPropagation();
    if (!editTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      await axios.put(`/api/chat/sessions/${id}`, { title: editTitle });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editTitle } : s));
      setEditingSessionId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const startEditing = (session, e) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditTitle(session.title);
  };

  const performSend = async (queryText) => {
    if (!queryText.trim()) return;
    
    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
       try {
         const title = documents.length > 0 ? documents[0].filename : "New Chat";
         const docId = documents.length > 0 ? documents[0].id : null;
         const res = await axios.post('/api/chat/sessions', { title: title, doc_id: docId });
         setSessions(prev => [res.data, ...prev]);
         activeSessionId = res.data.id;
         setCurrentSessionId(activeSessionId);
       } catch (err) {
         console.error(err);
         return;
       }
    }
    
    const userMsg = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setLastQuery(queryText);

    try {
      const payload = { message: queryText, session_id: activeSessionId };
      const response = await axios.post('/api/chat', payload);
      setMessages(prev => [...prev, { role: 'ai', content: response.data.answer }]);
      
      // Refresh session list to get updated AI-generated title
      if (messages.length === 0) {
        const res = await axios.get('/api/chat/sessions');
        setSessions(res.data.sessions);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setMessages(prev => [...prev, { role: 'ai', content: "Authentication error. Please log in again." }]);
      } else {
        setMessages(prev => [...prev, { role: 'ai', content: "Error connecting to AI backend." }]);
      }
    }
    setLoading(false);
  };

  const initialQuerySentRef = useRef(false);

  useEffect(() => {
    if (location.state?.initialQuery && !initialQuerySentRef.current) {
      initialQuerySentRef.current = true;
      const query = location.state.initialQuery;
      navigate(location.pathname, { replace: true, state: {} });
      performSend(query);
    }
  }, [location.state, currentSessionId, navigate]);

  const sendMessage = (e) => {
    e.preventDefault();
    performSend(input.trim());
  };

  const scrollToMessage = (index) => {
    const ref = messageRefs.current[index];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setShowPromptHistory(false);
  };

  const activeDocName = documents.find(d => d.id === selectedDocId)?.filename;
  const userMessages = messages.map((m, i) => ({ ...m, originalIndex: i })).filter(m => m.role === 'user');

  return (
    <div className="h-full flex animate-fade-in relative">
      {showNewChatModal && (
        <NewChatModal
          documents={documents}
          onClose={() => setShowNewChatModal(false)}
          onConfirm={handleNewChatConfirm}
        />
      )}

      {/* Sessions Sidebar */}
      <div className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <button 
            onClick={handleCreateChat}
            className="w-full flex items-center justify-center gap-2 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-400 py-2.5 rounded-xl font-medium transition-all"
          >
            <Plus size={18} /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {sessions.map((session) => (
            <div 
              key={session.id}
              onClick={() => { if (editingSessionId !== session.id) setCurrentSessionId(session.id); }}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                currentSessionId === session.id 
                  ? 'bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-400' 
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                <MessageCircle size={16} className={`shrink-0 ${currentSessionId === session.id ? 'text-sky-500' : 'text-slate-400'}`} />
                {editingSessionId === session.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={(e) => handleRenameSubmit(session.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit(session.id, e);
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    className="flex-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm border-none rounded px-2 py-1 outline-none ring-1 ring-sky-500 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-sm font-medium truncate">{session.title}</span>
                )}
              </div>
              
              {!editingSessionId && (
                <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${currentSessionId === session.id ? 'opacity-100' : ''}`}>
                  <button onClick={(e) => startEditing(session, e)} className="text-slate-400 hover:text-sky-500 transition-colors p-1 rounded-md hover:bg-sky-50 dark:hover:bg-sky-900/30" title="Rename chat">
                    <Pencil size={14} />
                  </button>
                  <button onClick={(e) => handleDeleteChat(session.id, e)} className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete chat">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-center p-4 text-sm text-slate-500">
              No chat history found.
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 p-8 flex flex-col max-w-4xl mx-auto w-full relative">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="text-sky-500" /> Semantic Chatbot
            {activeDocName && <span className="text-sm font-normal text-slate-500 dark:text-slate-400 ml-3 bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-full">{activeDocName}</span>}
          </h2>
        </div>
        
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto overflow-x-hidden mb-6 flex flex-col custom-scrollbar">
          
          {selectedDocId && (
            <div className="mb-8 p-5 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-2xl shadow-sm">
              <h3 className="text-lg font-bold text-sky-600 dark:text-sky-400 mb-2 flex items-center gap-2">
                <FileText size={20} /> Document Overview
              </h3>
              <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed mb-4">
                {documents.find(d => d.id === selectedDocId)?.summary}
              </p>
              <div>
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Key Entities</h4>
                <div className="flex flex-wrap gap-2">
                  {JSON.parse(documents.find(d => d.id === selectedDocId)?.key_entities || "[]").map((entity, idx) => (
                    <span key={idx} className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs px-2.5 py-1 rounded-md">
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(!currentSessionId || messages.length === 0) && !selectedDocId && (
            <div className="m-auto text-center">
              <div className="w-16 h-16 bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-700 text-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
                <MessageSquare size={32} />
              </div>
              {documents.length === 0 ? (
                <p className="text-slate-700 dark:text-slate-300 font-semibold text-lg">Upload a document to start chatting</p>
              ) : (
                <>
                  <p className="text-slate-700 dark:text-slate-300 font-semibold text-lg">Ask a question about the uploaded documents...</p>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">Example: "What is the PM Vishwakarma scheme?"</p>
                </>
              )}
            </div>
          )}
          
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              message={m}
              msgRef={el => { messageRefs.current[i] = el; }}
            />
          ))}
          
          {loading && <div className="text-sky-500 animate-pulse font-medium flex items-center gap-2 bg-white dark:bg-slate-700 w-fit p-4 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-600 shadow-sm">
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} className="flex gap-4">
          <textarea 
            value={input} 
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(e);
              }
            }}
            placeholder="Ask a question..." 
            rows="1"
            className="flex-1 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl px-6 py-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-400 shadow-sm resize-none overflow-hidden"
            style={{ minHeight: '56px', height: 'auto' }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
              if (e.target.scrollHeight > 150) e.target.style.overflowY = 'auto';
              else e.target.style.overflowY = 'hidden';
            }}
          />
          <button type="submit" disabled={loading} className="bg-sky-500 text-white px-8 py-4 rounded-xl font-semibold tracking-wide hover:bg-sky-600 disabled:opacity-50 transition-colors shadow-md h-auto">
            Send
          </button>
        </form>

        {/* Hover-triggered Prompt History Panel — right edge of chat */}
        {userMessages.length > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 right-0 flex items-center"
            onMouseEnter={() => setShowPromptHistory(true)}
            onMouseLeave={() => setShowPromptHistory(false)}
          >
            {/* Trigger tab */}
            <div className={`w-2.5 h-32 bg-slate-400 dark:bg-slate-500 rounded-l-full cursor-pointer transition-all duration-300 shadow-sm ${showPromptHistory ? 'opacity-0' : 'opacity-80 hover:opacity-100 hover:w-3'}`} />

            {/* Slide-in panel */}
            <div className={`absolute right-0 top-1/2 -translate-y-1/2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-l-2xl shadow-xl transition-all duration-300 overflow-hidden ${showPromptHistory ? 'w-64 opacity-100' : 'w-0 opacity-0 pointer-events-none'}`}>
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageCircle size={12} /> Prompt History
                </p>
              </div>
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                {userMessages.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToMessage(m.originalIndex)}
                    className="w-full text-left p-2.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-600 dark:hover:text-sky-400 transition-colors truncate"
                  >
                    {m.content}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const GraphScreenContent = ({ messages, currentSessionId, documents, sessions, allSessions }) => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState(null);
  
  const currentSession = allSessions.find(s => s.id === currentSessionId);
  const initialDocId = currentSession?.doc_id || (documents.length > 0 ? documents[0].id : '');
  const [graphDocId, setGraphDocId] = useState(initialDocId);
  const [docQueries, setDocQueries] = useState([]);

  useEffect(() => {
    const fetchDocQueries = async () => {
      if (!graphDocId) {
        setDocQueries([]);
        return;
      }
      const relatedSessions = allSessions.filter(s => s.doc_id === graphDocId);
      if (relatedSessions.length === 0) {
        setDocQueries([]);
        return;
      }
      
      const allQueries = [];
      const seenNormalized = new Set();
      
      for (const session of relatedSessions) {
        try {
          const res = await axios.get(`/api/chat/history/${session.id}`);
          const msgs = res.data.messages || [];
          msgs.filter(m => m.role === 'user').forEach(m => {
            const norm = m.content.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\b(what|is|are|the|a|an|of|in|to|for|with|on|at|by|can|you|give|me|us|please|tell)\b/g, '').replace(/\s+/g, ' ').trim();
            const checkVal = norm.length > 0 ? norm : m.content.toLowerCase().trim();
            if (!seenNormalized.has(checkVal)) {
              seenNormalized.add(checkVal);
              allQueries.push(m);
            }
          });
        } catch (e) {}
      }
      setDocQueries(allQueries);
    };
    fetchDocQueries();
  }, [graphDocId, allSessions]);

  const activeDoc = documents.find(d => d.id === graphDocId);

  const handleDocChange = (docId) => {
    setGraphDocId(docId);
    setNodes([]);
    setEdges([]);
    setActiveQuery(null);
  };

  const handleQueryClick = async (queryText) => {
    if (activeQuery === queryText) {
      setActiveQuery(null);
      setNodes([]);
      setEdges([]);
      return;
    }
    
    setActiveQuery(queryText);
    setLoading(true);
    setNodes([]);
    setEdges([]);
    
    try {
      const response = await axios.post('/api/graph/highlight', { 
        query: queryText,
        doc_id: graphDocId 
      });
      const rawNodes = response.data.nodes || [];
      const rawLinks = response.data.links || [];
      
      const rfNodes = rawNodes.map((n) => ({
        id: n.id,
        type: 'entity',
        data: { label: n.id },
        position: { x: 0, y: 0 }
      }));
      
      const rfEdges = rawLinks.map((l, i) => ({
        id: `e-${l.source}-${l.target}-${i}`,
        source: l.source,
        target: l.target,
        label: l.label,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#38bdf8', strokeWidth: 2 },
        labelStyle: { fill: '#e2e8f0', fontWeight: 600, fontSize: 12 },
        labelBgStyle: { fill: '#1e293b', stroke: '#1e293b', strokeWidth: 1 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#38bdf8',
        },
      }));
      
      const layouted = getLayoutedElements(rfNodes, rfEdges);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
      
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="h-full flex animate-fade-in">
      {/* Sidebar for Document + Query History */}
      <div className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm tracking-wide uppercase flex items-center gap-2 mb-3">
            <FileText size={16} className="text-sky-500" /> Select Document
          </h3>
          <select
            value={graphDocId || ''}
            onChange={e => handleDocChange(e.target.value)}
            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg p-2 focus:outline-none focus:border-sky-500 transition-all appearance-none cursor-pointer"
          >
            <option value="">-- Choose a document --</option>
            {documents.map(d => (
              <option key={d.id} value={d.id}>{d.filename}</option>
            ))}
          </select>
        </div>
        <div className="p-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm tracking-wide uppercase flex items-center gap-2">
            <MessageSquare size={16} className="text-sky-500" /> Query History
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {!graphDocId ? (
            <div className="text-center p-4 text-sm text-slate-500">Select a document above.</div>
          ) : docQueries.length === 0 ? (
            <div className="text-center p-4 text-sm text-slate-500">No questions asked about this document yet.</div>
          ) : (
            docQueries.map((m, i) => (
              <div 
                key={i} 
                onClick={() => handleQueryClick(m.content)}
                className={`p-3 rounded-xl cursor-pointer transition-all text-sm ${
                  activeQuery === m.content 
                    ? 'bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-400 shadow-sm' 
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300'
                }`}
              >
                {m.content}
              </div>
            ))
          )}
        </div>

      </div>

      {/* Main Graph Area */}
      <div className="flex-1 p-8 flex flex-col relative h-full">
        <div className="mb-6 flex justify-between items-end gap-6">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Network className="text-sky-500" /> Mind Map Explorer
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              {activeDoc ? `Visualizing knowledge graph for: ${activeDoc.filename}` : 'Select a document to view its graph.'}
            </p>
          </div>
          
          <div className="flex gap-4 items-center">
            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-sm text-slate-600 dark:text-slate-400 flex gap-5 items-center">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-sky-100 border border-sky-400"></div> Entities</div>
              <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-sky-400"></div> Relationships</div>
            </div>
            
            {nodes.length > 0 && (
              <button
                onClick={() => {
                  const flowEl = document.querySelector('.react-flow');
                  if (!flowEl) return;
                  toPng(flowEl, { backgroundColor: '#1a1b1f', pixelRatio: 2 })
                    .then((dataUrl) => {
                      const link = document.createElement('a');
                      link.download = `knowledge-graph-${Date.now()}.png`;
                      link.href = dataUrl;
                      link.click();
                    })
                    .catch((err) => console.error('Failed to download graph', err));
                }}
                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-md graph-download-btn"
                title="Download Graph as PNG"
              >
                <Download size={16} /> Download as Image
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 bg-[#1a1b1f] rounded-2xl shadow-[inset_0_0_100px_rgba(0,0,0,0.5)] border border-slate-800 overflow-hidden relative">
          {!activeDoc ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Database size={48} className="mb-4 opacity-50 text-sky-400" />
               <p className="text-lg font-medium text-slate-400">No document selected.</p>
               <p className="text-sm mt-2">Select a document above to explore its mind map.</p>
             </div>
          ) : !activeQuery ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Network size={48} className="mb-4 opacity-50 text-slate-500" />
               <p className="text-lg font-medium text-slate-400">Select a Query</p>
               <p className="text-sm mt-2">Click on a question in the sidebar to dynamically generate its Knowledge Graph.</p>
             </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full text-sky-400 font-medium animate-pulse">
              Extracting graph entities on the fly...
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Network size={48} className="mb-4 opacity-50 text-slate-500" />
               <p className="text-lg font-medium text-slate-400">Graph is empty.</p>
               <p className="text-sm mt-2 text-center max-w-md">No entities were extracted for this specific query context.</p>
            </div>
          ) : (
            <ReactFlow 
              nodes={nodes} 
              edges={edges} 
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              className="bg-[#1a1b1f]"
            >
              <Background color="#334155" gap={24} size={2} />
              <Controls className="!bg-slate-800 dark:!bg-slate-800 !border-slate-700 [&>button]:!border-b-slate-700 [&>button>svg]:!fill-slate-300 hover:[&>button]:!bg-slate-700" />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
};

const GraphScreen = (props) => (
  <ReactFlowProvider>
    <GraphScreenContent {...props} />
  </ReactFlowProvider>
);

// --- APP LAYOUT ---

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === '1');
  const [showSettings, setShowSettings] = useState(false);
  
  // UNIFIED AI STATE
  const [lastQuery, setLastQuery] = useState('');
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);

  const fetchDocuments = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const res = await axios.get(`/api/documents?t=${new Date().getTime()}`);
        setDocuments(res.data.documents);
      } catch (e) {
        console.error("Failed to load documents", e);
      }
    }
  }, [isAuthenticated]);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('username');
    const savedRole = localStorage.getItem('role') || 'user';
    if (token && user) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      setIsAuthenticated(true);
      setUsername(user);
      setRole(savedRole);
    }
  }, []);

  // Fetch chat sessions when authenticated
  useEffect(() => {
    const fetchSessions = async () => {
      if (isAuthenticated) {
        try {
          const res = await axios.get('/api/chat/sessions');
          setSessions(res.data.sessions);
          if (res.data.sessions.length > 0 && !currentSessionId) {
            setCurrentSessionId(res.data.sessions[0].id);
          }
        } catch (e) {
          console.error("Failed to load sessions", e);
        }
      }
    };
    
    fetchSessions();
    fetchDocuments();
  }, [isAuthenticated, fetchDocuments]);

  // Fetch messages when currentSessionId changes
  useEffect(() => {
    const fetchHistory = async () => {
      if (isAuthenticated && currentSessionId) {
        try {
          const res = await axios.get(`/api/chat/history/${currentSessionId}`);
          setMessages(res.data.messages);
        } catch (e) {
          console.error("Failed to load history", e);
        }
      } else {
        setMessages([]);
      }
    };
    fetchHistory();
  }, [currentSessionId, isAuthenticated]);

  const handleLogin = (user, userRole) => {
    setIsAuthenticated(true);
    setUsername(user);
    setRole(userRole);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('role');
    delete axios.defaults.headers.common['Authorization'];
    setIsAuthenticated(false);
    setUsername('');
    setRole('user');
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([]);
    setLastQuery('');
    setDocuments([]);
  };

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  return (
    <Router>
      <div className={`flex h-screen font-sans selection:bg-sky-200 ${darkMode ? 'dark bg-slate-900' : 'bg-[#F8FAFC]'}`}>
        
        {showSettings && (
          <SettingsPanel
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Sidebar Navigation */}
        <aside className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col shadow-sm z-10 relative">
          
          <div className="p-6 pb-5 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 text-slate-900 dark:text-white font-bold text-lg tracking-tight">
              <img src={logoImg} alt="Logo" className="w-10 h-10 rounded-xl shadow-md object-cover" />
              <span>ArchiveMind <span className="text-sky-500">AI</span></span>
            </div>
          </div>
          
          <nav className="flex-1 p-4 space-y-1.5">
            <SidebarLink to="/" icon={LayoutDashboard}>Dashboard</SidebarLink>
            {role === 'admin' && (
              <SidebarLink to="/upload" icon={UploadCloud}>Ingest Documents</SidebarLink>
            )}
            <SidebarLink to="/chat" icon={MessageSquare}>Semantic Chat</SidebarLink>
            <SidebarLink to="/graph" icon={Network}>Knowledge Graph</SidebarLink>
          </nav>
          
          <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-400 flex items-center justify-center border border-sky-200 dark:border-sky-700 font-bold uppercase">
                {username.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{username}</p>
                <p className="text-xs text-emerald-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowSettings(true)} className="text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 transition-colors p-2 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/30" title="Settings">
                <Settings size={20} />
              </button>
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20" title="Logout">
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto dark:bg-slate-900 dark:text-slate-100">
          <Routes>
            <Route path="/" element={
              role === 'admin' 
              ? <Dashboard username={username} documents={documents} sessions={sessions} setSessions={setSessions} setCurrentSessionId={setCurrentSessionId} fetchDocuments={fetchDocuments} />
              : <UserDashboard username={username} documents={documents} sessions={sessions} setSessions={setSessions} setCurrentSessionId={setCurrentSessionId} />
            } />
            <Route path="/upload" element={role === 'admin' ? <UploadScreen onUploadSuccess={fetchDocuments} documents={documents} /> : <div className="p-10 text-xl font-bold text-red-400">Access Denied: Admin Only</div>} />
            <Route path="/chat" element={
              <ChatScreen 
                sessions={sessions} 
                setSessions={setSessions}
                currentSessionId={currentSessionId}
                setCurrentSessionId={setCurrentSessionId}
                messages={messages} 
                setMessages={setMessages} 
                setLastQuery={setLastQuery}
                documents={documents}
              />
            } />
            <Route path="/graph" element={
              <GraphScreen 
                messages={messages} 
                currentSessionId={currentSessionId} 
                documents={documents} 
                sessions={sessions}
                allSessions={sessions}
              />
            } />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
