import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { EasyLoginServer } from "easy-user-auth/server";
import { UserDB } from "easy-user-auth/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User Profile shape for our test application
export type UserProfile = {
  name: string;
  themeColor: string;
  role: "admin" | "user";
};

// In-memory Database Simulation
const usersDatabase = new Map<string, UserDB<UserProfile>>();
let latestMail: { mailTo: string; token: string; link: string; timestamp: number } | null = null;

const authServer = new EasyLoginServer<UserProfile>({
  jwtSecret: "test-secret-key-12345-very-secret",
  secureCookies: false, // Set to false for HTTP local testing
  db: {
    insertUser: async (userWithoutId) => {
      const newId = "usr_" + Math.random().toString(36).substring(2, 11);
      const newUser: UserDB<UserProfile> = {
        ...userWithoutId,
        _id: newId,
      };
      usersDatabase.set(newId, newUser);
      console.log(`[DB] Created user: ${newUser.mail} (ID: ${newId})`);
      return newId;
    },
    getUserById: async (id) => {
      const user = usersDatabase.get(id);
      return user || null;
    },
    getUserByMail: async (mail) => {
      for (const user of usersDatabase.values()) {
        if (user.mail.toLowerCase() === mail.toLowerCase()) {
          return user;
        }
      }
      return null;
    },
    getUserByRecoveryToken: async (token) => {
      for (const user of usersDatabase.values()) {
        if (user.passwordRecovery && user.passwordRecovery.token === token) {
          return user;
        }
      }
      return null;
    },
    updateUser: async (id, updatedUser) => {
      if (!usersDatabase.has(id)) {
        throw new Error(`User with ID ${id} not found.`);
      }
      usersDatabase.set(id, updatedUser);
      console.log(`[DB] Updated user: ${updatedUser.mail}`);
    },
  },
  mailSender: async (lang, mailTo, token) => {
    // In our test environment, we log to terminal and save locally for the UI simulator
    const resetLink = `http://localhost:5173/reset-password?token=${token}`;
    latestMail = {
      mailTo,
      token,
      link: resetLink,
      timestamp: Date.now(),
    };

    console.log("\n==================================================");
    console.log(`📨 SIMULATED OUTGOING EMAIL (Language: ${lang})`);
    console.log(`To: ${mailTo}`);
    console.log(`Token: ${token}`);
    console.log(`Reset Link: ${resetLink}`);
    console.log("==================================================\n");
  },
});

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Register all library endpoints (/api/login, /api/register, /api/user, etc.)
authServer.registerExpressRoutes(app, "/api");

// Protected custom endpoint demonstrating use of checkLogin / checkLoginUser
app.get("/api/secret-dashboard", async (req, res) => {
  try {
    const session = await authServer.checkLogin(req as any, res as any);
    const user = await authServer.checkLoginUser(req as any, res as any);

    res.json({
      success: true,
      message: `🔓 Access Granted! Greetings, Admin ${user.name || session.mail}. Here is your highly sensitive data: The secret password of the universe is '42'.`,
      serverTime: new Date().toISOString(),
      userRole: user.role,
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: error.message || "Unauthorized access.",
    });
  }
});

// Developer endpoint to fetch simulated inbox messages in the frontend UI
app.get("/api/debug/latest-mail", (req, res) => {
  res.json({ latestMail });
});

// Developer endpoint to clear simulated emails
app.post("/api/debug/clear-mail", (req, res) => {
  latestMail = null;
  res.json({ success: true });
});

// Serve static assets from "dist" folder in production
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// Fallback for Single Page Application client routing
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Authentication Backend Server running at http://localhost:${PORT}`);
  console.log(`🔒 Endpoints registered under /api/*`);
});
