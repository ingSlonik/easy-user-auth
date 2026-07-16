import { Request, Response } from "express";
import * as v from "valibot";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { createHash, randomUUID } from "crypto";

import { UserDB, UserClient, UserLogin, UUID, Lang } from "./types.js";

// Validation Schemas
export const MailScheme = v.pipe(v.string(), v.email(), v.maxLength(50));
export const UUIDScheme = v.pipe(v.string(), v.uuid());

export const UserLoginSchema = v.object({
    mail: MailScheme,
    password: v.pipe(v.string(), v.minLength(6), v.maxLength(50)),
});

// Helper for hashing refresh tokens
function hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export type EasyLoginServerConfig<TUser> = {
    db: {
        insertUser: (user: Omit<UserDB<TUser>, "_id">) => Promise<string>;
        getUserById: (id: string) => Promise<UserDB<TUser> | null>;
        getUserByMail: (mail: string) => Promise<UserDB<TUser> | null>;
        getUserByRecoveryToken: (token: string) => Promise<UserDB<TUser> | null>;
        updateUser: (id: string, user: UserDB<TUser>) => Promise<void>;
    };
    jwtSecret: string;
    mailSender: (lang: string, mailTo: string, token: string) => Promise<void>;
    secureCookies?: boolean;
    cookieDomain?: string;
};

