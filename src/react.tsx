import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { UUID, UserClient } from "./types.js";

export const defaultDict = {
    userDialogLoggedInHeader: "You have logged in successfully.",
    logOut: "Log out",
    logIn: "Log in",
    userCreateAccount: "Create account",
    userDialogText: "Enter your credentials below:",
    mail: "Email",
    password: "Password",
    passwordAgain: "Confirm password",
    userWrongPasswordMatch: "Passwords do not match.",
    userWrongPasswordLength: "Password must be at least 6 characters.",
    userWrongMailFormat: "Invalid email format.",
    userWrongFill: "Please fill in all fields.",
    userErrorRegister: "Registration failed. Email might already be taken.",
    userErrorLogIn: "Invalid email or password.",
    registerIn: "Register",
    allRight: "Processing",
    userForgottenPasswordButton: "Forgot password?",
    userForgottenPassword: "Recover Password",
    userForgottenPasswordSuccess: "A recovery link has been sent (see below).",
    close: "Close",
    userWrongSendMail: "We couldn't send the recovery email.",
    userForgottenPasswordError: "Something went wrong.",
    userForgottenPasswordErrorSend: "Send recovery link",
    userForgottenPasswordErrorChange: "Unable to change password. The link might be invalid or expired.",
    userForgottenPasswordSuccessChange: "Password successfully updated. You are logged in.",
    backToHome: "Back to Home",
    userForgottenPasswordChange: "Change Password",
    change: "Save new password",
    userNamePlaceholder: "Your Name",
    save: "Save",
};

export type UserDictionary = typeof defaultDict;

export type UserContextType<TUser> = {
    userId: UUID;
    user: TUser;
    isLoggedIn: boolean;
    showUserDialog: () => void;
    closeUserDialog: () => void;
    showForgotDialog: (email?: string) => void;
    closeForgotDialog: () => void;
    dialogMail: string;
    setDialogMail: (mail: string) => void;
    setUser: (user: TUser) => void;
    loginUser: (user: null | UserClient<TUser>) => void;
    dict: UserDictionary;
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
    dict?: Partial<UserDictionary>;
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
    dict: customDict,
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

    const dict = useMemo(() => {
        return { ...defaultDict, ...customDict };
    }, [customDict]);

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [showUserDialog, setShowUserDialog] = useState(false);
    const [showForgotDialog, setShowForgotDialog] = useState(false);
    const [dialogMail, setDialogMail] = useState("");
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
                showForgotDialog: (email?: string) => {
                    if (email) setDialogMail(email);
                    setShowForgotDialog(true);
                },
                closeForgotDialog: () => setShowForgotDialog(false),
                dialogMail,
                setDialogMail,
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
                    <div className="easy-user-auth-overlay">
                        <div className="easy-user-auth-modal">
                            <button
                                className="easy-user-auth-close-btn"
                                onClick={() => setShowUserDialog(false)}
                            >
                                &times;
                            </button>
                            <UserDialog />
                        </div>
                    </div>
                )
            )}
            {renderDialog ? (
                renderDialog(showForgotDialog, () => setShowForgotDialog(false), (
                    <ForgottenPasswordForm
                        initialMail={dialogMail}
                        onBack={() => {
                            setShowForgotDialog(false);
                            setShowUserDialog(true);
                        }}
                    />
                ))
            ) : (
                showForgotDialog && (
                    <div className="easy-user-auth-overlay">
                        <div className="easy-user-auth-modal">
                            <button
                                className="easy-user-auth-close-btn"
                                onClick={() => setShowForgotDialog(false)}
                            >
                                &times;
                            </button>
                            <ForgottenPasswordForm
                                initialMail={dialogMail}
                                onBack={() => {
                                    setShowForgotDialog(false);
                                    setShowUserDialog(true);
                                }}
                            />
                        </div>
                    </div>
                )
            )}
        </UserContext.Provider>
    );
}
export type UserDialogProps = {
    isRegisterMode?: boolean;
    onRegisterModeChange?: (mode: boolean) => void;
    renderTabs?: (
        isRegisterMode: boolean,
        setRegisterMode: (mode: boolean) => void,
        loginForm: React.ReactNode,
        registerForm: React.ReactNode
    ) => React.ReactNode;
};

// Unified Dialog component
export function UserDialog({
    isRegisterMode: controlledIsRegisterMode,
    onRegisterModeChange,
    renderTabs,
}: UserDialogProps = {}) {
    const { isLoggedIn, loginUser, dict } = useUser<any>();
    const [localRegisterMode, setLocalRegisterMode] = useState(false);

    const isRegisterMode = controlledIsRegisterMode !== undefined ? controlledIsRegisterMode : localRegisterMode;
    const setIsRegisterMode = onRegisterModeChange || setLocalRegisterMode;

    if (isLoggedIn) {
        return (
            <div className="user-dialog easy-user-auth-dialog">
                <p className="easy-user-auth-logged-in-header">{dict.userDialogLoggedInHeader}</p>
                <button className="easy-user-auth-logout-btn" onClick={() => loginUser(null)}>{dict.logOut}</button>
            </div>
        );
    }

    const loginForm = <LogInForm />;
    const registerForm = <RegisterForm />;

    return (
        <div className="user-dialog easy-user-auth-dialog">
            {renderTabs ? (
                renderTabs(isRegisterMode, setIsRegisterMode, loginForm, registerForm)
            ) : (
                <>
                    <div className="easy-user-auth-tabs">
                        <button
                            type="button"
                            className={`easy-user-auth-tab ${!isRegisterMode ? "easy-user-auth-tab-active" : ""}`}
                            onClick={() => setIsRegisterMode(false)}
                        >
                            {dict.logIn}
                        </button>
                        <button
                            type="button"
                            className={`easy-user-auth-tab ${isRegisterMode ? "easy-user-auth-tab-active" : ""}`}
                            onClick={() => setIsRegisterMode(true)}
                        >
                            {dict.userCreateAccount}
                        </button>
                    </div>
                    {isRegisterMode ? registerForm : loginForm}
                </>
            )}
        </div>
    );
}

