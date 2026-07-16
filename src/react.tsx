import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { UUID, UserClient } from "./types.js";

export type UserContextType<TUser> = {
    userId: UUID;
    user: TUser;
    isLoggedIn: boolean;
    showUserDialog: () => void;
    closeUserDialog: () => void;
    setUser: (user: TUser) => void;
    loginUser: (user: null | UserClient<TUser>) => void;
    dict: UserProviderProps<TUser>["dict"];
    api: EasyLoginClient<TUser>;
};

const UserContext = createContext<UserContextType<any> | undefined>(undefined);

export function useUser<TUser>() {
    const context = useContext(UserContext);
    if (!context) {
        throw new Error("useUser must be used within a UserProvider");
    }
    return context as UserContextType<TUser>;
}

import { EasyLoginClient } from "./client.js";

export type UserProviderProps<TUser> = {
    children: React.ReactNode;
    api?: EasyLoginClient<TUser>;
    serverUrl?: string;
    credentials?: RequestCredentials;
    defaultUser: TUser;
    userStoreKey?: string;
    userSecretStoreKey?: string;
    dict: {
        userDialogLoggedInHeader: string;
        logOut: string;
        logIn: string;
        userCreateAccount: string;
        userDialogText: string;
        mail: string;
        password: string;
        passwordAgain: string;
        userWrongPasswordMatch: string;
        userWrongPasswordLength: string;
        userWrongMailFormat: string;
        userWrongFill: string;
        userErrorRegister: string;
        userErrorLogIn: string;
        registerIn: string;
        allRight: string;
        userForgottenPasswordButton: string;
        userForgottenPassword: string;
        userForgottenPasswordSuccess: string;
        close: string;
        userWrongSendMail: string;
        userForgottenPasswordError: string;
        userForgottenPasswordErrorSend: string;
        userForgottenPasswordErrorChange: string;
        userForgottenPasswordSuccessChange: string;
        backToHome: string;
        userForgottenPasswordChange: string;
        change: string;
        userNamePlaceholder: string;
        save: string;
    };
    renderDialog?: (show: boolean, onClose: () => void, children: React.ReactNode) => React.ReactNode;
};

export function UserProvider<TUser>({
    children,
    api: providedApi,
    serverUrl,
    credentials,
    defaultUser,
    userStoreKey = "user",
    userSecretStoreKey = "user-secrets",
    dict,
    renderDialog,
}: UserProviderProps<TUser>) {
    const api = useMemo(() => {
        if (providedApi) return providedApi;
        return new EasyLoginClient<TUser>({
            serverUrl,
            credentials,
            userSecretStoreKey,
        });
    }, [providedApi, serverUrl, credentials, userSecretStoreKey]);

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [showUserDialog, setShowUserDialog] = useState(false);
    const [userId, setUserId] = useState<UUID>(() => {
        try {
            const cached = localStorage.getItem("guest-id");
            if (cached) return cached;
            const newId = "guest-" + Math.random().toString(36).substring(2, 15);
            localStorage.setItem("guest-id", newId);
            return newId;
        } catch (_) {
            return "guest-temp";
        }
    });
    const [user, setUserState] = useState<TUser>(defaultUser);

    // Load initial user details from cache on mount
    useEffect(() => {
        try {
            const cached = localStorage.getItem(userStoreKey);
            if (cached) {
                setUserState(JSON.parse(cached));
            }
        } catch (_) {}
    }, [userStoreKey]);

    // Save and sync user profile updates
    const setUser = useMemo(() => {
        let timeoutId: any;
        return (newUser: TUser) => {
            setUserState(newUser);
            try {
                localStorage.setItem(userStoreKey, JSON.stringify(newUser));
            } catch (_) {}

            if (isLoggedIn) {
                // Debounced server sync
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    api.updateUser(newUser);
                }, 2000);
            }
        };
    }, [isLoggedIn, userStoreKey, api]);

    const loginUser = useMemo(() => {
        return (userClient: null | UserClient<TUser>) => {
            if (!userClient) {
                setUserState(defaultUser);
                setIsLoggedIn(false);
                setUserId((() => {
                    try {
                        return localStorage.getItem("guest-id") || "guest-temp";
                    } catch (_) {
                        return "guest-temp";
                    }
                })());
                try {
                    localStorage.removeItem(userStoreKey);
                    localStorage.removeItem(userSecretStoreKey);
                } catch (_) {}
                // Call API logout to clear httpOnly cookies
                api.logout();
            } else {
                const { userId, token, ...profile } = userClient;
                setUserState(profile as unknown as TUser);
                setIsLoggedIn(true);
                setUserId(userId);
                try {
                    localStorage.setItem(userStoreKey, JSON.stringify(profile));
                    // Store secrets locally (optional/fallback in cookie-based auth)
                    localStorage.setItem(userSecretStoreKey, JSON.stringify({ userId, token }));
                } catch (_) {}
            }
            setShowUserDialog(false);
        };
    }, [defaultUser, userStoreKey, userSecretStoreKey, api]);

    // Check login state on mount
    useEffect(() => {
        let active = true;
        (async () => {
            const [fetchedUser, error] = await api.getUser();
            if (!active) return;

            if (error) {
                if (error.message === "jwt expired" || error.message === "Unauthorized") {
                    loginUser(null);
                }
            } else if (fetchedUser) {
                loginUser(fetchedUser);
            }
        })();
        return () => {
            active = false;
        };
    }, [api, loginUser]);

    return (
        <UserContext.Provider
            value={{
                userId,
                user,
                isLoggedIn,
                showUserDialog: () => setShowUserDialog(true),
                closeUserDialog: () => setShowUserDialog(false),
                setUser,
                loginUser,
                dict,
                api,
            }}
        >
            {children}
            {renderDialog ? (
                renderDialog(showUserDialog, () => setShowUserDialog(false), <UserDialog />)
            ) : (
                showUserDialog && (
                    <div className="easy-user-auth-overlay" style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0,0,0,0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 9999
                    }}>
                        <div className="easy-user-auth-modal" style={{
                            background: "var(--bg-color, white)",
                            padding: 24,
                            borderRadius: 8,
                            position: "relative",
                            minWidth: 320
                        }}>
                            <button
                                className="easy-user-auth-close-btn"
                                onClick={() => setShowUserDialog(false)}
                                style={{ position: "absolute", top: 8, right: 8 }}
                            >
                                &times;
                            </button>
                            <UserDialog />
                        </div>
                    </div>
                )
            )}
        </UserContext.Provider>
    );
}

