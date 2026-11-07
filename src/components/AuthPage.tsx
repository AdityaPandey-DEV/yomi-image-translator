import React, { useState, useEffect } from 'react';
import { Mail, ArrowRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { signInWithGoogle, sendEmailOTP, completeEmailSignIn, getIdToken, sendTokenToExtension } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';

export function AuthPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isCallback, setIsCallback] = useState(false);
  const [callbackProcessing, setCallbackProcessing] = useState(false);
  const [callbackSuccess, setCallbackSuccess] = useState(false);

  useEffect(() => {
    if (window.location.pathname === '/auth/callback') {
      setIsCallback(true);
      handleEmailCallback();
    }
  }, []);

  useEffect(() => {
    if (user && window.location.pathname === '/auth/callback') {
      window.location.href = '/';
    }
  }, [user]);

  async function handleEmailCallback() {
    setCallbackProcessing(true);
    setError('');
    try {
      await completeEmailSignIn();
      const token = await getIdToken();
      if (token) {
        await sendTokenToExtension(token);
      }
      setCallbackSuccess(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to complete sign-in. Please try again.';
      setError(message);
    } finally {
      setCallbackProcessing(false);
    }
  }

  async function handleSendEmailLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await sendEmailOTP(email.trim());
      setEmailSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send sign-in link. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
      const token = await getIdToken();
      if (token) {
        await sendTokenToExtension(token);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to sign in with Google. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (user) {
    return null;
  }

  if (isCallback) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </div>
          </div>

          {callbackProcessing && (
            <>
              <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Completing Sign In...</h2>
              <p className="text-neutral-400 text-sm">Please wait while we verify your identity.</p>
            </>
          )}

          {callbackSuccess && (
            <>
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Sign In Successful!</h2>
              <p className="text-neutral-400 text-sm">Redirecting you now...</p>
            </>
          )}

          {error && !callbackProcessing && !callbackSuccess && (
            <>
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Sign In Failed</h2>
              <p className="text-red-400 text-sm mb-6">{error}</p>
              <a
                href="/"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-medium rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all"
              >
                Try Again
                <ArrowRight className="w-4 h-4" />
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-8">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </div>
          </div>
          <h1 className="text-xl font-bold text-white mb-1">Manga & Manhwa Image Translator</h1>
          <p className="text-neutral-400 text-sm">Sign in to access your AI translation vault</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Email Magic Link */}
        {emailSent ? (
          <div className="flex flex-col items-center gap-3 p-6 bg-green-500/10 border border-green-500/20 rounded-xl mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
            <div className="text-center">
              <p className="text-white font-medium mb-1">Check your email!</p>
              <p className="text-neutral-400 text-sm">Click the magic link to sign in.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmailSent(false);
                setEmail('');
                setError('');
              }}
              className="text-orange-500 hover:text-orange-400 text-sm font-medium transition-colors mt-1"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendEmailLink} className="mb-6">
            <label htmlFor="email" className="block text-sm font-medium text-neutral-300 mb-2">
              Email address
            </label>
            <div className="relative mb-3">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                className="w-full pl-10 pr-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-colors disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-medium rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Send Sign-In Link
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* OR Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-neutral-800" />
          <span className="text-neutral-500 text-xs font-medium uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        {/* Google Sign In */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-neutral-100 text-neutral-800 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </>
          )}
        </button>

        {/* Footer Links */}
        <div className="mt-8 pt-6 border-t border-neutral-800 flex items-center justify-center gap-4">
          <a
            href="/privacy"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors"
          >
            Privacy Policy
          </a>
          <span className="text-neutral-700 text-xs">•</span>
          <a
            href="/terms"
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors"
          >
            Terms of Service
          </a>
        </div>
      </div>
    </div>
  );
}
