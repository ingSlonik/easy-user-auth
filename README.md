# easy-user-auth

A lightweight, secure, and generic user authentication, registration, and password recovery library. It provides server-side Express handlers, a framework-agnostic client API, and React contexts with built-in forms.

## Features

- **Generic User Profile (`TUser`)**: The library is fully generic. Define your own user profile properties (e.g. name, color, avatar, role) in your application, and the library will carry them seamlessly.
- **Access & Refresh Tokens via Cookies**: Highly secure session handling using standard HTTP cookies.
  - Short-lived `accessToken` (15 minutes) + long-lived `refreshToken` (30 days) stored as `HttpOnly; SameSite=Lax; Secure` cookies.
  - Automatic on-the-fly token rotation and reuse detection.
  - Automatic silent refresh handled completely server-side.
- **Mass Assignment Protection**: Automatic stripping of protected internal fields (`_id`, `password`, `refreshTokens`) from input payloads.
- **CSRF Protection**: Native validation verifying request `Origin` and `Referer` headers on all state-modifying requests when cookies are used.
- **Argon2 Hashing & SHA-256 Token Protection**: Standard high-security password hashing and hashed recovery/refresh tokens.
- **Terms & Conditions Agreement**: Native support for configurable mandatory Terms & Conditions checkboxes in registration forms, validated both client-side and server-side.
- **Mailing Support**: Dynamic forgotten password flow integrating with any custom email sender.
- **React Support**: Complete React Context Provider, hooks (`useUser`), and modular styled forms.

---

## Installation

Install the package and its peer dependencies:

```bash
npm install easy-user-auth
```

---

## Usage Guide

### 1. Define Types

Define the custom user profile shape used in your application:

```typescript
// types.ts
export type UserProfile = {
    name: string;
    avatar: string;
    role: "admin" | "user";
};
```

---

### 2. Server-side Integration (Express)

Instantiate `EasyLoginServer` and wire up routes using a single function:

```typescript
import express from "express";
import { EasyLoginServer } from "easy-user-auth/server";
import { db } from "./db"; // Your database module
import { sendMail } from "./mail"; // Your email helper

const authServer = new EasyLoginServer<UserProfile>({
    jwtSecret: process.env.JWT_SECRET || "fallback-secret-key",
    secureCookies: process.env.NODE_ENV === "production",
    requireTerms: true, // Optional: enforce mandatory Terms & Conditions acceptance on registration
    db: {
        insertUser: async (user) => db.insert("user", user),
        getUserById: async (id) => db.select("user", id),
        getUserByMail: async (mail) => {
            const users = await db.selectArray("user");
            return users.find(u => u.mail === mail) || null;
        },
        getUserByRecoveryToken: async (token) => {
            // Note: 'token' passed here is already hashed with SHA-256
            const users = await db.selectArray("user");
            return users.find(u => u.passwordRecovery?.token === token) || null;
        },
        updateUser: async (id, user) => {
            await db.update("user", id, user);
        },
    },
    mailSender: async (lang, mailTo, token) => {
        const resetLink = `https://mysite.com/reset-password?token=${token}`;
        await sendMail({
            to: mailTo,
            subject: "Reset your password",
            html: `<p>Click here to reset: <a href="${resetLink}">${resetLink}</a></p>`,
        });
    },
});

const app = express();
app.use(express.json());

// Register all authentication routes at once (e.g. /api/login, /api/register, /api/user, /api/change-password, etc.)
authServer.registerExpressRoutes(app);

// Protecting routes
app.get("/api/protected-data", async (req, res) => {
    try {
        const session = await authServer.checkLogin(req, res); // Autorefreshes cookies on the fly
        res.json({ message: `Hello ${session.name}! Here is your secret data.` });
    } catch (e) {
        res.status(401).json({ message: "Unauthorized" });
    }
});
```

---

### 3. Frontend Integration (Vanilla JS / Non-React)

If you are not using React, you can import and use the browser API client directly:

```typescript
import { EasyLoginClient } from "easy-user-auth/client";
import { UserProfile } from "./types";

