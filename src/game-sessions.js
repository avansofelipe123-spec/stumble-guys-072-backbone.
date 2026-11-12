
async function startGameSession(pool, roomCode, playerId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const roomResult = await client.query(
            `SELECT *
             FROM backbone_rooms
             WHERE code = $1
             FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            throw new Error("Room not found");
        }

        const room = roomResult.rows[0];

        if (String(room.owner_player_id) !== String(playerId)) {
            throw new Error("Only the room owner can start");
        }

        if (room.status !== "waiting") {
            throw new Error("Room is not waiting");
        }

        if (!room.selected_map) {
            throw new Error("No map selected");
        }

        const members = await client.query(
            `SELECT player_id, is_ready
             FROM backbone_room_members
             WHERE room_id = $1`,
            [room.id]
        );

        if (members.rowCount < 2) {
            throw new Error("At least 2 players are required");
        }

        if (members.rows.some(member => !member.is_ready)) {
            throw new Error("All players must be ready");
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

        return sessionResult.rows[0];

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
}

async function finishGameSession(pool, roomCode, playerId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const roomResult = await client.query(
            `SELECT *
             FROM backbone_rooms
             WHERE code = $1
             FOR UPDATE`,
            [roomCode]
        );

        if (roomResult.rowCount === 0) {
            throw new Error("Room not found");
        }

        const room = roomResult.rows[0];

        if (String(room.owner_player_id) !== String(playerId)) {
            throw new Error("Only the room owner can finish");
        }

        if (room.status !== "playing") {
            throw new Error("Room is not playing");
        }

        const sessionResult = await client.query(
            `UPDATE backbone_game_sessions
             SET status = 'finished',
                 finished_at = NOW()
             WHERE room_id = $1
             AND status = 'active'
             RETURNING id, room_id, status, finished_at`,
            [room.id]
        );

        if (sessionResult.rowCount === 0) {
            throw new Error("Active game session not found");
        }

        await client.query(
            `UPDATE backbone_rooms
             SET status = 'finished'
             WHERE id = $1`,
            [room.id]
        );

        await client.query("COMMIT");

        return sessionResult.rows[0];

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
}

module.exports = {
    startGameSession,
    finishGameSession
};
