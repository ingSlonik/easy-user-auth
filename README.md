# easy-user-auth

A lightweight, secure, and generic user authentication, registration, and password recovery library. It provides server-side Express handlers, a framework-agnostic client API, and React contexts with built-in forms.

## Features

- **Generic User Profile (`TUser`)**: The library is fully generic. Define your own user profile properties (e.g. name, color, avatar, role) in your application, and the library will carry them seamlessly.
- **Access & Refresh Tokens via Cookies**: Highly secure session handling using standard HTTP cookies.
  - Short-lived `accessToken` (15 minutes) + long-lived `refreshToken` (30 days) stored as `HttpOnly; SameSite=Lax; Secure` cookies.
  - Automatic on-the-fly token rotation and reuse detection.
  - Automatic silent refresh handled completely server-side.
- **CSRF Protection**: Native validation verifying request `Origin` and `Referer` headers on all state-modifying requests when cookies are used.
- **Argon2 Hashing**: Standard high-security password hashing.
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
    db: {
        insertUser: async (user) => db.insert("user", user),
        getUserById: async (id) => db.select("user", id),
        getUserByMail: async (mail) => {
            const users = await db.selectArray("user");
            return users.find(u => u.mail === mail) || null;
        },
        getUserByRecoveryToken: async (token) => {
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

// Register all authentication routes at once (e.g. /api/login, /api/register, /api/user, etc.)
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

### 3. Frontend Integration (React)

#### A. Setup the Provider
Wrap your application structure inside `UserProvider`. 

By default, `<UserProvider>` will automatically instantiate the API client internally. All configuration props are optional:
- `serverUrl` (optional, defaults to `""` for relative path requests).
- `credentials` (optional, defaults to `"include"`). Set to `"omit"` if you want to use header-only token validation.
- `userSecretStoreKey` (optional, defaults to `"user-secrets"`). The storage key under which credentials are automatically saved and read. Note: This is only used when `credentials` is set to `"omit"`.

```tsx
import React from "react";
import { UserProvider } from "easy-user-auth/react";
import { UserProfile } from "./types";

const defaultUser: UserProfile = {
    name: "",
    avatar: "default.png",
    role: "user",
};

const dict = {
    userDialogLoggedInHeader: "You are logged in.",
    logOut: "Log out",
    logIn: "Log in",
    userCreateAccount: "Create account",
    userDialogText: "Enter your credentials below:",
    mail: "Email",
    password: "Password",
    passwordAgain: "Confirm password",
    userWrongPasswordMatch: "Passwords do not match.",
    userWrongPasswordLength: "Password must be at least 6 characters.",
    userWrongMailFormat: "Invalid email formatting.",
    userWrongFill: "Please fill in all fields.",
    userErrorRegister: "Registration failed. Email might already be taken.",
    userErrorLogIn: "Invalid email or password.",
    registerIn: "Register",
    allRight: "Success",
    userForgottenPasswordButton: "Forgot password?",
    userForgottenPassword: "Recover Password",
    userForgottenPasswordSuccess: "Recovery email sent successfully.",
    close: "Close",
    userWrongSendMail: "We couldn't send the recovery email.",
    userForgottenPasswordError: "Something went wrong.",
    userForgottenPasswordErrorSend: "Send recovery mail",
    userForgottenPasswordErrorChange: "Unable to change password.",
    userForgottenPasswordSuccessChange: "Password successfully updated.",
    backToHome: "Back to Home",
    userForgottenPasswordChange: "Change Password",
    change: "Change",
    userNamePlaceholder: "Your Name",
    save: "Save",
};

export default function App() {
    return (
        <UserProvider<UserProfile>
            defaultUser={defaultUser}
            dict={dict}
            // serverUrl="http://localhost:1111" // Optional: custom api url
            // credentials="omit"                 // Optional: set to "omit" for header-only auth (automatic token mapping)
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
            <p>Welcome, {user.name}!</p>
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

---

### 4. Frontend Integration (Vanilla JS / Non-React)

If you are not using React, you can import and use the browser API client directly:

```typescript
import { EasyLoginClient } from "easy-user-auth/client";
import { UserProfile } from "./types";

const authClient = new EasyLoginClient<UserProfile>({
    serverUrl: "https://api.mysite.com", // Optional: leave empty for relative calls (default)
    credentials: "include", // Optional: "include" for cookies (default), "omit" for header-only auth
    userSecretStoreKey: "user-secrets" // Optional: custom storage key for token loading (only used when credentials is "omit")
});

// 1. Register a new user
const [registeredUser, regErr] = await authClient.addRegistration({
    name: "John Doe",
    avatar: "avatar.png",
    role: "user",
    mail: "john@doe.com",
    password: "securepassword"
});

// 2. Log in
const [loggedInUser, loginErr] = await authClient.addLogin({
    mail: "john@doe.com",
    password: "securepassword"
});

// 3. Get active session profile (automatically reads and verifies httpOnly cookies)
const [activeSession, sessionErr] = await authClient.getUser();

// 4. Update profile fields
if (activeSession) {
    await authClient.updateUser({
        ...activeSession,
        name: "John Updated"
    });
}

// 5. Log out
await authClient.logout();
```

---

## Security Best Practices

1. **Production Configuration**: Always ensure `secureCookies` is set to `true` (default in production environments). This restricts cookies to HTTPS connections.
2. **Cross-Origin Environments**: In local development where the frontend and API servers run on different ports (e.g. Parcel at `1234` and Express at `1111`), browser security block cookies unless `credentials: "include"` is set on both `fetch` configurations and CORS is configured correctly. For this reason, the library supports using the `Authorization: bearer <token>` header as a secondary fallback.
3. **CSRF Validation**: When executing custom authenticated actions outside the standard API client (e.g. custom endpoints), always execute `authServer.checkLogin(req, res)` as it performs automatic Origin-validation to prevent Cross-Site Request Forgery.
