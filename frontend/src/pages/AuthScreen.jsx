import { useState } from 'react';
import { ArrowRight, Key, Mail, User } from 'lucide-react';

import { errorMessage, login, register, saveSession } from '../api';
import { Spinner } from '../components/common';
import logoImg from '../assets/logo.jpg';

/**
 * Sign in, or create an account. Nothing else.
 *
 * This form has lost three things across two passes, each for the same reason.
 *
 * First a "Government Official (Admin)" dropdown, which the server honoured -
 * so anyone could become an administrator of a government policy archive by
 * picking an option.
 *
 * Then an account-type selector, a department, a designation and an "official
 * access code". Those were safe, because the server decided the role either
 * way, but they were still wrong: they asked someone to declare their privilege
 * level before they had seen a single document, and the access code put a
 * credential prompt on an anonymous page, which teaches people to type secrets
 * into sign-up forms.
 *
 * What remains is what an account actually needs. Administrator access is
 * requested from Settings by someone signed in who has used the product, and
 * the profile fields live there too, where they can be filled in at leisure
 * instead of gating the first screen anyone sees.
 */
export const AuthScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = isLogin
        ? await login(username, password)
        : await register(username, password, {
            full_name: fullName.trim(),
            email: email.trim(),
          });
      saveSession(data);
      onLogin(data.username, data.role);
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    }
    setLoading(false);
  };

  const inputClass =
    'w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 ' +
    'focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400';

  return (
    <div className="bg-gradient-to-br from-sky-50 via-white to-sky-50/30 min-h-screen flex items-center justify-center font-sans p-4">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl border border-slate-200 animate-fade-in">
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
          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Full name
                </label>
                <div className="relative">
                  <User
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    size={18}
                  />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={inputClass}
                    placeholder="Your name"
                    autoComplete="name"
                    maxLength={120}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    size={18}
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@example.com"
                    autoComplete="email"
                    maxLength={160}
                    required
                  />
                </div>
              </div>
            </>
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
                className={inputClass}
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
                className={inputClass}
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
            {!loading && (
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            )}
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

        {!isLogin && (
          <p className="mt-4 text-center text-[11px] text-slate-400 leading-relaxed">
            New accounts can read and question the archive. If you need to add or
            remove documents, request administrator access from Settings once you
            are signed in.
          </p>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