const authClient = new EasyLoginClient<UserProfile>({
    serverUrl: "https://api.mysite.com", // Optional: leave empty for relative calls (default)
    credentials: "include", // Optional: "include" for cookies (default), "omit" for header-only auth
    userSecretStoreKey: "user-secrets" // Optional: custom storage key for token loading (only used when credentials is "omit")
});

// 1. Register a new user (returns user profile along with userId and mail)
const [registeredUser, regErr] = await authClient.addRegistration({
    name: "John Doe",
    avatar: "avatar.png",
    role: "user",
    mail: "john@doe.com",
    password: "securepassword",
    termsAccepted: true
});

// 2. Log in
const [loggedInUser, loginErr] = await authClient.addLogin({
    mail: "john@doe.com",
    password: "securepassword"
});

// 3. Get active session profile (automatically reads and verifies httpOnly cookies)
const [activeSession, sessionErr] = await authClient.getUser();

// 4. Change password (authenticated)
await authClient.changePassword({
    currentPassword: "oldpassword",
    newPassword: "newsecurepassword"
});

// 5. Update profile fields
if (activeSession) {
    await authClient.updateUser({
        ...activeSession,
        name: "John Updated"
    });
}

// 6. Log out
await authClient.logout();
```

---

### 4. Frontend Integration (React)

#### A. Setup the Provider
Wrap your application structure inside `UserProvider`. 

By default, `<UserProvider>` will automatically instantiate the API client internally. All configuration props are optional:
- `serverUrl` (optional, defaults to `""` for relative path requests).
- `credentials` (optional, defaults to `"include"`). Set to `"omit"` if you want to use header-only token validation.
- `userSecretStoreKey` (optional, defaults to `"user-secrets"`). The storage key under which credentials are saved. Note: Only used when `credentials` is set to `"omit"`.
- `requireTerms` (optional, boolean). Requires users to check the Terms & Conditions checkbox before registering.
- `termsLabel` (optional, `ReactNode`). Custom label text or link component for the Terms & Conditions checkbox (e.g. `<span>I accept the <a href="/terms">Terms</a></span>`).
- `dict` (optional). Custom dictionary for translations or overriding UI text. You can pass a partial dictionary (e.g., `{ termsAgreement: "I accept the terms" }`) to override specific labels.

```tsx
import React from "react";
import { UserProvider } from "easy-user-auth/react";
import { UserProfile } from "./types";

const defaultUser: UserProfile = {
    name: "",
    avatar: "default.png",
    role: "user",
};

export default function App() {
    return (
        <UserProvider<UserProfile>
            defaultUser={defaultUser}
        >
            <MyLayout />
        </UserProvider>
    );
}
```

#### B. Consume Session State
Use the `useUser` hook in any child component to read/write states or trigger custom user actions:

```tsx
import React from "react";
import { useUser } from "easy-user-auth/react";
import { UserProfile } from "./types";

export function ProfileWidget() {
    const { isLoggedIn, user, setUser, loginUser, showUserDialog } = useUser<UserProfile>();

    if (!isLoggedIn) {
        return <button onClick={showUserDialog}>Log In</button>;
    }

    return (
        <div>
            <p>Welcome, {user.name}! ({user.mail})</p>
            <button onClick={() => setUser({ ...user, name: "New Name" })}>
                Update Profile Name
            </button>
            <button onClick={() => loginUser(null)}>Log Out</button>
        </div>
    );
}
```

#### C. Rendering Auth Forms
You can render the built-in authentication forms (which automatically link to the Provider context) anywhere in your layout:

```tsx
import React from "react";
import { UserDialog, LogInForm, RegisterForm, ForgottenPasswordForm } from "easy-user-auth/react";