export class APIError extends Error {
    public status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export class EasyLoginServer<TUser> {
    private db: EasyLoginServerConfig<TUser>["db"];
    private jwtSecret: string;
    private mailSender: EasyLoginServerConfig<TUser>["mailSender"];
    private secureCookies: boolean;
    private cookieDomain?: string;

    constructor(config: EasyLoginServerConfig<TUser>) {
        this.db = config.db;
        this.jwtSecret = config.jwtSecret;
        this.mailSender = config.mailSender;
        this.secureCookies = config.secureCookies ?? (process.env.NODE_ENV === "production");
        this.cookieDomain = config.cookieDomain;
    }

    // Helper: Parse cookie from Request headers
    private getCookie(req: Request, name: string): string | null {
        const cookies = req.headers.cookie;
        if (!cookies) return null;
        const match = cookies.match(new RegExp("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)"));
        return match ? decodeURIComponent(match[2]) : null;
    }

    // Helper: Get token from Authorization header
    private getTokenFromHeader(req: Request): string | null {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }

    // Helper: Set cookies
    private setAuthCookies(res: Response, userId: string, name: string, mail: string, existingRefreshTokens: string[] = []): { token: string; refreshTokens: string[] } {
        const token = jwt.sign(
            {
                sub: userId,
                name,
                mail,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 mins
            },
            this.jwtSecret
        );

        const rawRefreshToken = jwt.sign(
            {
                sub: userId,
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
            },
            this.jwtSecret + "-refresh"
        );

        const hashed = hashRefreshToken(rawRefreshToken);
        const refreshTokens = [...existingRefreshTokens, hashed].slice(-5); // Keep last 5 sessions max

        res.cookie("accessToken", token, {
            httpOnly: true,
            secure: this.secureCookies,
            sameSite: "lax",
            maxAge: 15 * 60 * 1000, // 15 mins
            path: "/",
            ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
        });

        res.cookie("refreshToken", rawRefreshToken, {
            httpOnly: true,
            secure: this.secureCookies,
            sameSite: "lax",
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            path: "/",
            ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
        });

        return { token, refreshTokens };
    }

    // Helper: Clear cookies
    private clearAuthCookies(res: Response) {
        res.clearCookie("accessToken", {
            httpOnly: true,
            secure: this.secureCookies,
            sameSite: "lax",
            path: "/",
            ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
        });
        res.clearCookie("refreshToken", {
            httpOnly: true,
            secure: this.secureCookies,
            sameSite: "lax",
            path: "/",
            ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
        });
    }

    // CSRF Check for modifications if cookies are used
    private checkCSRF(req: Request) {
        const hasAuthHeader = !!this.getTokenFromHeader(req);
        if (hasAuthHeader) return; // Immune to CSRF

        const origin = req.headers.origin as string;
        const referer = req.headers.referer as string;
        const host = req.headers.host as string;

        const isLocalhost = (h: string) => {
            const clean = h.split(":")[0];
            return clean === "localhost" || clean === "127.0.0.1";
        };

        if (origin) {
            try {
                const originUrl = new URL(origin);
                if (originUrl.host !== host) {
                    if (!isLocalhost(originUrl.host) || !isLocalhost(host)) {
                        throw new APIError("CSRF validation failed: Origin mismatch", 403);
                    }
                }
            } catch (e) {
                if (e instanceof APIError) throw e;
                throw new APIError("CSRF validation failed: Invalid Origin", 403);
            }
        } else if (referer) {
            try {
                const refererUrl = new URL(referer);
                if (refererUrl.host !== host) {
                    if (!isLocalhost(refererUrl.host) || !isLocalhost(host)) {
                        throw new APIError("CSRF validation failed: Referer mismatch", 403);
                    }
                }
            } catch (e) {
                if (e instanceof APIError) throw e;
                throw new APIError("CSRF validation failed: Invalid Referer", 403);
            }
        }
    }

    // Auto-refresh token if expired but refresh token cookie is valid
    private async tryAutoRefresh(req: Request, res: Response): Promise<{ userId: string; name: string; mail: string } | null> {
        const refreshToken = this.getCookie(req, "refreshToken");
        if (!refreshToken) return null;

        try {
            const payload = jwt.verify(refreshToken, this.jwtSecret + "-refresh") as any;
            if (!payload || !payload.sub) return null;

            const userId = payload.sub;
            const user = await this.db.getUserById(userId);
            if (!user || !user.refreshTokens) return null;

            const hashed = hashRefreshToken(refreshToken);
            if (!user.refreshTokens.includes(hashed)) {
                // Reuse detected: clear tokens for safety
                await this.db.updateUser(userId, { ...user, refreshTokens: [] });
                this.clearAuthCookies(res);
                return null;
            }

            const name = (user as any).name || "";
            const { token: newAccessToken, refreshTokens: updatedRefreshes } = this.setAuthCookies(
                res,
                userId,
                name,
                user.mail,
                user.refreshTokens.filter((t: string) => t !== hashed)
            );

            await this.db.updateUser(userId, {
                ...user,
                refreshTokens: updatedRefreshes,
            });

            return {
                userId,
                name,
                mail: user.mail,
            };
        } catch (err) {
            return null;
        }
    }

    // 1. getUser
    async getUser(req: Request, res?: Response): Promise<UserClient<TUser>> {
        const auth = await this.checkLogin(req, res);
        const user = await this.db.getUserById(auth.userId);
        if (!user) throw new APIError("User not found", 404);

        // Get access token from cookie or regenerate it
        let accessToken = this.getTokenFromHeader(req) || this.getCookie(req, "accessToken");
        if (!accessToken && res) {
            // Regenerate
            const name = (user as any).name || "";
            const { token } = this.setAuthCookies(res, auth.userId, name, user.mail, user.refreshTokens || []);
            accessToken = token;
        }

        const { password, refreshTokens, passwordRecovery, ...profileData } = user;

        return {
            userId: auth.userId,
            token: accessToken || "",
            ...(profileData as unknown as TUser),
        };
    }

    // 2. addLogin
    async addLogin(loginParams: UserLogin, req: Request, res?: Response): Promise<UserClient<TUser>> {
        this.checkCSRF(req);
        const { mail, password } = v.parse(UserLoginSchema, loginParams);

        const user = await this.db.getUserByMail(mail);

        if (user && await argon2.verify(user.password, password)) {
            const name = (user as any).name || "";
            let token = "";
            let refreshTokens = user.refreshTokens || [];

            if (res) {
                const cookiesResult = this.setAuthCookies(res, user._id, name, mail, refreshTokens);
                token = cookiesResult.token;
                refreshTokens = cookiesResult.refreshTokens;
            } else {
                // Cookie-less fallback
                token = jwt.sign(
                    { sub: user._id, name, mail, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 },
                    this.jwtSecret
                );
            }

            await this.db.updateUser(user._id, {
                ...user,
                refreshTokens,
            });

            const { password: _, refreshTokens: __, passwordRecovery: ___, ...profileData } = user;

            return {
                userId: user._id,
                token,
                ...(profileData as unknown as TUser),
            };
        }

        throw new APIError("Invalid credentials", 401);
    }

    // 3. addRegistration
    async addRegistration(params: TUser & UserLogin, req: Request, res?: Response): Promise<UserClient<TUser>> {
        this.checkCSRF(req);
        const { mail, password } = v.parse(UserLoginSchema, params);

        // Extract generic profile properties
        const { mail: _, password: __, ...profileFields } = params as any;
        const profileData = profileFields as TUser;

        const existingUser = await this.db.getUserByMail(mail);
        if (existingUser) {
            throw new APIError("User already exists", 400);
        }

        const passwordHash = await argon2.hash(password);
        const name = (profileData as any).name || "";

        const userId = await this.db.insertUser({
            ...profileData,
            mail,
            password: passwordHash,
            passwordRecovery: null,
            refreshTokens: [] as string[],
        } as any);

        let token = "";
        let refreshTokens: string[] = [];

        if (res) {
            const cookiesResult = this.setAuthCookies(res, userId, name, mail, []);
            token = cookiesResult.token;
            refreshTokens = cookiesResult.refreshTokens;

            // Save refresh tokens to DB
            const userRecord = await this.db.getUserById(userId);
            if (userRecord) {
                await this.db.updateUser(userId, {
                    ...userRecord,
                    refreshTokens,
                });
            }
        } else {
            token = jwt.sign(
                { sub: userId, name, mail, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 },
                this.jwtSecret
            );
        }

        return {
            userId,
            token,
            ...profileData,
        };
    }

    // 4. updateUser
    async updateUser(userParams: TUser, req: Request): Promise<void> {
        this.checkCSRF(req);
        const profileData = userParams;
        const auth = await this.checkLogin(req);

        const user = await this.db.getUserById(auth.userId);
        if (!user) throw new APIError("User not found", 404);

        await this.db.updateUser(auth.userId, {
            ...user,
            ...profileData,
        });
    }

    // 5. addForgottenPassword
    async addForgottenPassword({ lang, mail }: { lang: Lang; mail: string }): Promise<{ message: "success" | "unknown-mail" }> {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const user = await this.db.getUserByMail(mail);
        if (!user) {
            return { message: "unknown-mail" };
        }

        const dateTo = new Date();
        dateTo.setDate(dateTo.getDate() + 1);

        const token = randomUUID();
        const formattedDate = dateTo.toISOString().slice(0, 10);

        await this.db.updateUser(user._id, {
            ...user,
            passwordRecovery: {
                lang,
                dateTo: formattedDate,
                token,
            },
        });

        await this.mailSender(lang, mail, token);

        return { message: "success" };
    }

    // 6. updateForgottenPassword
    async updateForgottenPassword({ token, password }: { token: string; password: string }, req: Request, res?: Response): Promise<UserClient<TUser>> {
        this.checkCSRF(req);
        if (password.length < 6) throw new APIError("Password must be at least 6 characters long", 400);

        const user = await this.db.getUserByRecoveryToken(token);
        if (!user) {
            throw new APIError("Invalid token", 400);
        }

        const dateNow = new Date().toISOString().slice(0, 10);
        if (user.passwordRecovery!.dateTo < dateNow) {
            throw new APIError("Token expired", 400);
        }

        const passwordHash = await argon2.hash(password);
        const name = (user as any).name || "";

        let authToken = "";
        let refreshTokens = user.refreshTokens || [];

        if (res) {
            const cookiesResult = this.setAuthCookies(res, user._id, name, user.mail, refreshTokens);
            authToken = cookiesResult.token;
            refreshTokens = cookiesResult.refreshTokens;
        } else {
            authToken = jwt.sign(
                { sub: user._id, name, mail: user.mail, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 },
                this.jwtSecret
            );
        }

        await this.db.updateUser(user._id, {
            ...user,
            password: passwordHash,
            passwordRecovery: null,
            refreshTokens,
        });

        const { password: _, refreshTokens: __, passwordRecovery: ___, ...profileData } = user;

        return {
            userId: user._id,
            token: authToken,
            ...(profileData as unknown as TUser),
        };
    }

    // 7. logout
    async logout(req: Request, res?: Response): Promise<{ message: "success" }> {
        if (res) {
            try {
                const auth = await this.checkLogin(req, res);
                if (auth) {
                    const user = await this.db.getUserById(auth.userId);
                    if (user && user.refreshTokens) {
                        const currentRefresh = this.getCookie(req, "refreshToken");
                        if (currentRefresh) {
                            const hashed = hashRefreshToken(currentRefresh);
                            const updated = user.refreshTokens.filter((t: string) => t !== hashed);
                            await this.db.updateUser(auth.userId, {
                                ...user,
                                refreshTokens: updated,
                            });
                        }
                    }
                }
            } catch (e) {
                // Ignore error if already unauthenticated
            }
            this.clearAuthCookies(res);
        }
        return { message: "success" };
    }

    // Middlewares / Helpers
    async checkLogin(req: Request, res?: Response): Promise<{ userId: string; name: string; mail: string }> {
        let token = this.getTokenFromHeader(req);
        if (!token) {
            token = this.getCookie(req, "accessToken");
        }

        if (token) {
            try {
                const payload = jwt.verify(token, this.jwtSecret) as any;
                if (payload && payload.sub && typeof payload.sub === "string") {
                    return {
                        userId: payload.sub,
                        name: payload.name || "",
                        mail: payload.mail || "",
                    };
                }
            } catch (jwtError: any) {
                if (jwtError.name === "TokenExpiredError" && res) {
                    const refreshed = await this.tryAutoRefresh(req, res);
                    if (refreshed) {
                        return refreshed;
                    }
                }
            }
        } else if (res) {
            const refreshed = await this.tryAutoRefresh(req, res);
            if (refreshed) {
                return refreshed;
            }
        }

        throw new APIError("Unauthorized", 401);
    }

    async checkLoginUser(req: Request, res?: Response): Promise<UserDB<TUser>> {
        const { userId } = await this.checkLogin(req, res);
        const user = await this.db.getUserById(userId);
        if (!user) throw new APIError("User not found", 404);
        return user;
    }

    // Single function route registration for Express apps
    registerExpressRoutes(app: any, prefix = "/api") {
        const sendError = (res: Response, e: any) => {
            const status = e && typeof e === "object" && typeof e.status === "number" ? e.status : 400;
            const message = e && typeof e === "object" && typeof e.message === "string" ? e.message : String(e);
            res.status(status).json({ message });
        };

        app.post(`${prefix}/login`, async (req: Request, res: Response) => {
            try {
                const result = await this.addLogin(req.body, req, res);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });

        app.post(`${prefix}/register`, async (req: Request, res: Response) => {
            try {
                const result = await this.addRegistration(req.body, req, res);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });

        app.get(`${prefix}/user`, async (req: Request, res: Response) => {
            try {
                const result = await this.getUser(req, res);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });

        app.patch(`${prefix}/user`, async (req: Request, res: Response) => {
            try {
                await this.updateUser(req.body, req);
                res.json({ message: "success" });
            } catch (e) {
                sendError(res, e);
            }
        });

        app.post(`${prefix}/forgot-password`, async (req: Request, res: Response) => {
            try {
                const result = await this.addForgottenPassword(req.body);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });

        app.post(`${prefix}/reset-password`, async (req: Request, res: Response) => {
            try {
                const result = await this.updateForgottenPassword(req.body, req, res);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });

        app.post(`${prefix}/logout`, async (req: Request, res: Response) => {
            try {
                const result = await this.logout(req, res);
                res.json(result);
            } catch (e) {
                sendError(res, e);
            }
        });
    }
}
