
function registerBackboneRoutes(app, pool, accountAuth) {
    const express = require("express");
    const router = express.Router();

    // Todas as rotas exigem uma conta autenticada.
    router.use(accountAuth);

    // Criar sala
    router.post("/rooms", async (req, res) => {
        const playerId = req.player.id;
        const maxPlayers = req.body.maxPlayers ?? 4;

        if (
            !Number.isInteger(maxPlayers) ||
            maxPlayers < 2 ||
            maxPlayers > 16
        ) {
            return res.status(400).json({
                error: "Invalid player limit"
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            let room = null;

            for (let attempt = 0; attempt < 30; attempt++) {
                const number = require("crypto").randomInt(0, 10000);
                const code = "SGX" + String(number).padStart(4, "0");

                const result = await client.query(
                    `INSERT INTO backbone_rooms
                    (code, owner_player_id, max_players)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (code) DO NOTHING
                    RETURNING *`,
                    [code, playerId, maxPlayers]
                );

                if (result.rowCount > 0) {
                    room = result.rows[0];
                    break;
                }
            }

            if (!room) {
                await client.query("ROLLBACK");
                return res.status(503).json({
                    error: "Could not generate room code"
                });
            }

            await client.query(
                `INSERT INTO backbone_room_members
                (room_id, player_id)
                VALUES ($1, $2)`,
                [room.id, playerId]
            );

            await client.query("COMMIT");

            res.status(201).json({
                success: true,
                room: {
                    code: room.code,
                    ownerPlayerId: playerId,
                    maxPlayers: room.max_players,
                    status: room.status
                }
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Create room:", error);

            res.status(500).json({
                error: "Could not create room"
            });
        } finally {
            client.release();
        }
    });

    // Consultar sala e jogadores
    router.get("/rooms/:code", async (req, res) => {
        const code = String(req.params.code).toUpperCase();

        if (!/^SGX\d{4}$/.test(code)) {
            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        try {
            const result = await pool.query(
                `SELECT
                    r.id,
                    r.code,
                    r.owner_player_id,
                    r.selected_map,
                    r.status,
                    r.max_players,
                    r.created_at,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'playerId', m.player_id,
                                'ready', m.is_ready
                            )
                        ) FILTER (WHERE m.player_id IS NOT NULL),
                        '[]'
                    ) AS players
                FROM backbone_rooms r
                LEFT JOIN backbone_room_members m
                    ON m.room_id = r.id
                WHERE r.code = $1
                GROUP BY r.id`,
                [code]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: "Room not found"
                });
            }

            res.json({
                success: true,
                room: result.rows[0]
            });
        } catch (error) {
            console.error("Get room:", error);

            res.status(500).json({
                error: "Could not get room"
            });
        }
    });

    // Entrar na sala
    router.post("/rooms/:code/join", async (req, res) => {
        const code = String(req.params.code).toUpperCase();
        const playerId = req.player.id;
        const client = await pool.connect();

        if (!/^SGX\d{4}$/.test(code)) {
            client.release();

            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        try {
            await client.query("BEGIN");

            const result = await client.query(
                `SELECT * FROM backbone_rooms
                WHERE code = $1
                FOR UPDATE`,
                [code]
            );

            if (result.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = result.rows[0];

            if (room.status !== "waiting") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Room is not accepting players"
                });
            }

            const existing = await client.query(
                `SELECT id FROM backbone_room_members
                WHERE room_id = $1 AND player_id = $2`,
                [room.id, playerId]
            );

            if (existing.rowCount === 0) {
                const count = await client.query(
                    `SELECT COUNT(*)::int AS total
                    FROM backbone_room_members
                    WHERE room_id = $1`,
                    [room.id]
                );

                if (count.rows[0].total >= room.max_players) {
                    await client.query("ROLLBACK");

                    return res.status(409).json({
                        error: "Room is full"
                    });
                }

                await client.query(
                    `INSERT INTO backbone_room_members
                    (room_id, player_id)
                    VALUES ($1, $2)`,
                    [room.id, playerId]
                );
            }

            await client.query("COMMIT");

            res.json({
                success: true,
                code,
                message: "Joined room"
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Join room:", error);

            res.status(500).json({
                error: "Could not join room"
            });
        } finally {
            client.release();
        }
    });

    // Sair da sala
    router.post("/rooms/:code/leave", async (req, res) => {
        const code = String(req.params.code).toUpperCase();
        const playerId = req.player.id;

        try {
            const result = await pool.query(
                `SELECT id, owner_player_id
                FROM backbone_rooms
                WHERE code = $1`,
                [code]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = result.rows[0];

            const membership = await pool.query(
                `SELECT id FROM backbone_room_members
                WHERE room_id = $1 AND player_id = $2`,
                [room.id, playerId]
            );

            if (membership.rowCount === 0) {
                return res.status(403).json({
                    error: "You are not in this room"
                });
            }

            if (room.owner_player_id === playerId) {
                await pool.query(
                    `DELETE FROM backbone_rooms WHERE id = $1`,
                    [room.id]
                );

                return res.json({
                    success: true,
                    message: "Room closed"
                });
            }

            await pool.query(
                `DELETE FROM backbone_room_members
                WHERE room_id = $1 AND player_id = $2`,
                [room.id, playerId]
            );

            res.json({
                success: true,
                message: "Left room"
            });
        } catch (error) {
            console.error("Leave room:", error);

            res.status(500).json({
                error: "Could not leave room"
            });
        }
    });

    // Marcar como pronto
    router.patch("/rooms/:code/ready", async (req, res) => {
        const code = String(req.params.code).toUpperCase();
        const playerId = req.player.id;
        const { ready } = req.body;

        if (typeof ready !== "boolean") {
            return res.status(400).json({
                error: "Ready must be true or false"
            });
        }

        try {
            const result = await pool.query(
                `UPDATE backbone_room_members m
                SET is_ready = $1
                FROM backbone_rooms r
                WHERE r.id = m.room_id
                AND r.code = $2
                AND m.player_id = $3
                AND r.status = 'waiting'
                RETURNING m.player_id`,
                [ready, code, playerId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: "Room or membership not found"
                });
            }

            res.json({
                success: true,
                ready
            });
        } catch (error) {
            console.error("Ready:", error);

            res.status(500).json({
                error: "Could not update ready status"
            });
        }
    });

    // Escolher mapa (somente o dono)
    router.patch("/rooms/:code/map", async (req, res) => {
        const code = String(req.params.code).toUpperCase();
        const playerId = req.player.id;
        const { map } = req.body;

        if (
            typeof map !== "string" ||
            map.trim().length < 1 ||
            map.trim().length > 100
        ) {
            return res.status(400).json({
                error: "Invalid map"
            });
        }

        try {
            const result = await pool.query(
                `UPDATE backbone_rooms
                SET selected_map = $1
                WHERE code = $2
                AND owner_player_id = $3
                AND status = 'waiting'
                RETURNING code, selected_map`,
                [map.trim(), code, playerId]
            );

            if (result.rowCount === 0) {
                return res.status(403).json({
                    error: "Only the owner can select the map"
                });
            }

            res.json({
                success: true,
                room: result.rows[0]
            });
        } catch (error) {
            console.error("Select map:", error);

            res.status(500).json({
                error: "Could not select map"
            });
        }
    });

    // Iniciar partida
    router.post("/rooms/:code/start", async (req, res) => {
        const code = String(req.params.code).toUpperCase();
        const playerId = req.player.id;
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const result = await client.query(
                `SELECT * FROM backbone_rooms
                WHERE code = $1
                FOR UPDATE`,
                [code]
            );

            if (result.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = result.rows[0];

            if (room.owner_player_id !== playerId) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    error: "Only the owner can start"
                });
            }

            if (room.status !== "waiting" || !room.selected_map) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Choose a map before starting"
                });
            }

            const members = await client.query(
                `SELECT player_id, is_ready
                FROM backbone_room_members
                WHERE room_id = $1`,
                [room.id]
            );

            if (members.rowCount < 2) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "At least two players are required"
                });
            }

            const notReady = members.rows.some(
                member =>
                    member.player_id !== playerId &&
                    !member.is_ready
            );

            if (notReady) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "All other players must be ready"
                });
            }

            await client.query(
                `UPDATE backbone_rooms
                SET status = 'starting'
                WHERE id = $1`,
                [room.id]
            );

            await client.query("COMMIT");

            res.json({
                success: true,
                code,
                map: room.selected_map,
                status: "starting"
            });
        } catch (error) {
            await client.query("ROLLBACK");
            console.error("Start room:", error);

            res.status(500).json({
                error: "Could not start match"
            });
        } finally {
            client.release();
        }
    });

    app.use("/api/backbone", router);
}

module.exports = {
    registerBackboneRoutes
};
