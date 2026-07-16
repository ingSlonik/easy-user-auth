import React, { useState, useEffect } from "react";
import { UserProvider, useUser, UserDialog } from "easy-user-auth/react";
// User Profile shape for our test application
export type UserProfile = {
  name: string;
  themeColor: string;
  role: "admin" | "user";
};

// Default Profile Settings
const defaultUser: UserProfile = {
  name: "Host",
  themeColor: "#7c3aed", // Indigo default
  role: "user",
};

// Czech translation dictionary for Czech localization
const dict = {
  userDialogLoggedInHeader: "Jste úspěšně přihlášeni.",
  logOut: "Odhlásit se",
  logIn: "Přihlásit se",
  userCreateAccount: "Vytvořit účet",
  userDialogText: "Zadejte své přihlašovací údaje níže:",
  mail: "E-mail",
  password: "Heslo",
  passwordAgain: "Heslo znovu",
  userWrongPasswordMatch: "Hesla se neshodují.",
  userWrongPasswordLength: "Heslo musí mít alespoň 6 znaků.",
  userWrongMailFormat: "Neplatný formát e-mailu.",
  userWrongFill: "Vyplňte prosím všechna pole.",
  userErrorRegister: "Registrace se nezdařila. E-mail může být již obsazený.",
  userErrorLogIn: "Nesprávný e-mail nebo heslo.",
  registerIn: "Registrovat se",
  allRight: "Zpracování",
  userForgottenPasswordButton: "Zapomněli jste heslo?",
  userForgottenPassword: "Obnovit heslo",
  userForgottenPasswordSuccess: "Odkaz na obnovu hesla byl odeslán (viz níže).",
  close: "Zavřít",
  userWrongSendMail: "Nepodařilo se odeslat e-mail pro obnovu.",
  userForgottenPasswordError: "Něco se nepovedlo.",
  userForgottenPasswordErrorSend: "Odeslat odkaz na obnovu",
  userForgottenPasswordErrorChange: "Heslo se nepodařilo změnit. Odkaz může být neplatný nebo vypršel.",
  userForgottenPasswordSuccessChange: "Heslo bylo úspěšně změněno. Jste přihlášeni.",
  backToHome: "Zpět domů",
  userForgottenPasswordChange: "Změnit heslo",
  change: "Uložit nové heslo",
  userNamePlaceholder: "Vaše jméno",
  save: "Uložit",
};

export type AuthMode = "cookies" | "headers";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    try {
      const cached = localStorage.getItem("auth-mode");
      if (cached === "cookies" || cached === "headers") {
        return cached;
      }
    } catch (_) {}
    return "cookies";
  });

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode);
    try {
      localStorage.setItem("auth-mode", mode);
    } catch (_) {}
    window.location.reload();
  };

  const credentials = authMode === "headers" ? "omit" : "include";

  return (
    <UserProvider<UserProfile>
      defaultUser={defaultUser}
      dict={dict}
      credentials={credentials}
    >
      <AppContent authMode={authMode} onAuthModeChange={handleAuthModeChange} />
    </UserProvider>
  );
}

function AppContent({ authMode, onAuthModeChange }: { authMode: AuthMode; onAuthModeChange: (mode: AuthMode) => void }) {
  const { isLoggedIn, user, showUserDialog } = useUser<UserProfile>();
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Check URL query parameters for reset token on mount/route change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setResetToken(token);
      // Clean query parameter from URL bar without refreshing
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Theme color styling injected dynamically
  const userColor = user?.themeColor || "#7c3aed";

  return (
    <div style={{ "--accent-color": userColor } as React.CSSProperties}>
      <div className="app-container">
        <header>
          <div className="logo">
            🛡️ Easy<span>Auth</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <div className="auth-mode-selector" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem" }}>
              <label htmlFor="auth-mode-select" style={{ color: "var(--text-secondary)" }}>Metoda ověření:</label>
              <select
                id="auth-mode-select"
                value={authMode}
                onChange={(e) => onAuthModeChange(e.target.value as AuthMode)}
                style={{
                  background: "rgba(20, 18, 38, 0.95)",
                  color: "white",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                <option value="cookies">Cookies (HTTP-only)</option>
                <option value="headers">Authorization Header (token)</option>
              </select>
            </div>
            <div>
              {isLoggedIn ? (
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                    Přihlášen jako <strong>{user.name || "Uživatel"}</strong>
                  </span>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--accent-color)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold",
                      color: "white",
                    }}
                  >
                    {(user.name || user.role || "U")[0].toUpperCase()}
                  </div>
                </div>
              ) : (
                <button className="btn btn-secondary" onClick={showUserDialog}>
                  {dict.logIn}
                </button>
              )}
            </div>
          </div>
        </header>

        <main>
          {resetToken ? (
            <ResetPasswordForm token={resetToken} onCancel={() => setResetToken(null)} />
          ) : isLoggedIn ? (
            <Dashboard authMode={authMode} />
          ) : (
            <LandingPage />
          )}
        </main>

        <EmailConsoleSimulator onUseToken={(token) => setResetToken(token)} />
      </div>
    </div>
  );
}