// Unified Dialog component
export function UserDialog() {
    const { isLoggedIn, loginUser, dict } = useUser<any>();
    const [isRegisterMode, setIsRegisterMode] = useState(false);

    if (isLoggedIn) {
        return (
            <div className="user-dialog">
                <p>{dict.userDialogLoggedInHeader}</p>
                <button onClick={() => loginUser(null)}>{dict.logOut}</button>
            </div>
        );
    }

    return (
        <div className="user-dialog">
            <div className="easy-user-auth-tabs" style={{ display: "flex", marginBottom: 16 }}>
                <button
                    onClick={() => setIsRegisterMode(false)}
                    style={{
                        flex: 1,
                        padding: 8,
                        fontWeight: !isRegisterMode ? "bold" : "normal",
                        borderBottom: !isRegisterMode ? "2px solid #000" : "none",
                        background: "none",
                        border: "none",
                        cursor: "pointer"
                    }}
                >
                    {dict.logIn}
                </button>
                <button
                    onClick={() => setIsRegisterMode(true)}
                    style={{
                        flex: 1,
                        padding: 8,
                        fontWeight: isRegisterMode ? "bold" : "normal",
                        borderBottom: isRegisterMode ? "2px solid #000" : "none",
                        background: "none",
                        border: "none",
                        cursor: "pointer"
                    }}
                >
                    {dict.userCreateAccount}
                </button>
            </div>
            {isRegisterMode ? <RegisterForm /> : <LogInForm />}
        </div>
    );
}

