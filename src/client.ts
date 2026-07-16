import { UserLogin, UserClient, Lang } from "./types.js";

/**
 * Configuration options for the EasyLogin browser API client.
 */
export type EasyLoginClientConfig = {
    /** The base URL of the authentication server (e.g. "https://api.mysite.com"). If empty, requests are relative to current host. */
    serverUrl?: string;
    /** The request credentials setting. Defaults to "include" to enable sending session cookies automatically. */
    credentials?: RequestCredentials;
    /** The storage key used to retrieve/store session credentials. Defaults to "user-secrets". */
    userSecretStoreKey?: string;
};

/**
 * Browser API client to interact with the authentication server endpoints.
 * Operates independently of any framework. Perfect for custom implementations, vanilla JS or custom hooks.
 */
export class EasyLoginClient<TUser> {
    private serverUrl: string;
    private credentials: RequestCredentials;
    private userSecretStoreKey: string;

    constructor(config?: EasyLoginClientConfig) {
        this.serverUrl = config?.serverUrl || "";
        this.credentials = config?.credentials || "include";
        this.userSecretStoreKey = config?.userSecretStoreKey || "user-secrets";
    }

    private async request<TResponse>(endpoint: string, method: "GET" | "POST" | "PATCH", body?: any): Promise<[TResponse | null, Error | null]> {
        const url = `${this.serverUrl}${endpoint}`;
        
        const headers: HeadersInit = {
            "Content-Type": "application/json",
        };

        if (this.credentials === "omit") {
            try {
                const cached = localStorage.getItem(this.userSecretStoreKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed.token) {
                        headers["Authorization"] = `Bearer ${parsed.token}`;
                    }
                }
            } catch (_) {}
        }

        const options: RequestInit = {
            method,
            headers,
            credentials: this.credentials,
        };

        if (body) {
            if (method === "GET") {
                const query = Object.entries(body)
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`)
                    .join("&");
                options.body = undefined;
            } else {
                options.body = JSON.stringify(body);
            }
        }

        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                let errorMsg = "Request failed";
                try {
                    const json = await response.json();
                    if (json.message) errorMsg = json.message;
                } catch (_) {}
                return [null, new Error(errorMsg)];
            }

            const json = await response.json();
            return [json as TResponse, null];
        } catch (e: any) {
            return [null, e instanceof Error ? e : new Error(String(e))];
        }
    }

    /**
     * Fetches the current authenticated user's profile and session details.
     * Uses session cookies (httpOnly cookies) under the hood.
     * @returns A promise resolving to a tuple [UserClient, Error].
     */
    async getUser(): Promise<[UserClient<TUser> | null, Error | null]> {
        return this.request<UserClient<TUser>>("/api/user", "GET");
    }

    /**
     * Authenticates a user using email and password.
     * Sets access and refresh cookies automatically upon successful login if supported by backend.
     * @param loginParams The login credentials (email and password).
     * @returns A promise resolving to a tuple [UserClient, Error].
     */
    async addLogin(loginParams: UserLogin): Promise<[UserClient<TUser> | null, Error | null]> {
        return this.request<UserClient<TUser>>("/api/login", "POST", loginParams);
    }

    /**
     * Registers a new user with custom profile data and credentials.
     * @param params Combined user profile fields and login credentials.
     * @returns A promise resolving to a tuple [UserClient, Error].
     */
    async addRegistration(params: TUser & UserLogin): Promise<[UserClient<TUser> | null, Error | null]> {
        return this.request<UserClient<TUser>>("/api/register", "POST", params);
    }

    /**
     * Updates the authenticated user's custom profile properties on the server.
     * @param userParams The updated user object.
     */
    async updateUser(userParams: TUser): Promise<[void | null, Error | null]> {
        return this.request<void>("/api/user", "PATCH", userParams);
    }

    /**
     * Requests a password recovery email for the specified email address.
     * @param mailParams Object containing target mail and optional lang code.
     */
    async addForgottenPassword(mailParams: { lang?: Lang; mail: string }): Promise<[{ message: "success" | "unknown-mail" } | null, Error | null]> {
        return this.request<{ message: "success" | "unknown-mail" }>("/api/forgot-password", "POST", mailParams);
    }

    /**
     * Updates/resets a user's password using a valid recovery token.
     * @param resetParams Object containing the recovery token and new password.
     */
    async updateForgottenPassword(resetParams: { token: string; password: string }): Promise<[UserClient<TUser> | null, Error | null]> {
        return this.request<UserClient<TUser>>("/api/reset-password", "POST", resetParams);
    }

    /**
     * Terminates the user session. Clears httpOnly tokens and invalidates the session on the server.
     */
    async logout(): Promise<[{ message: "success" } | null, Error | null]> {
        return this.request<{ message: "success" }>("/api/logout", "POST");
    }
}