// 1. Landing Page Component
function LandingPage() {
  const { showUserDialog } = useUser<UserProfile>();

  return (
    <div className="hero-section glass-card">
      <div className="hero-badge">🔐 Knihovna easy-user-auth</div>
      <h1 className="hero-title">
        Bezpečné přihlašování pro <span>React</span> aplikace
      </h1>
      <p className="hero-subtitle">
        Vyzkoušejte si lehké, vysoce zabezpečené a plně generické ověřování uživatelů postavené na HTTP-only cookies s rotací refresh tokenů.
      </p>
      <div>
        <button className="btn btn-primary" onClick={showUserDialog}>
          Spustit Demo / Přihlásit se 🚀
        </button>
      </div>

      <div className="features-grid">
        <div className="feature-card glass-card">
          <div className="feature-icon">🔒</div>
          <h3>Moderní zabezpečení</h3>
          <p>
            Využívá HTTP-Only cookies s flagy SameSite=Lax a Secure. Obsahuje vestavěnou ochranu proti CSRF.
          </p>
        </div>
        <div className="feature-card glass-card">
          <div className="feature-icon">⚙️</div>
          <h3>Generické profily</h3>
          <p>
            Můžete si definovat libovolná uživatelská pole (jméno, role, barva motivu). Knihovna je automaticky synchronizuje.
          </p>
        </div>
        <div className="feature-card glass-card">
          <div className="feature-icon">✉️</div>
          <h3>Zapomenutá hesla</h3>
          <p>
            Plný tok obnovy zapomenutého hesla. Vývojový backend vypisuje odkazy na obnovu přímo v aplikaci.
          </p>
        </div>
      </div>
    </div>
  );
}

