
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const { createAccountAuth } = require("./auth");
const { registerBackboneRoutes } = require("./backbone");
const { attachRealtimeServer } = require("./realtime");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "32kb" }));

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    connectionTimeoutMillis: 10000
});

const accountAuth = createAccountAuth(pool);

app.get("/", (req, res) => {
    res.json({
        service: "Stumble Guys 0.72 Backbone",
        status: "online"
    });
});

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            status: "ok",
            database: "connected"
        });
    } catch (error) {
        console.error("Health check error:", error.message);

        res.status(503).json({
            status: "error",
            database: "unavailable"
        });
    }
});

registerBackboneRoutes(app, pool, accountAuth);

attachRealtimeServer(server, pool);

async function startServer() {
    try {
        console.log("Connecting to database...");

        await pool.query("SELECT 1");

        console.log("Database connection established.");

        const schemaPath = path.join(
            __dirname,
            "..",
            "database",
            "schema.sql"
        );

        const schema = fs.readFileSync(schemaPath, "utf8");

        if (!schema.trim()) {
            throw new Error("Database schema is empty");
        }

        console.log("Initializing Backbone database tables...");

        await pool.query(schema);

        console.log("Backbone database tables initialized.");

        server.listen(PORT, "0.0.0.0", () => {
            console.log(`Backbone running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Backbone startup failed:", error);
        await pool.end();
        process.exit(1);
    }
}

async function shutdown() {
    console.log("Shutting down Backbone...");

    server.close(async () => {
        await pool.end();
        process.exit(0);
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer();
