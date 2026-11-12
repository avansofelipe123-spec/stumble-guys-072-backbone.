
const express = require("express");
const http = require("http");
const { Pool } = require("pg");
const { attachRealtimeServer } = require("./realtime");
const { registerBackboneRoutes } = require("./backbone");

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

app.get("/", (req, res) => {
    res.json({
        service: "Stumble Guys 0.72 Backbone",
        status: "online",
        purpose: "Multiplayer rooms and realtime communication"
    });
});

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected" });
    } catch (error) {
        res.status(503).json({
            status: "error",
            database: "unavailable"
        });
    }
});

registerBackboneRoutes(app, pool);

const server = http.createServer(app);
attachRealtimeServer(server, pool);

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Backbone running on port ${PORT}`);
});
