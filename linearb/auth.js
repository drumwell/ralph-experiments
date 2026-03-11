'use strict';

const { Router } = require('express');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const ALLOWED_DOMAIN = 'paywithextend.com';

/**
 * Configure Passport with Google OAuth 2.0 strategy.
 */
function configurePassport(passport) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    if (!profile.emails || !profile.emails.length) {
      return done(null, false, { message: 'No email returned from Google' });
    }
    const email = profile.emails[0].value;
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      return done(null, false, { message: `Access restricted to ${ALLOWED_DOMAIN}` });
    }
    return done(null, { email, name: profile.displayName });
  }));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
}

/**
 * Express middleware: require authenticated session.
 * API routes get 401 JSON. Other routes redirect to Google login.
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/auth/google');
}

/**
 * Express Router with auth routes (unprotected).
 */
function authRoutes(passport) {
  const router = Router();

  router.get('/auth/google', passport.authenticate('google', {
    scope: ['email', 'profile'],
  }));

  router.get('/auth/google/callback', passport.authenticate('google', {
    failureRedirect: '/login.html?error=domain',
  }), (req, res) => {
    res.redirect('/');
  });

  router.get('/auth/logout', (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.redirect('/login.html');
      });
    });
  });

  return router;
}

module.exports = { configurePassport, requireAuth, authRoutes };
