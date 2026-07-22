/**
 * Represents a unique UUID string.
 */
export type UUID = string;

/**
 * ISO 8601 formatted datetime string.
 */
export type DateTime = string;

/**
 * ISO Language code string (e.g. "en", "cs").
 */
export type Lang = string;

/**
 * The user record shape stored in the database.
 * Combines generic user profile properties (TUser) with security/auth fields.
 */
export type UserDB<TUser> = TUser & {
    /** Unique database identifier for the user. */
    _id: string;
    /** User's primary email address. */
    mail: string;
    /** Password hash (Argon2ID). */
    password: string;
    /** Password recovery state. Null if no recovery is active. */
    passwordRecovery: null | {
        /** Language code used when the recovery was requested. */
        lang?: Lang;
        /** Expiration datetime for the recovery token. */
        dateTo: string;
        /** Hashed password recovery token. */
        token: string;
    };
    /** Array of active SHA-256 hashed refresh tokens. */
    refreshTokens: string[];
};

/**
 * The user object returned to the frontend client after registration or login.
 * Combines custom profile data (TUser) with session details.
 */
export type UserClient<TUser> = TUser & {
    /** The authenticated user's ID. */
    userId: string;
    /** User's primary email address. */
    mail: string;
    /** Active JSON Web Token (JWT) access token for the session. */
    token: string;
};

/**
 * Parameters required to authenticate a user.
 */
export type UserLogin = {
    /** User's login email address. */
    mail: string;
    /** User's plain text password. */
    password: string;
};

/**
 * Parameters required to register a user.
 */
export type UserRegistration = UserLogin & {
    /** Whether the user accepted the terms and conditions. */
    termsAccepted?: boolean;
};

/**
 * Secure storage payload used for local state/cookie fallback credentials.
 */
export type UserSecrets = {
    /** The authenticated user's ID. */
    userId: string;
    /** Active access token. */
    token: string;
};
