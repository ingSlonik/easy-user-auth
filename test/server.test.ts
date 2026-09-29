import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { EasyLoginServer } from "../server.js";

function createMockReq(cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
    return {
        headers: {
            cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "),
            ...headers,
        },
    } as unknown as Request;
}

function createMockRes() {
    const cookies: Record<string, { value: string; options: any }> = {};
    const clearedCookies: Record<string, any> = {};
    const res: any = {
        cookies,
        clearedCookies,
        cookie(name: string, value: string, options: any) {
            cookies[name] = { value, options };
            return res;
        },
        clearCookie(name: string, options: any) {
            clearedCookies[name] = options;
            delete cookies[name];
            return res;
        },
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(data: any) {
            res.jsonData = data;
            return res;
        },
    };
    return res;
}

function createMockDb() {
    const users = new Map<string, any>();
    let idCounter = 1;
    let updateCount = 0;

    return {
        users,
        getUpdateCount: () => updateCount,
        resetUpdateCount: () => { updateCount = 0; },
        db: {
            insertUser: async (user: any) => {
                const id = String(idCounter++);
                users.set(id, { _id: id, ...user });
                return id;
            },
            getUserById: async (id: string) => {
                const u = users.get(id);
                return u ? JSON.parse(JSON.stringify(u)) : null;
            },
            getUserByMail: async (mail: string) => {
                for (const u of users.values()) {
                    if (u.mail === mail) return JSON.parse(JSON.stringify(u));
                }
                return null;
            },
            getUserByRecoveryToken: async (token: string) => {
                for (const u of users.values()) {
                    if (u.passwordRecovery?.token === token) return JSON.parse(JSON.stringify(u));
                }
                return null;
            },
            updateUser: async (id: string, user: any) => {
                updateCount++;
                // Simulate real DB async delay
                await new Promise((r) => setTimeout(r, 20));
                users.set(id, JSON.parse(JSON.stringify(user)));
            },
        },
    };
}