// Form Component: LogIn
export function LogInForm() {
    const { loginUser, dict, api, showForgotDialog, closeUserDialog, dialogMail, setDialogMail } = useUser<any>();
    const [mail, setMail] = useState(dialogMail);
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("");
    const [isSending, setIsSending] = useState(false);

    const handleMailChange = (val: string) => {
        setMail(val);
        setDialogMail(val);
    };

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

    return (
        <form onSubmit={handleSave} className="easy-user-auth-form login-form">
            <p className="easy-user-auth-text">{dict.userDialogText}</p>
            <div className="easy-user-auth-form-input form-input">
                <label className="easy-user-auth-label">{dict.mail}</label>
                <input
                    type="email"
                    className="easy-user-auth-input"
                    value={mail}
                    onChange={(e) => handleMailChange(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="form-input easy-user-auth-form-input">
                <label className="easy-user-auth-label">{dict.password}</label>
                <input
                    type="password"
                    className="easy-user-auth-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>

            {message && <p className="easy-user-auth-alert alert">{message}</p>}

            {isSending ? (
                <div className="easy-user-auth-loading loading-spinner">{dict.allRight}...</div>
            ) : (
                <>
                    <p className="easy-user-auth-info info">{errorFeedback || dict.allRight}</p>
                    <button type="submit" disabled={!!errorFeedback || !mail || !password} className="easy-user-auth-submit-btn width">
                        {dict.logIn}
                    </button>
                    <a
                        onClick={() => {
                            closeUserDialog();
                            showForgotDialog(mail);
                        }}
                        className="easy-user-auth-forgot-link"
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
        <form onSubmit={handleSave} className="easy-user-auth-form register-form">
            <p className="easy-user-auth-text">{dict.userDialogText}</p>
            <div className="easy-user-auth-form-input form-input">
                <label className="easy-user-auth-label">{dict.mail}</label>
                <input
                    type="email"
                    className="easy-user-auth-input"
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="easy-user-auth-form-input form-input">
                <label className="easy-user-auth-label">{dict.password}</label>
                <input
                    type="password"
                    className="easy-user-auth-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>
            <div className="easy-user-auth-form-input form-input">
                <label className="easy-user-auth-label">{dict.passwordAgain}</label>
                <input
                    type="password"
                    className="easy-user-auth-input"
                    value={passwordAgain}
                    onChange={(e) => setPasswordAgain(e.target.value)}
                    maxLength={50}
                    required
                />
            </div>

            {message && <p className="easy-user-auth-alert alert">{message}</p>}

            {isSending ? (
                <div className="easy-user-auth-loading loading-spinner">{dict.allRight}...</div>
            ) : (
                <>
                    <p className="easy-user-auth-info info">{errorFeedback || dict.allRight}</p>
                    <button type="submit" disabled={!!errorFeedback || !mail || !password || !passwordAgain} className="easy-user-auth-submit-btn width">
                        {dict.registerIn}
                    </button>
                </>
            )}
        </form>
    );
}

// Form Component: ForgottenPassword
export function ForgottenPasswordForm({ lang, onBack, initialMail = "" }: { lang?: string; onBack?: (mail?: string) => void; initialMail?: string }) {
    const { dict, api, dialogMail, setDialogMail } = useUser<any>();
    const [mail, setMail] = useState(initialMail || dialogMail);

    const handleMailChange = (val: string) => {
        setMail(val);
        setDialogMail(val);
    };
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
        <form onSubmit={handleSend} className="easy-user-auth-form forgotten-password-form">
            <h3 className="easy-user-auth-title">{dict.userForgottenPassword}</h3>

            {result === "success" ? (
                <>
                    <p className="easy-user-auth-info info">{dict.userForgottenPasswordSuccess}</p>
                    {onBack ? (
                        <button type="button" className="easy-user-auth-back-btn" onClick={() => onBack(mail)}>{dict.close}</button>
                    ) : (
                        <p className="easy-user-auth-close-text">{dict.close}</p>
                    )}
                </>
            ) : (
                <>
                    <div className="easy-user-auth-form-input form-input">
                        <label className="easy-user-auth-label">{dict.mail}</label>
                        <input
                            type="email"
                            className="easy-user-auth-input"
                            value={mail}
                            onChange={(e) => handleMailChange(e.target.value)}
                            maxLength={50}
                            required
                        />
                    </div>

                    {result === "unknown-mail" && <p className="easy-user-auth-alert alert">{dict.userWrongSendMail}</p>}
                    {result === "error" && <p className="easy-user-auth-alert alert">{dict.userForgottenPasswordError}</p>}

                    {isSending ? (
                        <div className="easy-user-auth-loading loading-spinner">{dict.allRight}...</div>
                    ) : (
                        <>
                            <p className="easy-user-auth-info info">{errorFeedback}</p>
                            <button type="submit" disabled={!!errorFeedback || !mail} className="easy-user-auth-submit-btn width">
                                {dict.userForgottenPasswordErrorSend}
                            </button>
                            {onBack && (
                                <button type="button" className="easy-user-auth-back-btn width" onClick={() => onBack(mail)}>
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
