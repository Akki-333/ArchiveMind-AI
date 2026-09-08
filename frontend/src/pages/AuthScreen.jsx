import { useState } from 'react';
import { ArrowRight, Key, ShieldCheck, User } from 'lucide-react';

import { errorMessage, login, register, saveSession } from '../api';
import { Spinner } from '../components/common';
import logoImg from '../assets/logo.jpg';

// =============================================================================
// Auth
// =============================================================================
/**
 * The role selector is gone.
 *
 * It used to offer "Government Official (Admin)" as a dropdown, and the server
 * honoured whatever the client sent - so anyone could become an administrator
 * of a government policy archive by picking an option. Roles are now decided
 * entirely server-side: named in ADMIN_USERNAMES, or granted to the first
 * account created on an empty database.
 */
const ACCOUNT_TYPES = [
  { key: 'citizen', label: 'Citizen', hint: 'Read and question the public archive' },
  { key: 'researcher', label: 'Researcher', hint: 'Analyse and compare policy documents' },
  { key: 'official', label: 'Government official', hint: 'Manage the archive with an access code' },
];

export const AuthScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState({
    full_name: '',
    email: '',
    account_type: 'citizen',
    organisation: '',
    designation: '',
    access_code: '',
  });

  const isOfficial = details.account_type === 'official';
  const setDetail = (key, value) => setDetails((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = isLogin
        ? await login(username, password)
        : await register(username, password, details);
      saveSession(data);
      // A downgraded official is told plainly rather than silently handed a
      // reader account they believe is an administrator one.
      if (data.pending_admin_request) window.alert(data.message);
      onLogin(data.username, data.role);
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-sky-50 via-white to-sky-50/30 min-h-screen flex items-center justify-center font-sans p-4">
      <div
        className={`w-full ${
          isLogin ? 'max-w-md' : 'max-w-lg'
        } p-8 bg-white rounded-2xl shadow-xl border border-slate-200 animate-fade-in max-h-[92vh] overflow-y-auto custom-scrollbar`}
      >
        <div className="text-center mb-8">
          <img
            src={logoImg}
            alt="ArchiveMind AI"
            className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-sm border border-slate-200 object-cover"
          />
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            ArchiveMind <span className="text-sky-500">AI</span>
          </h1>
          <p className="text-slate-600 mt-2 text-sm">
            {isLogin ? 'Sign in to explore the policy archive.' : 'Create an account to begin.'}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl text-sm font-medium mb-6 text-center border bg-red-50 text-red-600 border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/*
            Who are you? Asked at sign-up so citizens, researchers and officials
            are distinguishable from the first screen. Note that this chooses a
            *profile*, not a permission: picking "Government official" without a
            valid access code creates a reader account with a pending request.
            The server decides the role either way - see backend/auth.py.
          */}
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                I am signing up as
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ACCOUNT_TYPES.map((type) => (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => setDetail('account_type', type.key)}
                    title={type.hint}
                    className={`px-2 py-2.5 rounded-xl border text-[11px] font-semibold transition-all leading-tight ${
                      details.account_type === type.key
                        ? 'bg-sky-50 border-sky-400 text-sky-700 ring-1 ring-sky-400'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {ACCOUNT_TYPES.find((t) => t.key === details.account_type)?.hint}
              </p>
            </div>
          )}

          {!isLogin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Full name
                </label>
                <input
                  type="text"
                  value={details.full_name}
                  onChange={(e) => setDetail('full_name', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Your name"
                  maxLength={120}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={details.email}
                  onChange={(e) => setDetail('email', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="you@example.com"
                  maxLength={160}
                  required
                />
              </div>
            </div>
          )}

          {!isLogin && (details.account_type !== 'citizen') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {isOfficial ? 'Department' : 'Institution'}
                </label>
                <input
                  type="text"
                  value={details.organisation}
                  onChange={(e) => setDetail('organisation', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder={isOfficial ? 'Ministry or department' : 'University or organisation'}
                  maxLength={160}
                  required={isOfficial}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Designation
                </label>
                <input
                  type="text"
                  value={details.designation}
                  onChange={(e) => setDetail('designation', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Your role or title"
                  maxLength={120}
                />
              </div>
            </div>
          )}

          {!isLogin && isOfficial && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Official access code
              </label>
              <div className="relative">
                <ShieldCheck
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  size={18}
                />
                <input
                  type="password"
                  value={details.access_code}
                  onChange={(e) => setDetail('access_code', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Issued by your administrator"
                  maxLength={128}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                Optional. Without it you can still sign up — your account is created as a
                reader and an administrator can approve official access afterwards.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400"
                placeholder="Your username"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Password
            </label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400"
                placeholder={isLogin ? 'Your password' : 'At least 8 characters, letters and numbers'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3.5 rounded-xl font-bold tracking-wide disabled:opacity-50 transition-colors shadow-md flex items-center justify-center gap-2 group"
          >
            {loading ? <Spinner size={18} /> : isLogin ? 'Sign in' : 'Create account'}
            {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
          </button>
        </form>

        <p className="mt-8 text-center text-slate-600 text-sm">
          {isLogin ? 'New here?' : 'Already have an account?'}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-sky-600 hover:text-sky-700 font-semibold ml-2"
          >
            {isLogin ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};
