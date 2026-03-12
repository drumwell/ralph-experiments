# Design: Google OAuth Authentication

## Context

The DORA Metrics Dashboard is an internal tool for Extend engineering. It currently has no authentication — anyone with network access can view and modify data. This spec adds Google OAuth to gate access to `@paywithextend.com` users only.

## Scope

- Google OAuth login restricted to `@paywithextend.com` email domain
- No roles — all authenticated users have full access
- In-memory sessions (no database)
- Minimal frontend changes (login page + user display in header)

## What This Does NOT Include

- Admin/member roles or permissions
- Persistent sessions (survives server restart)
- User management UI
- Cloudflare Tunnel or deployment configuration
- Team-to-user mapping (auth users are not linked to teams.json GitHub usernames)

## 1. Auth Flow

1. User visits any page → server checks for session cookie
2. No session → redirect to `/auth/google`
3. `/auth/google` → redirects to Google's OAuth consent/account picker
4. User picks their Google account → Google redirects back to `/auth/google/callback`
5. Server verifies the email ends with `@paywithextend.com` → creates session → redirects to `/`
6. Non-paywithextend email → shown an error page ("Access restricted to paywithextend.com")
7. Subsequent requests include the session cookie → user is authenticated

Logout: `GET /auth/logout` destroys the session and redirects to the login page.

## 2. Protected vs Unprotected Routes

**Unprotected (no auth required):**
- `GET /auth/google` — initiates login
- `GET /auth/google/callback` — handles Google's response
- `GET /auth/logout` — destroys session
- `GET /login.html` — login page
- Static assets needed for the login page (CSS)

**Protected (auth required):**
- All `/api/*` endpoints — return `401 { "error": "Not authenticated" }` if no session
- All other static pages and assets — redirect to `/auth/google` if no session

## 3. Dependencies

New npm packages:
- `passport` — authentication middleware for Express
- `passport-google-oauth20` — Google OAuth 2.0 strategy for Passport
- `express-session` — server-side session middleware

## 4. Configuration

Add to `.env`:
```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
SESSION_SECRET=<random string for signing session cookies>
```

Add to `REQUIRED_ENV_VARS` in `project.conf`:
```
REQUIRED_ENV_VARS=("GITHUB_TOKEN" "JIRA_EMAIL" "JIRA_API_TOKEN" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_SECRET" "SESSION_SECRET")
```

The allowed email domain (`paywithextend.com`) is hardcoded in `auth.js`. It's an internal tool for one company — no need to make this configurable.

## 5. Server Architecture

### New file: `auth.js`

Keeps all auth logic separate from `server.js`. Exports:
- `configurePassport(passport)` — sets up the Google OAuth strategy with domain validation
- `requireAuth` — Express middleware that checks for a valid session; redirects HTML requests to login, returns 401 for API requests
- `authRoutes` — Express Router with `/auth/google`, `/auth/google/callback`, `/auth/logout`

### Changes to `server.js`

The middleware ordering is critical. The current `server.js` mounts `express.static` at line 13 (before any routes) and has a catch-all SPA route at the bottom. Both must be repositioned behind `requireAuth`.

**New middleware order:**
1. `express.json()` (existing)
2. `express-session` middleware (new)
3. `passport.initialize()` + `passport.session()` (new)
4. Auth routes — `/auth/google`, `/auth/google/callback`, `/auth/logout` (new, unprotected)
5. Serve `login.html` without auth — explicit route for `GET /login.html` (new, unprotected)
6. `requireAuth` middleware (new — everything below this requires login)
7. `express.static('public')` (existing, **moved down** from line 13)
8. `GET /auth/user` endpoint (new, protected)
9. All `/api/*` routes (existing, now protected)
10. SPA catch-all route (existing, now protected)

### Session configuration

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  }
}));
```

In-memory store (Express default). Sessions are lost on server restart — users simply log in again. Note: the default `MemoryStore` does not prune expired sessions. For an internal tool with a handful of users this is acceptable, but if the server runs for extended periods without restart, consider switching to the `memorystore` npm package which auto-prunes.

### Passport strategy

```javascript
new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
  scope: ['email', 'profile'],
}, (accessToken, refreshToken, profile, done) => {
  if (!profile.emails || !profile.emails.length) {
    return done(null, false, { message: 'No email returned from Google' });
  }
  const email = profile.emails[0].value;
  if (!email.endsWith('@paywithextend.com')) {
    return done(null, false, { message: 'Access restricted to paywithextend.com' });
  }
  return done(null, { email, name: profile.displayName });
});
```

Serialize/deserialize: store the full user object `{ email, name }` in the session. No database lookup needed.

The `/auth/google` route must include `failureRedirect: '/login.html?error=domain'` so non-paywithextend users see an error message on the login page rather than a raw 401.

### requireAuth middleware

```javascript
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/auth/google');
}
```

## 6. Frontend Changes

### New file: `public/login.html`

Simple standalone page:
- Title: "DORA Metrics Dashboard"
- Message: "Sign in to continue"
- A "Sign in with Google" link pointing to `/auth/google`
- Styled consistently with the existing dashboard

This page is served without authentication.

### Changes to `public/index.html`

Add a user section in the header (after the team dropdown, before refresh button):
```html
<span id="user-info" style="display:none">
  <span id="user-email"></span>
  <a href="/auth/logout" id="logout-link">Logout</a>
</span>
```

### Changes to `public/app.js`

On page load, fetch `GET /auth/user` and display the email + logout link in the header. If the fetch returns 401, redirect to `/auth/google` (defensive — shouldn't happen since server-side middleware handles this).

### Changes to `public/styles.css`

Style the user info section and login page consistent with existing header elements.

## 7. Google Cloud Console Setup (Manual)

One-time setup before the code works:

1. Go to Google Cloud Console → APIs & Credentials
2. Create a new OAuth 2.0 Client ID (type: Web application)
3. Add authorized redirect URI: `http://localhost:3201/auth/google/callback`
4. Copy Client ID and Client Secret into `.env`
5. No need to publish the app — "testing" mode works for internal use with your domain

When deployed to a production URL, add that URL as an additional redirect URI.

## 8. File Changes Summary

| File | Change |
|------|--------|
| `auth.js` | New — Passport config, Google strategy, domain validation, auth routes, requireAuth middleware |
| `server.js` | Add session + Passport middleware, mount auth routes, protect routes with requireAuth, add `/auth/user` endpoint |
| `package.json` | Add `passport`, `passport-google-oauth20`, `express-session` |
| `public/login.html` | New — login page with "Sign in with Google" link |
| `public/index.html` | Add user email + logout link in header |
| `public/app.js` | Fetch and display current user on page load |
| `public/styles.css` | Style login page and user info in header |
| `.env` | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` |
| `project.conf` | Add new env vars to `REQUIRED_ENV_VARS` |
| `specs/ARCHITECTURE.md` | Update to reflect auth addition — add auth section, update "No user authentication" statement |
