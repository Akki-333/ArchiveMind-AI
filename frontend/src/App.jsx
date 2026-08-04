import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UploadCloud, MessageSquare, Network, FileText, Database, Shield, LogOut, Key, User, ArrowRight, Plus, Trash2, MessageCircle, Pencil, Check, ChevronDown, CheckCircle, BrainCircuit, ChevronRight, Copy, Activity, Tag, Clock } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { ReactFlow, Controls, Background, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

// --- CUSTOM REACT FLOW NODE ---
const CustomEntityNode = ({ data }) => {
  return (
    <div className="px-5 py-2 shadow-[0_0_20px_rgba(59,130,246,0.3)] border border-blue-500/80 bg-slate-900 rounded-xl text-slate-100 font-semibold text-sm text-center min-w-[120px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-blue-400 !border-slate-900" />
      {data.label}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-blue-400 !border-slate-900" />
    </div>
  );
};
const nodeTypes = { entity: CustomEntityNode };

// --- DAGRE AUTO-LAYOUT ---
const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const nodeWidth = 150;
  const nodeHeight = 50;
  
  dagreGraph.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });
  
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  
  dagre.layout(dagreGraph);
  
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: direction === 'TB' ? 'top' : 'left',
      sourcePosition: direction === 'TB' ? 'bottom' : 'right',
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
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
        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
    }`}>
      <Icon size={20} className={isActive ? 'text-blue-400' : 'text-slate-500'} />
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
      const response = await axios.post(`http://127.0.0.1:8000${endpoint}`, payload);
      
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
    <div className="min-h-screen flex items-center justify-center bg-[#0f172a] font-sans selection:bg-blue-500/30">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px]"></div>
      </div>
      
      <div className="w-full max-w-md p-8 bg-[#1e293b] rounded-3xl shadow-2xl border border-slate-700/50 relative z-10 animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-4 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <Network size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ArchiveMind AI</h1>
          <p className="text-slate-400 mt-2 text-sm">{isLogin ? 'Welcome back. Please sign in.' : 'Create your account to begin.'}</p>
        </div>

        {error && (
          <div className={`p-4 rounded-xl text-sm font-medium mb-6 text-center border ${
            error.includes('successful') 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
            : 'bg-red-500/10 text-red-400 border-red-500/20'
          }`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Username</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-600 text-white rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder-slate-600 shadow-inner"
                placeholder="Enter username"
                required
              />
            </div>
          </div>
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Account Role</label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-600 text-white rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-inner appearance-none cursor-pointer"
                >
                  <option value="user">Citizen (Read-Only Portal)</option>
                  <option value="admin">Government Official (Admin)</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0f172a] border border-slate-600 text-white rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder-slate-600 shadow-inner"
                placeholder="Enter password"
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-bold tracking-wide hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-[0_0_20px_rgba(37,99,235,0.3)] mt-2 flex items-center justify-center gap-2 group"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
            {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-400 text-sm">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              onClick={() => {setIsLogin(!isLogin); setError('');}} 
              className="text-blue-400 font-semibold ml-2 hover:text-blue-300 transition-colors"
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
        const res = await axios.get('http://127.0.0.1:8000/api/chat/recommendations');
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
        const res = await axios.post('http://127.0.0.1:8000/api/chat/sessions', { title: title, doc_id: doc.id });
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
         <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-6 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <Network size={32} />
         </div>
         <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-6">Public Knowledge Portal</h1>
         
         <form onSubmit={handleAsk} className="relative max-w-2xl mx-auto">
           <input 
             type="text"
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
             placeholder="Ask any question about government policies..."
             className="w-full bg-[#1e293b] border-2 border-blue-500/30 text-white rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)] text-lg placeholder-slate-500"
           />
           <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-500 transition-colors">
             <ArrowRight size={20} />
           </button>
         </form>
      </div>

      {/* Feature 1: Impact Checker */}
      <div className="bg-[#1e293b] rounded-3xl p-8 border border-slate-700/50 shadow-xl mb-12">
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-3"><User className="text-emerald-400"/> Personalized Impact Checker</h2>
        <p className="text-slate-400 mb-6">Find out exactly how current policies affect your specific situation.</p>
        
        <form onSubmit={handleImpactCheck} className="flex gap-4 mb-4">
          <input 
            type="text"
            value={impactProfile}
            onChange={e => setImpactProfile(e.target.value)}
            placeholder="Tell us about yourself (e.g. I am a small business owner, I am a teacher)..."
            className="flex-1 bg-[#0f172a] border border-slate-600 text-white rounded-xl py-3 pl-4 pr-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder-slate-500"
          />
          <button type="submit" className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors whitespace-nowrap">
            Check Impact
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500 font-medium">Quick Select:</span>
          {['Student', 'Small Business Owner', 'Farmer', 'Senior Citizen'].map(pill => (
            <button key={pill} onClick={() => handlePillClick(pill)} className="bg-slate-800 text-slate-300 hover:bg-emerald-500/20 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/30 px-3 py-1.5 rounded-lg transition-colors">
              {pill}
            </button>
          ))}
        </div>
      </div>

      {/* Feature 2: AI Recommendations Hub */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3"><Tag className="text-purple-400"/> Recommended For You</h2>
        {loadingRecs ? (
          <div className="text-slate-500 flex items-center gap-2 animate-pulse"><div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div> AI is analyzing your history...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendations.map((topic, i) => (
              <div key={i} onClick={() => handleTopicClick(topic)} className="bg-[#1e293b] rounded-2xl p-6 border border-slate-700/50 hover:border-purple-500/40 hover:bg-[#253247] transition-all cursor-pointer shadow-lg group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50 group-hover:bg-purple-400 transition-colors"></div>
                <h3 className="text-lg font-bold text-slate-200 group-hover:text-purple-400 transition-colors mb-2 pr-6">{topic}</h3>
                <p className="text-sm text-slate-400">Click to explore policies related to this topic.</p>
                <ArrowRight size={18} className="absolute right-6 top-6 text-slate-600 group-hover:text-purple-400 group-hover:translate-x-1 transition-all" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Directory */}
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3"><FileText className="text-blue-400"/> Available Policy Directory</h2>
      {documents.length === 0 ? (
         <div className="text-center py-10 text-slate-500">No documents are currently available. Check back later.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {documents.map((doc, i) => (
            <div key={i} className="bg-[#1e293b] rounded-2xl p-6 border border-slate-700/50 hover:border-blue-500/30 transition-all hover:-translate-y-1 shadow-lg flex flex-col group">
              <h3 className="text-lg font-bold text-slate-200 mb-3 group-hover:text-blue-400 transition-colors">{doc.filename}</h3>
              <p className="text-sm text-slate-400 mb-6 flex-1 leading-relaxed">{doc.summary || "No summary available for this document."}</p>
              <div className="flex items-center gap-3 pt-4 border-t border-slate-700/50">
                <button onClick={() => handleQuickJump(doc, '/chat')} className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-blue-500/20">
                  <MessageSquare size={16} /> Chat
                </button>
                <button onClick={() => handleQuickJump(doc, '/graph')} className="flex-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 py-2.5 rounded-xl font-medium text-sm transition-colors flex justify-center items-center gap-2 border border-purple-500/20">
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
        const res = await axios.post('http://127.0.0.1:8000/api/chat/sessions', { title: title, doc_id: doc.id });
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
        await axios.delete(`http://127.0.0.1:8000/api/documents/${docId}`);
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
          <h1 className="text-3xl font-bold text-white tracking-tight">Welcome back, {username}</h1>
          <p className="text-slate-400 mt-2 text-lg">Your intelligent government policy assistant is ready.</p>
        </div>
      </div>
      
      {/* TOP STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow-lg border border-slate-700/50 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><FileText size={64} /></div>
          <p className="text-sm text-slate-400 font-semibold tracking-wider uppercase mb-1">Documents Ingested</p>
          <p className="text-4xl font-bold text-white">{documents.length}</p>
        </div>
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow-lg border border-slate-700/50 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><MessageCircle size={64} /></div>
          <p className="text-sm text-slate-400 font-semibold tracking-wider uppercase mb-1">Chat Sessions</p>
          <p className="text-4xl font-bold text-white">{sessions.length}</p>
        </div>
        <div className="bg-[#1e293b] p-6 rounded-2xl shadow-lg border border-slate-700/50 flex flex-col relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Network size={64} /></div>
          <p className="text-sm text-slate-400 font-semibold tracking-wider uppercase mb-1">Entities Mapped</p>
          <p className="text-4xl font-bold text-emerald-400">{totalEntities}</p>
        </div>
      </div>
      
      {/* MIDDLE ROW: Docs & Concepts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-[#1e293b] rounded-2xl shadow-xl border border-slate-700/50 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Clock size={18} className="text-blue-400"/> Recent Documents
          </h3>
          {recentDocs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-8">
              <FileText size={48} className="opacity-20 mb-3" />
              <p>No documents uploaded yet.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-3">
              {recentDocs.map((doc, i) => (
                <div key={i} className="bg-[#0f172a] border border-slate-700 p-4 rounded-xl flex justify-between items-center hover:border-slate-600 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-500/10 text-blue-400 p-2 rounded-lg">
                      <FileText size={20} />
                    </div>
                    <div>
                      <p className="text-slate-200 font-medium">{doc.filename}</p>
                      <p className="text-xs text-slate-500 mt-1">{new Date(doc.created_at).toLocaleDateString()} • Graph Extracted</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleQuickJump(doc, '/chat')}
                      className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      title="Semantic Chat"
                    >
                      <MessageSquare size={18} />
                    </button>
                    <button 
                      onClick={() => handleQuickJump(doc, '/graph')}
                      className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      title="Knowledge Graph"
                    >
                      <Network size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ml-2 border border-slate-700 hover:border-red-500/30"
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
        
        <div className="bg-[#1e293b] rounded-2xl shadow-xl border border-slate-700/50 p-6 flex flex-col">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Tag size={18} className="text-blue-400"/> Top Extracted Concepts
          </h3>
          {topEntities.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <p className="text-sm text-center">Upload documents to build<br/>your Knowledge Graph.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-wrap content-start gap-2">
              {topEntities.map((e, idx) => (
                <span key={idx} className="bg-blue-900/20 text-blue-300 border border-blue-500/20 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-900/40 hover:border-blue-500/40 cursor-default transition-colors">
                  {e[0]} <span className="opacity-40 ml-1 text-xs">×{e[1]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* BOTTOM STATUS BAR */}
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">System Health</h3>
        <div className="flex flex-wrap gap-4">
          {[
            { title: 'Vector Database', value: 'Pinecone Connected', icon: Database, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            { title: 'Graph Database', value: 'Neo4j Connected', icon: Network, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
            { title: 'LLM Engine', value: 'Groq Ready', icon: Shield, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
          ].map((stat, i) => (
            <div key={i} className={`bg-[#0f172a] px-4 py-3 rounded-xl border ${stat.border} flex items-center gap-3`}>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={16} className={stat.color} />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">{stat.title}</p>
                <p className="text-sm font-bold text-slate-200">{stat.value}</p>
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
      const response = await axios.post('http://127.0.0.1:8000/api/upload', formData, {
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
      await axios.delete(`http://127.0.0.1:8000/api/documents/${docId}`);
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      setStatus('Error deleting document: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeletingDocs(prev => ({ ...prev, [docId]: false }));
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-4xl mx-auto mt-10">
      <div className="bg-[#1e293b] rounded-2xl shadow-2xl border border-slate-700/50 p-8 mb-8">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <UploadCloud className="text-blue-400" /> Document Ingestion
        </h2>
        <p className="text-slate-400 mb-8 leading-relaxed">Upload documents (.pdf, .docx, .pptx, .txt, .csv, .md) to vectorize them into Pinecone and extract Graph entities to Neo4j.</p>
        
        <div className="border-2 border-dashed border-slate-600 rounded-xl p-12 text-center bg-[#0f172a]/50 hover:border-blue-500/50 hover:bg-[#0f172a] transition-all">
          <input 
            type="file" 
            accept=".pdf,.docx,.pptx,.txt,.csv,.md" 
            onChange={(e) => setFile(e.target.files[0])} 
            className="mb-8 block w-full text-sm text-slate-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/10 file:text-blue-400 hover:file:bg-blue-500/20 cursor-pointer" 
          />
          <button 
            onClick={handleUpload}
            disabled={!file || loading}
            className="bg-blue-600 text-white px-8 py-3 rounded-xl font-semibold tracking-wide hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)]"
          >
            {loading ? 'Processing AI Data...' : 'Upload to Knowledge Base'}
          </button>
        </div>
        {status && (
          <div className={`mt-6 p-4 rounded-xl font-medium text-center border ${status.includes('Error') ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
            {status}
          </div>
        )}
      </div>

      <div className="bg-[#1e293b] rounded-2xl shadow-2xl border border-slate-700/50 p-8">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <Clock className="text-blue-400" /> Recent Uploads
        </h3>
        {documents && documents.length > 0 ? (
          <div className="space-y-3">
            {documents.slice(0, 5).map((doc, i) => (
              <div key={i} className="bg-[#0f172a] border border-slate-700 p-4 rounded-xl flex justify-between items-center hover:border-slate-600 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-500/10 text-blue-400 p-2 rounded-lg">
                    <FileText size={20} />
                  </div>
                  <div>
                    <p className="text-slate-200 font-medium">{doc.filename}</p>
                    <p className="text-xs text-slate-500 mt-1">{new Date(doc.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleQuickDelete(doc.id)}
                  disabled={deletingDocs[doc.id]}
                  className="px-3 py-1.5 text-sm text-red-400 hover:text-white bg-red-500/10 hover:bg-red-600 rounded-lg transition-colors border border-red-500/30 font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <p className="text-slate-500">No documents uploaded yet.</p>
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
    <code className="bg-slate-800/60 text-blue-300 px-1.5 py-0.5 rounded text-sm font-mono border border-slate-700/50" {...props}>
      {children}
    </code>
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
      const res = await axios.post('http://127.0.0.1:8000/api/chat/sessions', { title: "New Chat" });
      setSessions(prev => [res.data, ...prev]);
      setCurrentSessionId(res.data.id);
    } catch(err) {
      console.error(err);
    }
  };

  const handleDeleteChat = async (id, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`http://127.0.0.1:8000/api/chat/sessions/${id}`);
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
      await axios.put(`http://127.0.0.1:8000/api/chat/sessions/${id}`, { title: editTitle });
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

  const handleDocChange = async (e) => {
    const newDocId = e.target.value;
    
    // Check if there is an existing session for this document
    const existingSession = sessions.find(s => (s.doc_id || '') === newDocId);
    if (existingSession) {
      setCurrentSessionId(existingSession.id);
      return;
    }
    
    // If no session exists, create a new chat session for the selected document
    const selectedDoc = documents.find(d => d.id === newDocId);
    const title = selectedDoc ? selectedDoc.filename : "Global Search";
    
    try {
      const res = await axios.post('http://127.0.0.1:8000/api/chat/sessions', { title: title, doc_id: newDocId });
      setSessions(prev => [res.data, ...prev]);
      setCurrentSessionId(res.data.id);
    } catch (err) {
      console.error(err);
    }
  };

  const performSend = async (queryText) => {
    if (!queryText.trim()) return;
    
    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
       try {
         const res = await axios.post('http://127.0.0.1:8000/api/chat/sessions', { title: "New Chat" });
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
      const response = await axios.post('http://127.0.0.1:8000/api/chat', payload);
      setMessages(prev => [...prev, { role: 'ai', content: response.data.answer }]);
      
      // Fetch sessions again to update the title if it auto-generated on first message
      if (messages.length === 0) {
        const res = await axios.get('http://127.0.0.1:8000/api/chat/sessions');
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

  return (
    <div className="h-full flex animate-fade-in">
      {/* Sessions Sidebar */}
      <div className="w-64 bg-[#1e293b]/50 border-r border-slate-700/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <button 
            onClick={handleCreateChat}
            className="w-full flex items-center justify-center gap-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-blue-400 py-2.5 rounded-xl font-medium transition-all"
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
                  ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400' 
                  : 'text-slate-400 hover:bg-[#1e293b] border border-transparent hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                <MessageCircle size={16} className="shrink-0" />
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
                    className="flex-1 bg-slate-800 text-white text-sm border-none rounded px-2 py-1 outline-none ring-1 ring-blue-500 min-w-0"
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
                    className="text-slate-500 hover:text-blue-400 transition-colors p-1 rounded-md hover:bg-blue-500/10"
                    title="Rename chat"
                  >
                    <Pencil size={14} />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteChat(session.id, e)}
                    className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-500/10"
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
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="text-blue-400" /> Semantic Chatbot
          </h2>
          
          <div className="relative">
            <select 
              value={selectedDocId} 
              onChange={handleDocChange}
              className="appearance-none bg-[#1e293b] border border-slate-600 text-white rounded-xl py-2 pl-4 pr-10 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-lg text-sm cursor-pointer"
            >
              <option value="">Global Search (All Documents)</option>
              {documents.map(doc => (
                <option key={doc.id} value={doc.id}>{doc.filename}</option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        
        <div className="flex-1 bg-[#1e293b] rounded-2xl shadow-xl border border-slate-700/50 p-6 overflow-y-auto overflow-x-hidden mb-6 flex flex-col custom-scrollbar">
          
          {selectedDocId && (
            <div className="mb-8 p-5 bg-blue-900/10 border border-blue-500/20 rounded-2xl shadow-sm">
              <h3 className="text-lg font-bold text-blue-400 mb-2 flex items-center gap-2">
                <FileText size={20} /> Document Overview
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                {documents.find(d => d.id === selectedDocId)?.summary}
              </p>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Key Entities</h4>
                <div className="flex flex-wrap gap-2">
                  {JSON.parse(documents.find(d => d.id === selectedDocId)?.key_entities || "[]").map((entity, idx) => (
                    <span key={idx} className="bg-[#0f172a] border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-md">
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(!currentSessionId || messages.length === 0) && !selectedDocId && (
            <div className="m-auto text-center">
              <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
                <MessageSquare size={32} />
              </div>
              <p className="text-slate-300 font-semibold text-lg">Ask a question about the uploaded documents...</p>
              <p className="text-slate-500 text-sm mt-2">Example: "What is the PM Vishwakarma scheme?"</p>
            </div>
          )}
          
          {messages.map((m, i) => (
            <div key={i} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`group relative p-4 rounded-2xl max-w-[80%] leading-relaxed ${
                m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-sm shadow-md break-words whitespace-pre-wrap' 
                  : 'bg-[#0f172a] text-slate-300 rounded-tl-sm border border-slate-700 shadow-md prose prose-invert prose-blue max-w-none break-words min-w-0'
              }`}>
                {m.role === 'user' ? m.content : <ReactMarkdown components={{ code: CodeBlock }}>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {loading && <div className="text-blue-400 animate-pulse font-medium flex items-center gap-2 bg-[#0f172a] w-fit p-4 rounded-2xl rounded-tl-sm border border-slate-700">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
          </div>}
        </div>

        <form onSubmit={sendMessage} className="flex gap-4">
          <input 
            type="text" 
            value={input} 
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..." 
            className="flex-1 bg-[#1e293b] border border-slate-600 text-white rounded-xl px-6 py-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder-slate-500 shadow-lg"
          />
          <button type="submit" disabled={loading} className="bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold tracking-wide hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)]">
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

const GraphScreen = ({ messages, currentSessionId, documents, sessions }) => {
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
      const response = await axios.post('http://127.0.0.1:8000/api/graph/highlight', { 
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
        style: { stroke: '#3b82f6', strokeWidth: 2 },
        labelStyle: { fill: '#94a3b8', fontWeight: 600, fontSize: 12 },
        labelBgStyle: { fill: '#0f172a', stroke: '#1e293b', strokeWidth: 1 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#3b82f6',
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
      <div className="w-64 bg-[#1e293b]/50 border-r border-slate-700/50 flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="font-semibold text-slate-300 text-sm tracking-wide uppercase flex items-center gap-2">
            <MessageSquare size={16} className="text-blue-400" /> Query History
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
                    ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.1)]' 
                    : 'bg-[#1e293b] border border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
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
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Network className="text-blue-400" /> Mind Map Explorer
            </h2>
            <p className="text-slate-400 mt-2">
              {activeDoc ? `Visualizing knowledge graph for: ${activeDoc.filename}` : 'Please select a document in Semantic Chat to view its graph.'}
            </p>
          </div>
          
          <div className="bg-[#1e293b] p-3 rounded-xl border border-slate-700/50 shadow-lg text-sm text-slate-300 flex gap-5 items-center">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500/50 border border-blue-400"></div> Entities</div>
            <div className="flex items-center gap-2"><div className="w-5 h-0.5 bg-[#64748B]"></div> Relationships</div>
          </div>
        </div>
        
        <div className="flex-1 bg-[#1a1b1f] rounded-2xl shadow-[inset_0_0_100px_rgba(0,0,0,0.5)] border border-slate-800 overflow-hidden relative">
          {!activeDoc ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Database size={48} className="mb-4 opacity-50 text-blue-400" />
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
            <div className="flex items-center justify-center h-full text-blue-400 font-medium animate-pulse">
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
              <Controls className="!bg-[#1e293b] !border-slate-700 !fill-slate-300" />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
};

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
        const res = await axios.get(`http://127.0.0.1:8000/api/documents?t=${new Date().getTime()}`);
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
          const res = await axios.get('http://127.0.0.1:8000/api/chat/sessions');
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
          const res = await axios.get(`http://127.0.0.1:8000/api/chat/history/${currentSessionId}`);
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
      <div className="flex h-screen bg-[#0f172a] font-sans selection:bg-blue-500/30">
        {/* Sidebar Navigation */}
        <aside className="w-72 bg-[#1e293b] border-r border-slate-700/50 flex flex-col shadow-2xl z-10 relative">
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-slate-600/50 to-transparent"></div>
          
          <div className="p-8 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-4 text-white font-bold text-xl tracking-tight">
              <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                <Network size={24} />
              </div>
              ARCHIVEMIND-AI
            </div>
          </div>
          
          <nav className="flex-1 p-6 space-y-3">
            <SidebarLink to="/" icon={LayoutDashboard}>Dashboard</SidebarLink>
            {role === 'admin' && (
              <SidebarLink to="/upload" icon={UploadCloud}>Ingest Documents</SidebarLink>
            )}
            <SidebarLink to="/chat" icon={MessageSquare}>Semantic Chat</SidebarLink>
            <SidebarLink to="/graph" icon={Network}>Knowledge Graph</SidebarLink>
          </nav>
          
          <div className="p-6 border-t border-slate-800 flex justify-between items-center bg-[#1a2333]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30 font-bold uppercase">
                {username.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{username}</p>
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Online
                </p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-500/10">
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