// 2. Logged-in Dashboard Component
function Dashboard({ authMode }: { authMode: AuthMode }) {
  const { user, setUser, userId, loginUser, api } = useUser<UserProfile>();
  const [nameInput, setNameInput] = useState(user.name || "");
  const [roleInput, setRoleInput] = useState(user.role || "user");
  const [themeColor, setThemeColor] = useState(user.themeColor || "#7c3aed");

  const [apiResult, setApiResult] = useState<{ success: boolean; message: string } | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Sync state if user changes from provider
  useEffect(() => {
    setNameInput(user.name || "");
    setRoleInput(user.role || "user");
    setThemeColor(user.themeColor || "#7c3aed");
  }, [user]);

  // Handle saving generic user profile data
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("Ukládám...");

    // Updates local state and triggers debounced API sync automatically via user provider
    setUser({
      ...user,
      name: nameInput,
      role: roleInput as "admin" | "user",
      themeColor: themeColor,
    });

    setTimeout(() => {
      setSaveStatus("Profil byl aktualizován na serveru!");
      setTimeout(() => setSaveStatus(null), 3000);
    }, 500);
  };

  // Test calling custom protected backend routes
  const handleCallProtectedApi = async () => {
    setApiLoading(true);
    setApiResult(null);
    try {
      const headers: HeadersInit = {};
      if (authMode !== "cookies") {
        try {
          const secrets = localStorage.getItem("user-secrets");
          if (secrets) {
            const parsed = JSON.parse(secrets);
            if (parsed.token) {
              headers["Authorization"] = `Bearer ${parsed.token}`;
            }
          }
        } catch (_) {}
      }

      const response = await fetch("/api/secret-dashboard", {
        headers,
      });
      const data = await response.json();
      if (response.ok) {
        setApiResult({ success: true, message: data.message });
      } else {
        setApiResult({ success: false, message: data.message || "Neautorizovaný přístup!" });
      }
    } catch (err) {
      setApiResult({ success: false, message: "Selhalo síťové volání na backend." });
    } finally {
      setApiLoading(false);
    }
  };

  const themeOptions = [
    { name: "Indigo", value: "#7c3aed" },
    { name: "Emerald", value: "#10b981" },
    { name: "Orange", value: "#f97316" },
    { name: "Rose", value: "#f43f5e" },
    { name: "Sky Blue", value: "#0ea5e9" },
  ];

  return (
    <div className="dashboard-grid">
      {/* Sidebar Info */}
      <div className="dashboard-sidebar">
        <div className="glass-card profile-summary">
          <div className="avatar-large">
            {(user.name || "U")[0].toUpperCase()}
          </div>
          <h2>{user.name || "Uživatel"}</h2>
          <span style={{
            fontSize: "0.8rem",
            background: "rgba(255, 255, 255, 0.08)",
            padding: "4px 10px",
            borderRadius: "100px",
            color: "var(--accent-color)",
            fontWeight: "bold",
            textTransform: "uppercase"
          }}>
            {user.role}
          </span>

          <div className="profile-meta">
            <div className="meta-row">
              <span className="meta-label">ID uživatele:</span>
              <span className="meta-value" title={userId}>{userId.substring(0, 12)}...</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">E-mail:</span>
              <span className="meta-value">{(user as any).mail || "Neznámý"}</span>
            </div>
          </div>

          <button
            className="btn btn-danger"
            style={{ width: "100%", marginTop: "1rem" }}
            onClick={() => loginUser(null)}
          >
            Odhlásit se 🚪
          </button>
        </div>
      </div>

      {/* Main Panel */}
      <div className="dashboard-main">
        {/* Profile Settings (generic variables) */}
        <div className="glass-card">
          <h2 style={{ marginBottom: "1rem", fontSize: "1.4rem" }}>⚙️ Nastavení Profilu (Generická Data)</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Tato pole (Jméno, Role, Barva motivu) jsou součástí generického typu <code>TUser</code>.
            Knihovna je automaticky ukládá do localStorage a synchronizuje s databází na serveru.
          </p>

          <form onSubmit={handleSaveProfile}>
            <div className="form-group">
              <label>Zobrazované jméno</label>
              <input
                type="text"
                className="form-control"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Role</label>
              <select
                className="form-control"
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as "admin" | "user")}
                style={{ background: "rgba(20, 18, 38, 0.95)" }}
              >
                <option value="user">Uživatel (User)</option>
                <option value="admin">Administrátor (Admin)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Barva motivu aplikace</label>
              <div className="color-picker">
                {themeOptions.map((opt) => (
                  <div
                    key={opt.value}
                    className={`color-option ${themeColor === opt.value ? "selected" : ""}`}
                    style={{ backgroundColor: opt.value, color: opt.value }}
                    onClick={() => setThemeColor(opt.value)}
                    title={opt.name}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "1.5rem" }}>
              <button type="submit" className="btn btn-primary">
                Uložit změny
              </button>
              {saveStatus && <span style={{ fontSize: "0.9rem", color: "var(--accent-emerald)" }}>{saveStatus}</span>}
            </div>
          </form>
        </div>

        {/* Protected API Test */}
        <div className="glass-card">
          <h2 style={{ marginBottom: "1rem", fontSize: "1.4rem" }}>🔒 Ověření chráněných API</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>
            Kliknutím na tlačítko níže odešlete požadavek na chráněný endpoint serveru. Express server zkontroluje
            přihlašovací cookies a vrátí zabezpečenou zprávu.
          </p>

          <button
            className="btn btn-secondary"
            onClick={handleCallProtectedApi}
            disabled={apiLoading}
          >
            {apiLoading ? "Ověřuji..." : "Volat chráněné API 🔓"}
          </button>

          {apiResult && (
            <div className={`custom-alert ${apiResult.success ? "custom-alert-success" : "custom-alert-error"}`}>
              <strong>{apiResult.success ? "Úspěch!" : "Chyba!"}</strong> {apiResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 3. Custom Reset Password Form
function ResetPasswordForm({ token, onCancel }: { token: string; onCancel: () => void }) {
  const { api, loginUser } = useUser<UserProfile>();
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  let validationError = "";
  if (password.length > 0 && password.length < 6) {
    validationError = dict.userWrongPasswordLength;
  } else if (password && passwordAgain && password !== passwordAgain) {
    validationError = dict.userWrongPasswordMatch;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || !password || !passwordAgain) return;

    setLoading(true);
    setError(null);

    const [userResult, err] = await api.updateForgottenPassword({ token, password });

    if (err) {
      setError(dict.userForgottenPasswordErrorChange);
    } else if (userResult) {
      setSuccess(true);
      // Automatically log the user in using the returned session profile
      setTimeout(() => {
        loginUser(userResult);
        onCancel();
      }, 2000);
    }
    setLoading(false);
  };

  return (
    <div className="glass-card" style={{ maxWidth: 500, margin: "2rem auto" }}>
      <h2 style={{ marginBottom: "1rem" }}>🔑 {dict.userForgottenPasswordChange}</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
        Zadejte nové heslo pro svůj účet. Token byl úspěšně ověřen.
      </p>

      {success ? (
        <div className="custom-alert custom-alert-success">
          {dict.userForgottenPasswordSuccessChange}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{dict.password}</label>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={50}
            />
          </div>

          <div className="form-group">
            <label>{dict.passwordAgain}</label>
            <input
              type="password"
              className="form-control"
              value={passwordAgain}
              onChange={(e) => setPasswordAgain(e.target.value)}
              required
              maxLength={50}
            />
          </div>

          {error && <div className="custom-alert custom-alert-error">{error}</div>}
          {validationError && <p style={{ fontSize: "0.85rem", color: "var(--accent-rose)", marginTop: "0.5rem" }}>{validationError}</p>}

          <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!!validationError || !password || !passwordAgain || loading}
            >
              {loading ? "Měním..." : dict.change}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Zrušit
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// 4. Developer simulated email receiver
function EmailConsoleSimulator({ onUseToken }: { onUseToken: (token: string) => void }) {
  const [latestMail, setLatestMail] = useState<{ mailTo: string; token: string; link: string; timestamp: number } | null>(null);

  // Poll server for simulated emails
  useEffect(() => {
    let active = true;

    const fetchLatestMail = async () => {
      try {
        const res = await fetch("/api/debug/latest-mail");
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          setLatestMail(data.latestMail);
        }
      } catch (_) { }
    };

    fetchLatestMail();
    const interval = setInterval(fetchLatestMail, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleClear = async () => {
    try {
      await fetch("/api/debug/clear-mail", { method: "POST" });
      setLatestMail(null);
    } catch (_) { }
  };

  return (
    <div className="dev-simulator">
      <div className="dev-simulator-header">
        <span className="dev-simulator-badge">💻 Vývojářská konzole e-mailů (Simulátor)</span>
        {latestMail && (
          <button className="dev-simulator-clear" onClick={handleClear}>
            Vymazat poštu 🗑️
          </button>
        )}
      </div>

      {latestMail ? (
        <div className="mail-envelope">
          <div><strong>Čas:</strong> {new Date(latestMail.timestamp).toLocaleTimeString()}</div>
          <div><strong>Odesílatel:</strong> easy-user-auth system</div>
          <div><strong>Příjemce:</strong> {latestMail.mailTo}</div>
          <div><strong>Předmět:</strong> Obnova hesla (Simulováno)</div>
          <div style={{ marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "8px" }}>
            Byl vygenerován odkaz pro obnovu hesla. Můžete na něj rovnou kliknout a vyzkoušet reset hesla v této záložce:
          </div>
          <a
            href="#"
            className="mail-link"
            onClick={(e) => {
              e.preventDefault();
              onUseToken(latestMail.token);
            }}
          >
            Resetovat heslo s tokenem: {latestMail.token}
          </a>
        </div>
      ) : (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>
          Žádná nová pošta. Pokud si chcete vyzkoušet obnovu zapomenutého hesla, odhlaste se, otevřete přihlašovací dialog, klikněte na "Zapomněli jste heslo?" a odešlete svůj e-mail. Zde se následně objeví vygenerovaný odkaz.
        </p>
      )}
    </div>
  );
}
