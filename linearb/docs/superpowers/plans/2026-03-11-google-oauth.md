# Google OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth authentication so only `@paywithextend.com` users can access the DORA Metrics Dashboard.

**Architecture:** Passport.js with Google OAuth 2.0 strategy handles authentication. Express-session with in-memory store manages sessions. A new `auth.js` file encapsulates all auth logic. The `server.js` middleware order is restructured so `requireAuth` sits before static files and API routes.

**Tech Stack:** Express, Passport, passport-google-oauth20, express-session

**Spec:** `docs/superpowers/specs/2026-03-11-google-oauth-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `auth.js` | New — Passport config, Google strategy, domain check, requireAuth middleware, auth routes |
| `server.js` | Modify — add session/passport middleware, restructure middleware order, mount auth routes, add `/auth/user` |
| `public/login.html` | New — standalone login page with "Sign in with Google" link |
| `public/index.html` | Modify — add user email + logout in header |
| `public/app.js` | Modify — fetch and display current user on page load |
| `public/styles.css` | Modify — login page styles, user info header styles |
| `package.json` | Modify — add 3 dependencies |
| `.env` | Modify — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET |
| `project.conf` | Modify — add new env vars to REQUIRED_ENV_VARS |
| `specs/ARCHITECTURE.md` | Modify — add auth section |

---

## Chunk 1: Backend Auth

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install npm packages**

Run:
```bash
cd /Users/jonb/drumwell/ralph-experiments/linearb && npm install passport passport-google-oauth20 express-session
```

Expected: `package.json` now has 3 new dependencies. `node_modules/` updated.

- [ ] **Step 2: Verify package.json**

Run:
```bash
node -e "const p = require('./package.json'); console.log(Object.keys(p.dependencies).sort().join(', '))"
```

Expected: `express, express-session, passport, passport-google-oauth20`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(auth): add passport and express-session dependencies"
```

---

### Task 2: Create auth.js

**Files:**
- Create: `auth.js`

This file exports three things: `configurePassport`, `requireAuth`, and `authRoutes`.

- [ ] **Step 1: Create `auth.js` with the complete auth module**

```javascript
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
```

- [ ] **Step 2: Verify the file loads without errors**

Run:
```bash
node -e "require('./auth'); console.log('auth.js loaded OK')"
```

Expected: `auth.js loaded OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add auth.js
git commit -m "feat(auth): create auth.js with Passport Google OAuth strategy"
```

---

### Task 3: Restructure server.js middleware order

**Files:**
- Modify: `server.js:1-14` (top section)
- Modify: `server.js:1534-1539` (SPA catch-all)

This is the critical task. The current middleware order is:

```
Line 12: app.use(express.json())
Line 13: app.use(express.static(...))  ← serves ALL files without auth
...
Line 1537: app.get(/^(?!\/api).*/, ...)  ← SPA catch-all, also no auth
```

The new order must be:

```
1. express.json()
2. express-session
3. passport.initialize() + passport.session()
4. Auth routes (unprotected)
5. Serve login.html explicitly (unprotected)
6. requireAuth middleware (everything below is protected)
7. express.static('public')  ← MOVED DOWN
8. /auth/user endpoint
9. All /api/* routes (existing)
10. SPA catch-all (existing, now protected)
```

- [ ] **Step 1: Replace the top section of `server.js`**

Replace lines 1-13 (from `'use strict'` through the `express.static` line) with:

```javascript
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const session = require('express-session');
const passport = require('passport');
const { configurePassport, requireAuth, authRoutes } = require('./auth');

const app = express();
const PORT = 3201;

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(express.json());

// ─── Session + Passport ───────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  }
}));

app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// ─── Auth routes (unprotected) ────────────────────────────────────────────────
app.use(authRoutes(passport));

// Serve login page without auth
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ─── Auth gate ────────────────────────────────────────────────────────────────
app.use(requireAuth);

// ─── Static files (protected) ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
```

- [ ] **Step 2: Add `/auth/user` endpoint**

Add this immediately after the static middleware line and before the `// ─── Data loading` section:

```javascript
// ─── Current user ─────────────────────────────────────────────────────────────
app.get('/auth/user', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: req.user.email, name: req.user.name });
});
```