// Form Component: LogIn
export function LogInForm() {
    const { loginUser, dict, api } = useUser<any>();
    const [mail, setMail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [showForgot, setShowForgot] = useState(false);

    let errorFeedback = "";
    if (mail.length > 0 && !mail.includes("@")) {
        errorFeedback = dict.userWrongMailFormat;
    } else if (password.length > 0 && password.length < 6) {
        errorFeedback = dict.userWrongPasswordLength;
    }

    async function handleSave(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (errorFeedback || !mail || !password) return;

        setIsSending(true);
        setMessage("");

        const [userResult, error] = await api.addLogin({
            mail,
            password,
        });

        if (error) {
            setMessage(dict.userErrorLogIn);
        } else if (userResult) {
            loginUser(userResult);
        }
        setIsSending(false);
    }

    if (showForgot) {
        return <ForgottenPasswordForm onBack={() => setShowForgot(false)} />;
    }

    return (
        <form onSubmit={handleSave} className="login-form">
            <p>{dict.userDialogText}</p>
            <div className="form-input">
                <label>{dict.mail}</label>
                <input
                    type="email"
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="form-input">
                <label>{dict.password}</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>

            {message && <p className="alert">{message}</p>}

            {isSending ? (
                <div className="loading-spinner">{dict.allRight}...</div>
            ) : (
                <>
                    <p className="info">{errorFeedback || dict.allRight}</p>
                    <button type="submit" disabled={!!errorFeedback || !mail || !password} className="width">
                        {dict.logIn}
                    </button>
                    <a
                        onClick={() => setShowForgot(true)}
                        style={{ display: "inline-block", paddingTop: "12px", cursor: "pointer", textDecoration: "underline" }}
                    >
                        {dict.userForgottenPasswordButton}
                    </a>
                </>
            )}
        </form>
    );
}

// Form Component: Register
export function RegisterForm() {
    const { user, loginUser, dict, api } = useUser<any>();
    const [mail, setMail] = useState("");
    const [password, setPassword] = useState("");
    const [passwordAgain, setPasswordAgain] = useState("");
    const [message, setMessage] = useState("");
    const [isSending, setIsSending] = useState(false);

    let errorFeedback = "";
    if (mail.length > 0 && !mail.includes("@")) {
        errorFeedback = dict.userWrongMailFormat;
    } else if (password.length > 0 && password.length < 6) {
        errorFeedback = dict.userWrongPasswordLength;
    } else if (password && passwordAgain && password !== passwordAgain) {
        errorFeedback = dict.userWrongPasswordMatch;
    }

    async function handleSave(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (errorFeedback || !mail || !password || !passwordAgain) return;

        setIsSending(true);
        setMessage("");

        // Pass the generic profile properties (spread user) plus mail, password
        const [userResult, error] = await api.addRegistration({
            ...user,
            mail,
            password,
        });

        if (error) {
            setMessage(dict.userErrorRegister);
        } else if (userResult) {
            loginUser(userResult);
        }
        setIsSending(false);
    }

    return (
        <form onSubmit={handleSave} className="register-form">
            <p>{dict.userDialogText}</p>
            <div className="form-input">
                <label>{dict.mail}</label>
                <input
                    type="email"
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="form-input">
                <label>{dict.password}</label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="form-input">
                <label>{dict.passwordAgain}</label>
                <input
                    type="password"
                    value={passwordAgain}
                    onChange={(e) => setPasswordAgain(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>

            {message && <p className="alert">{message}</p>}

            {isSending ? (
                <div className="loading-spinner">{dict.allRight}...</div>
            ) : (
                <>
                    <p className="info">{errorFeedback || dict.allRight}</p>
                    <button type="submit" disabled={!!errorFeedback || !mail || !password || !passwordAgain} className="width">
                        {dict.registerIn}
                    </button>
                </>
            )}
        </form>
    );
}

// Form Component: ForgottenPassword
export function ForgottenPasswordForm({ lang, onBack }: { lang?: string; onBack?: () => void }) {
    const { dict, api } = useUser<any>();
    const [mail, setMail] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [result, setResult] = useState<null | "error" | "success" | "unknown-mail">(null);

    let errorFeedback = "";
    if (mail.length > 0 && !mail.includes("@")) {
        errorFeedback = dict.userWrongMailFormat;
    }

    async function handleSend(e?: React.FormEvent) {
        if (e) e.preventDefault();
        if (errorFeedback || !mail) return;

        setIsSending(true);
        setResult(null);

        const [res, error] = await api.addForgottenPassword({ mail, lang });
        if (error) {
            setResult("error");
        } else if (res) {
            setResult(res.message);
        }
        setIsSending(false);
    }

    return (
        <form onSubmit={handleSend} className="forgotten-password-form">
            <h3>{dict.userForgottenPassword}</h3>

            {result === "success" ? (
                <>
                    <p className="info">{dict.userForgottenPasswordSuccess}</p>
                    {onBack ? (
                        <button type="button" onClick={onBack}>{dict.close}</button>
                    ) : (
                        <p>{dict.close}</p>
                    )}
                </>
            ) : (
                <>
                    <div className="form-input">
                        <label>{dict.mail}</label>
                        <input
                            type="email"
                            value={mail}
                            onChange={(e) => setMail(e.target.value)}
                            maxLength={50}
                            required
                        />
                    </div>

                    {result === "unknown-mail" && <p className="alert">{dict.userWrongSendMail}</p>}
                    {result === "error" && <p className="alert">{dict.userForgottenPasswordError}</p>}

                    {isSending ? (
                        <div className="loading-spinner">{dict.allRight}...</div>
                    ) : (
                        <>
                            <p className="info">{errorFeedback}</p>
                            <button type="submit" disabled={!!errorFeedback || !mail} className="width">
                                {dict.userForgottenPasswordErrorSend}
                            </button>
                            {onBack && (
                                <button type="button" className="width" style={{ marginTop: 8 }} onClick={onBack}>
                                    {dict.close}
                                </button>
                            )}
                        </>
                    )}
                </>
            )}
        </form>
    );
}
