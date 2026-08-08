import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UploadCloud, MessageSquare, Network, FileText, Database, Shield, LogOut, Key, User, ArrowRight, Plus, Trash2, MessageCircle, Pencil, Check, ChevronDown, CheckCircle, BrainCircuit, ChevronRight, Copy, Activity, Tag, Clock, Download } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { ReactFlow, Controls, Background, Handle, Position, MarkerType, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import logoImg from './assets/logo.jpg';

// Configure Axios Base URL dynamically
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
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

const SidebarLink = ({ to, icon: Icon, children }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  return (
    <Link to={to} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
      isActive 
        ? 'bg-sky-50 text-sky-600 border border-sky-200' 
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
    }`}>
      <Icon size={20} className={isActive ? 'text-sky-600' : 'text-slate-500'} />
      <span className="font-medium text-sm tracking-wide">{children}</span>
    </Link>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [impactProfile, setImpactProfile] = useState('');
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

  const handleAsk = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate('/chat', { state: { initialQuery: searchQuery } });
    }
  };

  const handleImpactCheck = (e) => {
    e.preventDefault();
    if (impactProfile.trim()) {
      navigate('/chat', { state: { initialQuery: `How do current policies affect me? I am a: ${impactProfile}` } });
    }
  };

  const handlePillClick = (profile) => {
    navigate('/chat', { state: { initialQuery: `How do current policies affect me? I am a: ${profile}` } });
  };

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
      {/* Hero Search */}
      <div className="text-center mt-10 mb-12">
         <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-50 border border-sky-200 text-sky-500 mb-6 shadow-sm">
            <Network size={32} />
         </div>
         <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-6">Public Knowledge Portal</h1>
         
         <form onSubmit={handleAsk} className="relative max-w-2xl mx-auto">
           <input 
             type="text"
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
             placeholder="Ask any question about government policies..."
             className="w-full bg-white border-2 border-sky-200 text-slate-900 rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:border-sky-500 shadow-sm text-lg placeholder-slate-400"
           />
           <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 bg-sky-500 text-white p-2.5 rounded-xl hover:bg-sky-600 transition-colors">
             <ArrowRight size={20} />
           </button>
         </form>
      </div>

      {/* Feature 1: Impact Checker */}
      <div className="bg-sky-50 rounded-3xl p-8 border border-sky-200 shadow-sm mb-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-2 flex items-center gap-3"><User className="text-emerald-500"/> Personalized Impact Checker</h2>
        <p className="text-slate-600 mb-6">Find out exactly how current policies affect your specific situation.</p>
        
        <form onSubmit={handleImpactCheck} className="flex gap-4 mb-4">
          <input 
            type="text"
            value={impactProfile}
            onChange={e => setImpactProfile(e.target.value)}
            placeholder="Tell us about yourself (e.g. I am a small business owner, I am a teacher)..."
            className="flex-1 bg-white border border-slate-300 text-slate-900 rounded-xl py-3 pl-4 pr-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder-slate-400"
          />
          <button type="submit" className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-600 transition-colors whitespace-nowrap shadow-sm">
            Check Impact
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-400 font-medium">Quick Select:</span>
          {['Student', 'Small Business Owner', 'Farmer', 'Senior Citizen'].map(pill => (
            <button key={pill} onClick={() => handlePillClick(pill)} className="bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 border border-slate-200 hover:border-emerald-300 px-3 py-1.5 rounded-lg transition-colors">
              {pill}
            </button>
          ))}
        </div>
      </div>

      {/* Feature 2: AI Recommendations Hub */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3"><Tag className="text-purple-500"/> Recommended For You</h2>
        {loadingRecs ? (
          <div className="text-slate-400 flex items-center gap-2 animate-pulse"><div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div> AI is analyzing your history...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendations.map((topic, i) => (
              <div key={i} onClick={() => handleTopicClick(topic)} className="bg-white rounded-2xl p-6 border border-slate-200 hover:border-sky-300 transition-all cursor-pointer shadow-sm hover:shadow-md group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-purple-200 group-hover:bg-purple-400 transition-colors"></div>
                <h3 className="text-lg font-bold text-slate-900 group-hover:text-purple-500 transition-colors mb-2 pr-6">{topic}</h3>
                <p className="text-sm text-slate-600">Click to explore policies related to this topic.</p>
                <ArrowRight size={18} className="absolute right-6 top-6 text-slate-400 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Directory */}
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3"><FileText className="text-sky-500"/> Available Policy Directory</h2>
      {documents.length === 0 ? (
         <div className="text-center py-10 text-slate-400">No documents are currently available. Check back later.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {documents.map((doc, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-slate-200 hover:border-sky-300 transition-all hover:-translate-y-1 shadow-sm hover:shadow-md flex flex-col group">
              <h3 className="text-lg font-bold text-slate-900 mb-3 group-hover:text-sky-500 transition-colors">{doc.filename}</h3>
              <p className="text-sm text-slate-600 mb-6 flex-1 leading-relaxed">{doc.summary || "No summary available for this document."}</p>
              <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
                <button onClick={() => handleQuickJump(doc, '/chat')} className="flex-1 bg-sky-50 hover:bg-sky-100 text-sky-600 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-sky-200">
                  <MessageSquare size={16} /> Chat
                </button>
                <button onClick={() => handleQuickJump(doc, '/graph')} className="flex-1 bg-purple-50 hover:bg-purple-100 text-purple-600 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-purple-200">
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

  // Aggregate Top Entities
  const entityCounts = {};
  let totalEntities = 0;
  
  documents.forEach(doc => {
    try {
      const entities = JSON.parse(doc.key_entities || "[]");
      entities.forEach(e => {
        const cleanEntity = e.trim();
        if (cleanEntity) {
          entityCounts[cleanEntity] = (entityCounts[cleanEntity] || 0) + 1;
          totalEntities++;
        }
      });
    } catch(err) {}
  });
  
  const topEntities = Object.entries(entityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

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
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Welcome back, {username}</h1>
          <p className="text-slate-600 mt-2 text-lg">Your intelligent government policy assistant is ready.</p>
        </div>
      </div>
      
      {/* TOP STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><FileText size={64} /></div>
          <p className="text-sm text-slate-600 font-semibold tracking-wider uppercase mb-1">Documents Ingested</p>
          <p className="text-4xl font-bold text-slate-900">{documents.length}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><MessageCircle size={64} /></div>
          <p className="text-sm text-slate-600 font-semibold tracking-wider uppercase mb-1">Chat Sessions</p>
          <p className="text-4xl font-bold text-slate-900">{sessions.length}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] text-slate-900"><Network size={64} /></div>
          <p className="text-sm text-slate-600 font-semibold tracking-wider uppercase mb-1">Entities Mapped</p>
          <p className="text-4xl font-bold text-emerald-500">{totalEntities}</p>
        </div>
      </div>
      
      {/* MIDDLE ROW: Docs & Concepts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
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
                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex justify-between items-center hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="bg-sky-50 text-sky-500 p-2 rounded-lg border border-sky-100">
                      <FileText size={20} />
                    </div>
                    <div>
                      <p className="text-slate-900 font-medium">{doc.filename}</p>
                      <p className="text-xs text-slate-400 mt-1">{new Date(doc.created_at).toLocaleDateString()} • Graph Extracted</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleQuickJump(doc, '/chat')}
                      className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-colors"
                      title="Semantic Chat"
                    >
                      <MessageSquare size={18} />
                    </button>
                    <button 
                      onClick={() => handleQuickJump(doc, '/graph')}
                      className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-colors"
                      title="Knowledge Graph"
                    >
                      <Network size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-2 border border-slate-200 hover:border-red-200"
                      title="Delete Document"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Tag size={18} className="text-sky-500"/> Top Extracted Concepts
          </h3>
          {topEntities.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <p className="text-sm text-center">Upload documents to build<br/>your Knowledge Graph.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-wrap content-start gap-2">
              {topEntities.map((e, idx) => (
                <span key={idx} className="bg-sky-50 text-sky-600 border border-sky-200 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-sky-100 transition-colors cursor-default">
                  {e[0]} <span className="opacity-50 ml-1 text-xs">×{e[1]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* BOTTOM STATUS BAR */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">System Health</h3>
        <div className="flex flex-wrap gap-4">
          {[
            { title: 'Vector Database', value: 'Pinecone Connected', icon: Database, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200' },
            { title: 'Graph Database', value: 'Neo4j Connected', icon: Network, color: 'text-sky-500', bg: 'bg-sky-50', border: 'border-sky-200' },
            { title: 'LLM Engine', value: 'Groq Ready', icon: Shield, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-200' },
          ].map((stat, i) => (
            <div key={i} className={`bg-white px-4 py-3 rounded-xl border ${stat.border} flex items-center gap-3`}>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={16} className={stat.color} />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">{stat.title}</p>
                <p className="text-sm font-bold text-slate-900">{stat.value}</p>
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
      setFile(null); // Reset file input visually if needed, though uncontrolled here
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
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
          <UploadCloud className="text-sky-500" /> Document Ingestion
        </h2>
        <p className="text-slate-600 mb-8 leading-relaxed">Upload documents (.pdf, .docx, .pptx, .txt, .csv, .md) to vectorize them into Pinecone and extract Graph entities to Neo4j.</p>
        
        <div className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center bg-slate-50/50 hover:border-sky-400 hover:bg-sky-50/30 transition-all">
          <input 
            type="file" 
            accept=".pdf,.docx,.pptx,.txt,.csv,.md" 
            onChange={(e) => setFile(e.target.files[0])} 
            className="mb-8 block w-full text-sm text-slate-600 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-600 hover:file:bg-sky-100 cursor-pointer" 
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

      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
          <Clock className="text-sky-500" /> Recent Uploads
        </h3>
        {documents && documents.length > 0 ? (
          <div className="space-y-3">
            {documents.slice(0, 5).map((doc, i) => (
              <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex justify-between items-center hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-sky-50 text-sky-500 p-2 rounded-lg border border-sky-100">
                    <FileText size={20} />
                  </div>
                  <div>
                    <p className="text-slate-900 font-medium">{doc.filename}</p>
                    <p className="text-xs text-slate-400 mt-1">{new Date(doc.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleQuickDelete(doc.id)}
                  disabled={deletingDocs[doc.id]}
                  className="px-3 py-1.5 text-sm text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200 font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete Document"
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

const ChatMessage = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className={`mb-5 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`group relative px-4 py-3 rounded-2xl max-w-[80%] leading-relaxed ${
        message.role === 'user'
          ? 'bg-sky-500 text-white rounded-tr-sm shadow-md break-words whitespace-pre-wrap'
          : 'bg-white text-slate-800 rounded-tl-sm border border-slate-200 shadow-sm prose prose-slate prose-sm max-w-none break-words min-w-0 prose-chat'
      }`}>
        {message.role === 'user' ? message.content : <ReactMarkdown components={{ code: CodeBlock }}>{message.content}</ReactMarkdown>}
        <button
          onClick={handleCopy}
          className={`absolute -bottom-3 ${message.role === 'user' ? 'right-2' : 'left-2'} opacity-0 group-hover:opacity-100 transition-all bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-sky-500 p-1.5 rounded-lg`}
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
  const editInputRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const selectedDocId = currentSession?.doc_id || '';

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingSessionId]);

  const handleCreateChat = async () => {
    try {
      const res = await axios.post('/api/chat/sessions', { title: "New Chat" });
      setSessions(prev => [res.data, ...prev]);
      setCurrentSessionId(res.data.id);
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
      
      // Fetch sessions again to update the title if it auto-generated on first message
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

  useEffect(() => {
    if (location.state?.initialQuery) {
      const query = location.state.initialQuery;
      // Clear state to avoid loops
      navigate(location.pathname, { replace: true, state: {} });
      performSend(query);
    }
  }, [location.state, currentSessionId, navigate]);

  const sendMessage = (e) => {
    e.preventDefault();
    performSend(input.trim());
  };

  const activeDocName = documents.find(d => d.id === selectedDocId)?.filename;

  return (
    <div className="h-full flex animate-fade-in">
      {/* Sessions Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <button 
            onClick={handleCreateChat}
            className="w-full flex items-center justify-center gap-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-600 py-2.5 rounded-xl font-medium transition-all"
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
                  ? 'bg-sky-50 border border-sky-200 text-sky-600' 
                  : 'text-slate-500 hover:bg-slate-50 border border-transparent hover:text-slate-700'
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
                    className="flex-1 bg-white text-slate-900 text-sm border-none rounded px-2 py-1 outline-none ring-1 ring-sky-500 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-sm font-medium truncate">{session.title}</span>
                )}
              </div>
              
              {!editingSessionId && (
                <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${currentSessionId === session.id ? 'opacity-100' : ''}`}>
                  <button 
                    onClick={(e) => startEditing(session, e)}
                    className="text-slate-400 hover:text-sky-500 transition-colors p-1 rounded-md hover:bg-sky-50"
                    title="Rename chat"
                  >
                    <Pencil size={14} />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteChat(session.id, e)}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50"
                    title="Delete chat"
                  >
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
      <div className="flex-1 p-8 flex flex-col max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="text-sky-500" /> Semantic Chatbot
            {activeDocName && <span className="text-sm font-normal text-slate-500 ml-3 bg-slate-100 px-3 py-1 rounded-full">{activeDocName}</span>}
          </h2>
        </div>
        
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-y-auto overflow-x-hidden mb-6 flex flex-col custom-scrollbar">
          
          {selectedDocId && (
            <div className="mb-8 p-5 bg-sky-50 border border-sky-200 rounded-2xl shadow-sm">
              <h3 className="text-lg font-bold text-sky-600 mb-2 flex items-center gap-2">
                <FileText size={20} /> Document Overview
              </h3>
              <p className="text-slate-700 text-sm leading-relaxed mb-4">
                {documents.find(d => d.id === selectedDocId)?.summary}
              </p>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Key Entities</h4>
                <div className="flex flex-wrap gap-2">
                  {JSON.parse(documents.find(d => d.id === selectedDocId)?.key_entities || "[]").map((entity, idx) => (
                    <span key={idx} className="bg-white border border-slate-200 text-slate-600 text-xs px-2.5 py-1 rounded-md">
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(!currentSessionId || messages.length === 0) && !selectedDocId && (
            <div className="m-auto text-center">
              <div className="w-16 h-16 bg-sky-50 border border-sky-200 text-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
                <MessageSquare size={32} />
              </div>
              {documents.length === 0 ? (
                <p className="text-slate-700 font-semibold text-lg">Upload a document to start chatting</p>
              ) : (
                <>
                  <p className="text-slate-700 font-semibold text-lg">Ask a question about the uploaded documents...</p>
                  <p className="text-slate-500 text-sm mt-2">Example: "What is the PM Vishwakarma scheme?"</p>
                </>
              )}
            </div>
          )}
          
          {messages.map((m, i) => <ChatMessage key={i} message={m} />)}
          
          {loading && <div className="text-sky-500 animate-pulse font-medium flex items-center gap-2 bg-white w-fit p-4 rounded-2xl rounded-tl-sm border border-slate-200 shadow-sm">
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>}
        </div>

        <form onSubmit={sendMessage} className="flex gap-4">
          <input 
            type="text" 
            value={input} 
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..." 
            className="flex-1 bg-slate-50 border border-slate-300 text-slate-900 rounded-xl px-6 py-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder-slate-400 shadow-sm"
          />
          <button type="submit" disabled={loading} className="bg-sky-500 text-white px-8 py-4 rounded-xl font-semibold tracking-wide hover:bg-sky-600 disabled:opacity-50 transition-colors shadow-md">
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

const GraphScreenContent = ({ messages, currentSessionId, documents, sessions }) => {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeQuery, setActiveQuery] = useState(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const activeDocId = currentSession?.doc_id;
  const activeDoc = documents.find(d => d.id === activeDocId);
  
  // Deduplicate user queries (ignoring minor word differences, punctuation, and case)
  const normalizeQuery = (q) => {
    return q.toLowerCase()
      .replace(/[^\w\s]/gi, '') // remove punctuation
      .replace(/\b(what|is|are|the|a|an|of|in|to|for|with|on|at|by|can|you|give|me|us|please|tell)\b/g, '') // remove stop words
      .replace(/\s+/g, ' ') // compress spaces
      .trim();
  };

  const uniqueQueries = [];
  const seenNormalized = new Set();
  
  messages.filter(m => m.role === 'user').forEach(m => {
    const norm = normalizeQuery(m.content);
    // If the query reduces to nothing (e.g. they literally just typed "what is"), fallback to exact lowercase
    const checkVal = norm.length > 0 ? norm : m.content.toLowerCase().trim();
    
    if (!seenNormalized.has(checkVal)) {
      seenNormalized.add(checkVal);
      uniqueQueries.push(m);
    }
  });

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
        doc_id: activeDocId 
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
      {/* Sidebar for Query History */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-500 text-sm tracking-wide uppercase flex items-center gap-2">
            <MessageSquare size={16} className="text-sky-500" /> Query History
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {!currentSessionId ? (
            <div className="text-center p-4 text-sm text-slate-500">No active chat session.</div>
          ) : uniqueQueries.length === 0 ? (
            <div className="text-center p-4 text-sm text-slate-500">No questions asked in this session yet.</div>
          ) : (
            uniqueQueries.map((m, i) => (
              <div 
                key={i} 
                onClick={() => handleQueryClick(m.content)}
                className={`p-3 rounded-xl cursor-pointer transition-all text-sm ${
                  activeQuery === m.content 
                    ? 'bg-sky-50 border border-sky-200 text-sky-600 shadow-sm' 
                    : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Network className="text-sky-500" /> Mind Map Explorer
            </h2>
            <p className="text-slate-500 mt-2">
              {activeDoc ? `Visualizing knowledge graph for: ${activeDoc.filename}` : 'Please select a document in Semantic Chat to view its graph.'}
            </p>
          </div>
          
          <div className="flex gap-4 items-center">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-sm text-slate-600 flex gap-5 items-center">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-sky-100 border border-sky-400"></div> Entities</div>
              <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-sky-400"></div> Relationships</div>
            </div>
            
            {nodes.length > 0 && (
              <button
                onClick={() => {
                  const flowEl = document.querySelector('.react-flow');
                  if (!flowEl) return;
                  const svgEl = flowEl.querySelector('svg.react-flow__viewport, svg');
                  if (!svgEl) return;
                  const svgClone = svgEl.cloneNode(true);
                  svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                  const { width, height } = flowEl.getBoundingClientRect();
                  svgClone.setAttribute('width', width);
                  svgClone.setAttribute('height', height);
                  const svgData = new XMLSerializer().serializeToString(svgClone);
                  const canvas = document.createElement('canvas');
                  const scale = 2;
                  canvas.width = width * scale;
                  canvas.height = height * scale;
                  const ctx = canvas.getContext('2d');
                  ctx.scale(scale, scale);
                  const img = new Image();
                  img.onload = () => {
                    ctx.fillStyle = '#1a1b1f';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    const link = document.createElement('a');
                    link.download = `knowledge-graph-${Date.now()}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                  };
                  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
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
               <p className="text-sm mt-2">Go to Semantic Chat and select a document to explore its mind map.</p>
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
              <Controls className="!bg-slate-800 !border-slate-700 !fill-slate-300" />
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
  const [role, setRole] = useState('user'); // admin or user
  
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
      <div className="flex h-screen bg-[#F8FAFC] font-sans selection:bg-sky-200">
        {/* Sidebar Navigation */}
        <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-10 relative">
          
          <div className="p-6 pb-5 border-b border-slate-200">
            <div className="flex items-center gap-3 text-slate-900 font-bold text-lg tracking-tight">
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
          
          <div className="p-6 border-t border-slate-200 flex justify-between items-center bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center border border-sky-200 font-bold uppercase">
                {username.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{username}</p>
                <p className="text-xs text-emerald-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
                </p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50">
              <LogOut size={20} />
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
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
              />
            } />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