- [ ] **Step 3: Verify server starts without errors**

Run:
```bash
node -e "const { app } = require('./server'); console.log('server.js loaded OK')"
```

Expected: `server.js loaded OK` (may show data loading warnings, but no crash)

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(auth): restructure middleware order, add session and passport"
```

---

### Task 4: Add environment variables

**Files:**
- Modify: `.env`
- Modify: `project.conf:24`

- [ ] **Step 1: Add placeholder env vars to `.env`**

Append these lines to `.env`:

```
GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
SESSION_SECRET=replace-with-random-string
```

The user will replace `placeholder` values with real credentials from Google Cloud Console.

- [ ] **Step 2: Update `project.conf` REQUIRED_ENV_VARS**

In `project.conf`, replace line 24:

```bash
REQUIRED_ENV_VARS=("GITHUB_TOKEN" "JIRA_EMAIL" "JIRA_API_TOKEN")
```

with:

```bash
REQUIRED_ENV_VARS=("GITHUB_TOKEN" "JIRA_EMAIL" "JIRA_API_TOKEN" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_SECRET" "SESSION_SECRET")
```

- [ ] **Step 3: Commit**

```bash
git add project.conf
git commit -m "feat(auth): add Google OAuth env vars to project.conf"
```

Note: Do NOT commit `.env` — it contains secrets and is in `.gitignore`.

---

## Chunk 2: Frontend

### Task 5: Create login page

**Files:**
- Create: `public/login.html`

- [ ] **Step 1: Create `public/login.html`**

Note: All styles are inlined in this file. The main `styles.css` is behind the auth gate, so the login page cannot reference it.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DORA Metrics — Sign In</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0d1117; color: #e6edf3; }
    .login-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 48px 40px; text-align: center; max-width: 400px; width: 100%; }
    .login-title { font-size: 1.8rem; font-weight: 700; margin: 0 0 4px; }
    .login-subtitle { color: #7d8590; font-size: 0.85rem; margin: 0 0 32px; }
    .login-message { color: #8b949e; margin: 0 0 24px; }
    .login-button { display: inline-block; background: #238636; color: #fff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.9rem; transition: background 0.15s; }
    .login-button:hover { background: #2ea043; }
    .login-error { color: #f85149; font-size: 0.85rem; margin-top: 16px; }
  </style>
</head>
<body>
<div class="login-container">
  <div class="login-card">
    <h1 class="login-title">DORA Metrics</h1>
    <p class="login-subtitle">paywithextend</p>
    <p class="login-message">Sign in to continue</p>
    <a href="/auth/google" class="login-button">Sign in with Google</a>
    <p id="login-error" class="login-error" style="display:none"></p>
  </div>
</div>
<script>
  // Show error message if redirected with ?error=domain
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'domain') {
    const el = document.getElementById('login-error');
    el.textContent = 'Access is restricted to @paywithextend.com accounts.';
    el.style.display = 'block';
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/login.html
git commit -m "feat(auth): add login page"
```

---

### Task 6: Add login page styles

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Add user info header styles to the end of `styles.css`**

Login page styles are inlined in `login.html` (since `styles.css` is behind the auth gate). Only the header user info styles go here.

Append:

```css
/* ── User info in header ─────────────────────────────────────────────────── */

#user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #8b949e;
}

#user-info a {
  color: #58a6ff;
  text-decoration: none;
  font-size: 0.75rem;
}

#user-info a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "feat(auth): add login page and user info styles"
```

---

### Task 7: Add user info to header

**Files:**
- Modify: `public/index.html:80-84`
- Modify: `public/app.js:1280-1283`

- [ ] **Step 1: Add user info element to `index.html` header**

In `public/index.html`, find the refresh button section (lines 80-84):

```html
      <button id="refresh-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
      <span id="last-refresh"></span>
```

Add the user info section **before** the refresh button:

```html
      <span id="user-info" style="display:none">
        <span id="user-email"></span>
        <a href="/auth/logout">Logout</a>
      </span>

      <button id="refresh-btn">
```

- [ ] **Step 2: Add user info fetch to `app.js`**

In `public/app.js`, find the Init section (around line 1280):

```javascript
// ── Init ──────────────────────────────────────────────────────────────────────

// Load team dropdown (async, doesn't block page load)
initTeamFilter();
```

Add the user info fetch **before** `initTeamFilter()`:

```javascript
// ── Init ──────────────────────────────────────────────────────────────────────

// Load and display current user
(async () => {
  try {
    const user = await apiFetch('/auth/user');
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('user-info').style.display = '';
  } catch (e) {
    // Not authenticated — server-side redirect handles this,
    // but as a fallback redirect to login
    window.location.href = '/auth/google';
  }
})();

// Load team dropdown (async, doesn't block page load)
initTeamFilter();
```

- [ ] **Step 3: Verify no syntax errors in app.js**

Run:
```bash
node -e "const fs = require('fs'); const code = fs.readFileSync('public/app.js','utf8'); new Function(code); console.log('app.js syntax OK')"
```

Expected: `app.js syntax OK` (or a window/document reference error, which is fine — means syntax parsed)

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat(auth): display user email and logout link in header"
```

---

## Chunk 3: Documentation & Verification

### Task 8: Update ARCHITECTURE.md

**Files:**
- Modify: `specs/ARCHITECTURE.md`

- [ ] **Step 1: Find and update the "No user authentication" line**

Search for the line that says there's no authentication (near the top of the file) and update it to reflect the new auth system. Add a new section documenting the auth architecture:

```markdown
## Authentication

- **Method:** Google OAuth 2.0 via Passport.js
- **Domain restriction:** Only `@paywithextend.com` emails can access the app
- **Sessions:** Express-session with in-memory store (7-day cookie, lost on server restart)
- **No roles:** All authenticated users have full access

### Auth routes (unprotected)
- `GET /auth/google` — initiates Google OAuth flow
- `GET /auth/google/callback` — handles Google's redirect
- `GET /auth/logout` — destroys session, redirects to login
- `GET /login.html` — login page

### Protected routes
- All `/api/*` endpoints return `401` if not authenticated
- All static assets and pages require authentication
- `GET /auth/user` returns `{ email, name }` of current user

### Environment variables
- `GOOGLE_CLIENT_ID` — from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- `SESSION_SECRET` — random string for signing session cookies
```

Also add `auth.js` to the file boundaries table.

- [ ] **Step 2: Commit**

```bash
git add specs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md with auth section"
```

---

### Task 9: End-to-end verification

**Files:** None (testing only)

This task requires real Google OAuth credentials. The user must complete the Google Cloud Console setup (see spec Section 7) and update `.env` with real values before testing.

- [ ] **Step 1: Verify Google Cloud Console setup**

Confirm the user has:
1. Created an OAuth 2.0 Client ID in Google Cloud Console
2. Added `http://localhost:3201/auth/google/callback` as an authorized redirect URI
3. Updated `.env` with real `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
4. Set a random `SESSION_SECRET` in `.env`

- [ ] **Step 2: Start the server**

Run:
```bash
source .env && node server.js
```

Expected: `DORA metrics server running on http://localhost:3201`

- [ ] **Step 3: Test unauthenticated access**

Open `http://localhost:3201` in a browser.

Expected: Redirected to Google's account picker (via `/auth/google`).

- [ ] **Step 4: Test login with @paywithextend.com account**

Select a `@paywithextend.com` Google account.

Expected: Redirected back to the dashboard. User email and "Logout" link visible in the header. All pages and data load normally.

- [ ] **Step 5: Test API returns 401 without auth**

In a new terminal (no session cookie):
```bash
curl -s localhost:3201/api/overview | jq
```

Expected: `{ "error": "Not authenticated" }` with HTTP 401.

- [ ] **Step 6: Test logout**

Click the "Logout" link in the header.

Expected: Redirected to login page. Visiting `http://localhost:3201` again redirects to Google login.

- [ ] **Step 7: Test non-paywithextend email (if possible)**

If you have a personal Gmail account, try logging in with it.

Expected: Redirected to `/login.html?error=domain` with the message "Access is restricted to @paywithextend.com accounts."

- [ ] **Step 8: Test login page directly**

Visit `http://localhost:3201/login.html`.

Expected: Login page loads without redirect loop (it's unprotected).
