
const express = require("express");
const crypto = require("crypto");

function registerBackboneRoutes(app, pool, accountAuth) {
    const router = express.Router();

    router.use(accountAuth);

    function generateRoomCode() {
        const number = crypto.randomInt(0, 10000);
        return `SGX${String(number).padStart(4, "0")}`;
    }

    // Criar sala
    router.post("/rooms", async (req, res) => {
        const playerId = req.player.id;
        const maxPlayers = Number(req.body.maxPlayers ?? 4);

        if (
            !Number.isInteger(maxPlayers) ||
            maxPlayers < 2 ||
            maxPlayers > 16
        ) {
            return res.status(400).json({
                error: "maxPlayers must be between 2 and 16"
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            for (let attempt = 0; attempt < 10; attempt++) {
                const code = generateRoomCode();

                const created = await client.query(
                    `INSERT INTO backbone_rooms
                        (code, owner_player_id, max_players)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (code) DO NOTHING
                     RETURNING id, code, owner_player_id,
                               selected_map, status, max_players,
                               created_at`,
                    [code, playerId, maxPlayers]
                );

                if (created.rowCount === 0) {
                    continue;
                }

                const room = created.rows[0];

                await client.query(
                    `INSERT INTO backbone_room_members
                        (room_id, player_id)
                     VALUES ($1, $2)`,
                    [room.id, playerId]
                );

                await client.query("COMMIT");

                return res.status(201).json({
                    message: "Room created",
                    room: {
                        ...room,
                        members: [{
                            player_id: playerId,
                            is_ready: false
                        }]
                    }
                });
            }

            throw new Error("Could not generate a unique room code");

        } catch (error) {
            await client.query("ROLLBACK");

            console.error("Create room error:", error);

            res.status(500).json({
                error: "Could not create room"
            });
        } finally {
            client.release();
        }
    });

    // Consultar sala
    router.get("/rooms/:code", async (req, res) => {
        const code = req.params.code;

        if (!/^SGX[0-9]{4}$/.test(code)) {
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
                                'player_id', m.player_id,
                                'nickname', p.nickname,
                                'tag_number', p.tag_number,
                                'is_ready', m.is_ready
                            )
                            ORDER BY m.joined_at
                        ) FILTER (WHERE m.id IS NOT NULL),
                        '[]'::json
                    ) AS members
                 FROM backbone_rooms r
                 LEFT JOIN backbone_room_members m
                    ON m.room_id = r.id
                 LEFT JOIN players p
                    ON p.id = m.player_id
                 WHERE r.code = $1
                 GROUP BY r.id`,
                [code]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = result.rows[0];

            const isMember = room.members.some(
                member => String(member.player_id) === String(req.player.id)
            );

            if (!isMember) {
                return res.status(403).json({
                    error: "You are not a member of this room"
                });
            }

            res.json({ room });

        } catch (error) {
            console.error("Get room error:", error);

            res.status(500).json({
                error: "Could not retrieve room"
            });
        }
    });

    // Entrar em uma sala
    router.post("/rooms/:code/join", async (req, res) => {
        const code = req.params.code;
        const playerId = req.player.id;

        if (!/^SGX[0-9]{4}$/.test(code)) {
            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const roomResult = await client.query(
                `SELECT *
                 FROM backbone_rooms
                 WHERE code = $1
                 FOR UPDATE`,
                [code]
            );

            if (roomResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = roomResult.rows[0];

            if (room.status !== "waiting") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Room is not accepting players"
                });
            }

            const existing = await client.query(
                `SELECT id
                 FROM backbone_room_members
                 WHERE room_id = $1 AND player_id = $2`,
                [room.id, playerId]
            );

            if (existing.rowCount > 0) {
                await client.query("COMMIT");

                return res.json({
                    message: "Already in room",
                    code
                });
            }

            const countResult = await client.query(
                `SELECT COUNT(*)::int AS total
                 FROM backbone_room_members
                 WHERE room_id = $1`,
                [room.id]
            );

            if (countResult.rows[0].total >= room.max_players) {
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

            await client.query("COMMIT");

            res.json({
                message: "Joined room",
                code
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error("Join room error:", error);

            res.status(500).json({
                error: "Could not join room"
            });
        } finally {
            client.release();
        }
    });

    // Sair de uma sala
    router.post("/rooms/:code/leave", async (req, res) => {
        const code = req.params.code;
        const playerId = req.player.id;

        if (!/^SGX[0-9]{4}$/.test(code)) {
            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const roomResult = await client.query(
                `SELECT *
                 FROM backbone_rooms
                 WHERE code = $1
                 FOR UPDATE`,
                [code]
            );

            if (roomResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = roomResult.rows[0];

            const membership = await client.query(
                `DELETE FROM backbone_room_members
                 WHERE room_id = $1 AND player_id = $2
                 RETURNING player_id`,
                [room.id, playerId]
            );

            if (membership.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    error: "You are not a member of this room"
                });
            }

            const remaining = await client.query(
                `SELECT player_id
                 FROM backbone_room_members
                 WHERE room_id = $1
                 ORDER BY joined_at ASC
                 LIMIT 1`,
                [room.id]
            );

            if (remaining.rowCount === 0) {
                await client.query(
                    `DELETE FROM backbone_rooms WHERE id = $1`,
                    [room.id]
                );
            } else if (String(room.owner_player_id) === String(playerId)) {
                await client.query(
                    `UPDATE backbone_rooms
                     SET owner_player_id = $1
                     WHERE id = $2`,
                    [remaining.rows[0].player_id, room.id]
                );
            }

            await client.query("COMMIT");

            res.json({
                message: "Left room"
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error("Leave room error:", error);

            res.status(500).json({
                error: "Could not leave room"
            });
        } finally {
            client.release();
        }
    });

    // Marcar ou desmarcar prontidão
    router.patch("/rooms/:code/ready", async (req, res) => {
        const code = req.params.code;
        const isReady = req.body.isReady;
        const playerId = req.player.id;

        if (!/^SGX[0-9]{4}$/.test(code)) {
            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        if (typeof isReady !== "boolean") {
            return res.status(400).json({
                error: "isReady must be true or false"
            });
        }

        try {
            const result = await pool.query(
                `UPDATE backbone_room_members m
                 SET is_ready = $1
                 FROM backbone_rooms r
                 WHERE m.room_id = r.id
                 AND r.code = $2
                 AND r.status = 'waiting'
                 AND m.player_id = $3
                 RETURNING m.player_id, m.is_ready`,
                [isReady, code, playerId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    error: "Room not found, not waiting, or player is not a member"
                });
            }

            res.json({
                message: "Ready status updated",
                player: result.rows[0]
            });

        } catch (error) {
            console.error("Ready status error:", error);

            res.status(500).json({
                error: "Could not update ready status"
            });
        }
    });

    // Escolher mapa
    router.patch("/rooms/:code/map", async (req, res) => {
        const code = req.params.code;
        const map = req.body.map;
        const playerId = req.player.id;

        if (!/^SGX[0-9]{4}$/.test(code)) {
            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        if (
            typeof map !== "string" ||
            map.trim().length === 0 ||
            map.length > 100
        ) {
            return res.status(400).json({
                error: "Invalid map name"
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
                    error: "Room not found or only the owner can select the map"
                });
            }

            res.json({
                message: "Map selected",
                room: result.rows[0]
            });

        } catch (error) {
            console.error("Map selection error:", error);

            res.status(500).json({
                error: "Could not select map"
            });
        }
    });

    // Iniciar partida e criar sessão
    router.post("/rooms/:code/start", async (req, res) => {
        const code = req.params.code;
        const playerId = req.player.id;
        const client = await pool.connect();

        if (!/^SGX[0-9]{4}$/.test(code)) {
            client.release();

            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        try {
            await client.query("BEGIN");

            const roomResult = await client.query(
                `SELECT *
                 FROM backbone_rooms
                 WHERE code = $1
                 FOR UPDATE`,
                [code]
            );

            if (roomResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = roomResult.rows[0];

            if (String(room.owner_player_id) !== String(playerId)) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    error: "Only the room owner can start"
                });
            }

            if (room.status !== "waiting" || !room.selected_map) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Room is not ready to start"
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
                    error: "At least 2 players are required"
                });
            }

            if (members.rows.some(member => !member.is_ready)) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "All players must be ready"
                });
            }

            const sessionResult = await client.query(
                `INSERT INTO backbone_game_sessions
                    (room_id, map_name, status)
                 VALUES ($1, $2, 'active')
                 RETURNING id, room_id, map_name, status, created_at`,
                [room.id, room.selected_map]
            );

            await client.query(
                `UPDATE backbone_rooms
                 SET status = 'playing'
                 WHERE id = $1`,
                [room.id]
            );

            await client.query("COMMIT");

            res.json({
                message: "Game session started",
                session: sessionResult.rows[0]
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error("Start game error:", error);

            res.status(500).json({
                error: "Could not start game session"
            });
        } finally {
            client.release();
        }
    });

    // Encerrar sessão de jogo
    router.post("/rooms/:code/finish", async (req, res) => {
        const code = req.params.code;
        const playerId = req.player.id;
        const client = await pool.connect();

        if (!/^SGX[0-9]{4}$/.test(code)) {
            client.release();

            return res.status(400).json({
                error: "Invalid room code"
            });
        }

        try {
            await client.query("BEGIN");

            const roomResult = await client.query(
                `SELECT *
                 FROM backbone_rooms
                 WHERE code = $1
                 FOR UPDATE`,
                [code]
            );

            if (roomResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Room not found"
                });
            }

            const room = roomResult.rows[0];

            if (String(room.owner_player_id) !== String(playerId)) {
                await client.query("ROLLBACK");

                return res.status(403).json({
                    error: "Only the room owner can finish"
                });
            }

            if (room.status !== "playing") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Room is not playing"
                });
            }

            const sessionResult = await client.query(
                `UPDATE backbone_game_sessions
                 SET status = 'finished',
                     finished_at = NOW()
                 WHERE room_id = $1
                 AND status = 'active'
                 RETURNING id, status, finished_at`,
                [room.id]
            );

            if (sessionResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Active game session not found"
                });
            }

            await client.query(
                `UPDATE backbone_rooms
                 SET status = 'finished'
                 WHERE id = $1`,
                [room.id]
            );

            await client.query("COMMIT");

            res.json({
                message: "Game session finished",
                session: sessionResult.rows[0]
            });

        } catch (error) {
            await client.query("ROLLBACK");

            console.error("Finish game error:", error);

            res.status(500).json({
                error: "Could not finish game session"
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