describe("EasyLoginServer - Grace Period & In-flight Mutex", () => {
    const activeServers: EasyLoginServer<any>[] = [];

    afterEach(() => {
        for (const s of activeServers) {
            s.destroy();
        }
        activeServers.length = 0;
    });

    function createServer(dbMock: ReturnType<typeof createMockDb>, gracePeriodMs = 60000) {
        const server = new EasyLoginServer({
            db: dbMock.db,
            jwtSecret: "test-secret-key-12345",
            mailSender: async () => {},
            gracePeriodMs,
        });
        activeServers.push(server);
        return server;
    }

    test("1. Login sets accessToken and refreshToken cookies", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const resReg = createMockRes();
        await server.addRegistration({ mail: "test@example.com", password: "password123" }, createMockReq(), resReg);

        const resLogin = createMockRes();
        const userClient = await server.addLogin({ mail: "test@example.com", password: "password123" }, createMockReq(), resLogin);

        assert.equal(userClient.mail, "test@example.com");
        assert.ok(resLogin.cookies.accessToken?.value);
        assert.ok(resLogin.cookies.refreshToken?.value);

        const userInDb = await dbMock.db.getUserById(userClient.userId);
        assert.equal(userInDb?.refreshTokens.length, 2);
    });

    test("2. Grace Period (RFC 6819): Old refresh token within 60s succeeds without DB wipe", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock, 60000);

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "grace@example.com", password: "password123" }, createMockReq(), resLogin);
        const oldRefreshToken = resLogin.cookies.refreshToken.value;

        // First refresh: rotates token
        const resRefresh1 = createMockRes();
        const req1 = createMockReq({ refreshToken: oldRefreshToken });
        const refreshed1 = await server.checkLogin(req1, resRefresh1);
        assert.ok(refreshed1);
        assert.equal(refreshed1.mail, "grace@example.com");
        const newRefreshToken = resRefresh1.cookies.refreshToken.value;
        assert.notEqual(newRefreshToken, oldRefreshToken);

        // Second request arrives with the OLD refresh token within 60s
        const resRefresh2 = createMockRes();
        const req2 = createMockReq({ refreshToken: oldRefreshToken });
        const refreshed2 = await server.checkLogin(req2, resRefresh2);

        // Must succeed!
        assert.ok(refreshed2);
        assert.equal(refreshed2.userId, refreshed1.userId);
        // Cookies should be re-applied with the new tokens
        assert.equal(resRefresh2.cookies.refreshToken.value, newRefreshToken);

        // Verify DB tokens were NOT wiped
        const userInDb = await dbMock.db.getUserById(refreshed1.userId);
        assert.equal(userInDb?.refreshTokens.length, 1);
    });

    test("3. In-flight Mutex: Multiple concurrent requests perform only 1 DB update", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock, 60000);

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "mutex@example.com", password: "password123" }, createMockReq(), resLogin);
        const oldRefreshToken = resLogin.cookies.refreshToken.value;

        dbMock.resetUpdateCount();

        // 10 concurrent requests sent at the exact same moment with the same old refresh token
        const concurrentCount = 10;
        const requests = Array.from({ length: concurrentCount }, () => {
            const res = createMockRes();
            const req = createMockReq({ refreshToken: oldRefreshToken });
            return server.checkLogin(req, res).then((auth) => ({ auth, res }));
        });

        const results = await Promise.all(requests);

        // All 10 requests must succeed
        for (const r of results) {
            assert.ok(r.auth);
            assert.equal(r.auth.mail, "mutex@example.com");
            assert.ok(r.res.cookies.accessToken?.value);
            assert.ok(r.res.cookies.refreshToken?.value);
        }

        // All 10 should have received the exact same rotated token pair
        const expectedRefreshToken = results[0].res.cookies.refreshToken.value;
        for (const r of results) {
            assert.equal(r.res.cookies.refreshToken.value, expectedRefreshToken);
        }

        // Real DB update count MUST be exactly 1!
        assert.equal(dbMock.getUpdateCount(), 1);

        // Active tokens in DB must be exactly 1
        const userInDb = await dbMock.db.getUserById(results[0].auth.userId);
        assert.equal(userInDb?.refreshTokens.length, 1);
    });

    test("4. Invalid/unknown token clears cookies but does NOT wipe DB refreshTokens", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const resLogin = createMockRes();
        const reg = await server.addRegistration({ mail: "keep@example.com", password: "password123" }, createMockReq(), resLogin);
        const validRefreshToken = resLogin.cookies.refreshToken.value;

        // Create a different refresh token signed with valid secret for the same user, but not in DB
        const fakeOldRefreshToken = jwt.sign(
            { sub: reg.userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
            "test-secret-key-12345-refresh"
        );

        const resReq = createMockRes();
        const req = createMockReq({ refreshToken: fakeOldRefreshToken });

        // Attempting to check login with unknown token should fail (401)
        await assert.rejects(async () => {
            await server.checkLogin(req, resReq);
        }, /Unauthorized/);

        // Cookies must be cleared on response
        assert.ok(resReq.clearedCookies.accessToken);
        assert.ok(resReq.clearedCookies.refreshToken);

        // But user's valid session in DB must NOT be wiped!
        const userInDb = await dbMock.db.getUserById(reg.userId);
        assert.equal(userInDb?.refreshTokens.length, 1, "DB refreshTokens must not be wiped for valid sessions");
    });

    test("5. Grace period expiration: Old token after grace period is rejected without DB wipe", async () => {
        const dbMock = createMockDb();
        // Use a short 50ms grace period for testing expiration
        const server = createServer(dbMock, 50);

        const resLogin = createMockRes();
        const reg = await server.addRegistration({ mail: "expire@example.com", password: "password123" }, createMockReq(), resLogin);
        const oldRefreshToken = resLogin.cookies.refreshToken.value;

        // Rotate token
        const resRefresh = createMockRes();
        await server.checkLogin(createMockReq({ refreshToken: oldRefreshToken }), resRefresh);

        // Wait for grace period to expire
        await new Promise((r) => setTimeout(r, 70));

        // Attempt to use old token after expiration
        const resExpired = createMockRes();
        await assert.rejects(async () => {
            await server.checkLogin(createMockReq({ refreshToken: oldRefreshToken }), resExpired);
        }, /Unauthorized/);

        // Cookies cleared for client
        assert.ok(resExpired.clearedCookies.accessToken);
        assert.ok(resExpired.clearedCookies.refreshToken);

        // DB tokens for user not wiped
        const userInDb = await dbMock.db.getUserById(reg.userId);
        assert.equal(userInDb?.refreshTokens.length, 1);
    });

    test("6. updateUser with expired access token succeeds when res is passed", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "update@example.com", password: "password123", name: "Initial" }, createMockReq(), resLogin);
        const refreshToken = resLogin.cookies.refreshToken.value;

        // Expired access token
        const expiredAccessToken = jwt.sign(
            { sub: "1", mail: "update@example.com", iat: Math.floor(Date.now() / 1000) - 2000, exp: Math.floor(Date.now() / 1000) - 1000 },
            "test-secret-key-12345"
        );

        const req = createMockReq({ accessToken: expiredAccessToken, refreshToken });
        const res = createMockRes();

        // Calling updateUser with res should auto-refresh and succeed
        await server.updateUser({ name: "Updated" }, req, res);

        const userInDb = await dbMock.db.getUserById("1");
        assert.equal(userInDb?.name, "Updated");
        assert.ok(res.cookies.accessToken?.value);
        assert.ok(res.cookies.refreshToken?.value);
    });

    test("7. getUser returns fresh accessToken if auto-refreshed", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "getuser@example.com", password: "password123", name: "User" }, createMockReq(), resLogin);
        const refreshToken = resLogin.cookies.refreshToken.value;

        // Expired access token
        const expiredAccessToken = jwt.sign(
            { sub: "1", mail: "getuser@example.com", iat: Math.floor(Date.now() / 1000) - 2000, exp: Math.floor(Date.now() / 1000) - 1000 },
            "test-secret-key-12345"
        );

        const req = createMockReq({ accessToken: expiredAccessToken, refreshToken });
        const res = createMockRes();

        const userClient = await server.getUser(req, res);
        assert.equal(userClient.mail, "getuser@example.com");
        assert.ok(userClient.token);
        assert.notEqual(userClient.token, expiredAccessToken);

        // Verify token is valid and unexpired
        const decoded = jwt.verify(userClient.token, "test-secret-key-12345") as any;
        assert.equal(decoded.sub, "1");
    });

    test("8. Express route PATCH /api/user passes res and auto-refreshes on expired token", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const routes: Record<string, Function> = {};
        const mockApp = {
            post: (p: string, h: Function) => { routes[`POST ${p}`] = h; },
            get: (p: string, h: Function) => { routes[`GET ${p}`] = h; },
            patch: (p: string, h: Function) => { routes[`PATCH ${p}`] = h; },
        };
        server.registerExpressRoutes(mockApp, "/api");

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "express@example.com", password: "password123", name: "Initial" }, createMockReq(), resLogin);
        const refreshToken = resLogin.cookies.refreshToken.value;

        // Expired access token
        const expiredAccessToken = jwt.sign(
            { sub: "1", mail: "express@example.com", iat: Math.floor(Date.now() / 1000) - 2000, exp: Math.floor(Date.now() / 1000) - 1000 },
            "test-secret-key-12345"
        );

        const req: any = createMockReq({ accessToken: expiredAccessToken, refreshToken });
        req.body = { name: "ExpressUpdated" };
        const res = createMockRes();

        const patchHandler = routes["PATCH /api/user"];
        assert.ok(patchHandler);
        await patchHandler(req, res);

        assert.equal(res.jsonData?.message, "success");
        const userInDb = await dbMock.db.getUserById("1");
        assert.equal(userInDb?.name, "ExpressUpdated");
        assert.ok(res.cookies.accessToken?.value);
        assert.ok(res.cookies.refreshToken?.value);
    });

    test("9. logout cleans up token from rotationGraceMap", async () => {
        const dbMock = createMockDb();
        const server = createServer(dbMock);

        const resLogin = createMockRes();
        await server.addRegistration({ mail: "logout@example.com", password: "password123" }, createMockReq(), resLogin);
        const refreshToken = resLogin.cookies.refreshToken.value;

        // First refresh puts old token into grace map
        const resRefresh = createMockRes();
        await server.checkLogin(createMockReq({ refreshToken }), resRefresh);
        const newRefreshToken = resRefresh.cookies.refreshToken.value;

        // Verify old token is in grace map
        const resGrace = createMockRes();
        const authInGrace = await server.checkLogin(createMockReq({ refreshToken }), resGrace);
        assert.ok(authInGrace);

        // Now logout with the old token or new token
        const resLogout = createMockRes();
        await server.logout(createMockReq({ refreshToken }), resLogout);

        // After logout, using that old token must fail
        const resAfter = createMockRes();
        await assert.rejects(async () => {
            await server.checkLogin(createMockReq({ refreshToken }), resAfter);
        }, /Unauthorized/);
    });
});