export function AuthPage() {
    return (
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
            {/* Renders the combined Login/Registration switching component */}
            <UserDialog />

            {/* Or render forms individually */}
            {/* <LogInForm /> */}
            {/* <RegisterForm /> */}
        </div>
    );
}
```

##### Custom Layout / Switcher Rendering
If you want to render your own custom switcher/tabs component (and control where the forms are displayed), pass the `renderTabs` prop callback. It provides `isRegisterMode`, `setRegisterMode`, and pre-configured `<LogInForm />` and `<RegisterForm />` nodes:

```tsx
<UserDialog
    renderTabs={(isRegisterMode, setRegisterMode, loginForm, registerForm) => (
        <div className="my-custom-container">
            <div className="my-custom-tabs">
                <button 
                    onClick={() => setRegisterMode(false)} 
                    style={{ fontWeight: !isRegisterMode ? "bold" : "normal" }}
                >
                    Login
                </button>
                <button 
                    onClick={() => setRegisterMode(true)} 
                    style={{ fontWeight: isRegisterMode ? "bold" : "normal" }}
                >
                    Create Account
                </button>
            </div>
            
            <div className="my-custom-content">
                {isRegisterMode ? registerForm : loginForm}
            </div>
        </div>
    )}
/>
```

You can also control the tabs state completely externally using props:

```tsx
const [registerMode, setRegisterMode] = useState(false);
...
<UserDialog
    isRegisterMode={registerMode}
    onRegisterModeChange={setRegisterMode}
/>
```

#### D. Styling and Customization

Since all inline styles have been removed from the React components, you should import the default stylesheet to render the dialog modal and forms correctly:

```tsx
import "easy-user-auth/style.css";
```

##### Available CSS Class Names
For custom CSS styling and overrides, the following class names are exposed on the components:

- `.easy-user-auth-overlay` — Backdrop overlay container
- `.easy-user-auth-modal` — Modal content wrapper box
- `.easy-user-auth-close-btn` — Modal absolute top-right close button (`&times;`)
- `.easy-user-auth-tabs` — Tabs switcher container row
- `.easy-user-auth-tab` — Individual tab buttons
- `.easy-user-auth-tab-active` — Active/selected tab button
- `.easy-user-auth-form` — Core `<form>` wrappers
- `.easy-user-auth-form-input` — Label and input wrapping container block
- `.easy-user-auth-checkbox` — Checkbox input element
- `.easy-user-auth-checkbox-label` — Label text for terms and checkboxes
- `.easy-user-auth-label` — Form field labels
- `.easy-user-auth-input` — Text/Password form controls (`<input>`)
- `.easy-user-auth-submit-btn` — Primary action buttons (Login / Register / Recover)
- `.easy-user-auth-logout-btn` — Logout button
- `.easy-user-auth-back-btn` — Secondary action / Back buttons
- `.easy-user-auth-forgot-link` — Text link mapping to forgotten password modal
- `.easy-user-auth-title` — Headers inside forms (e.g. Forgotten password)
- `.easy-user-auth-text` — Descriptive instruction texts
- `.easy-user-auth-alert` — Validation errors / Status alerts
- `.easy-user-auth-info` — Under-field helper descriptions
- `.easy-user-auth-loading` — Spinner and loader labels

---

## Security Best Practices

1. **Production Configuration**: Always ensure `secureCookies` is set to `true` (default in production environments). This restricts cookies to HTTPS connections.
2. **Cross-Origin Environments**: In local development where the frontend and API servers run on different ports (e.g. Vite at `5173` and Express at `3001`), browser security blocks cookies unless `credentials: "include"` is set on both `fetch` configurations and CORS is configured correctly (`credentials: true`). For header-only auth, set `credentials: "omit"`.
3. **CSRF Validation**: When executing custom authenticated actions outside the standard API client (e.g. custom endpoints), always execute `authServer.checkLogin(req, res)` as it performs automatic Origin-validation to prevent Cross-Site Request Forgery.
4. **Nginx / Reverse Proxy Configuration**:
   When proxying requests through Nginx (or another reverse proxy) to your Node.js application, ensure that Nginx forwards the original request headers (`Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Cookie`). This is essential for CSRF origin verification, cookie setting, and domain matching to function correctly:

   ```nginx
   location /api/ {
       proxy_pass http://localhost:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-Host $host;
       
       # Pass cookies transparently
       proxy_pass_header Set-Cookie;
   }
   ```

   > **Note on `cookieDomain`**: If your API runs on a subdomain (e.g. `api.example.com`) and your web frontend runs on `example.com`, pass `cookieDomain: ".example.com"` when instantiating `EasyLoginServer` so the authentication cookies are shared across all subdomains.


