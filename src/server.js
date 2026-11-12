
const express = require("express");
const http = require("http");
const { Pool } = require("pg");

const { createAccountAuth } = require("./auth");
const { registerBackboneRoutes } = require("./backbone");
const { attachRealtimeServer } = require("./realtime");

const app = express();

app.use(express.json({ limit: "32kb" }));

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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
        res.status(503).json({
            status: "error",
            database: "unavailable"
        });
    }
});

registerBackboneRoutes(app, pool, accountAuth);

const server = http.createServer(app);

attachRealtimeServer(server, pool);

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Backbone running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
    server.close();
    await pool.end();
    process.exit(0);
});
