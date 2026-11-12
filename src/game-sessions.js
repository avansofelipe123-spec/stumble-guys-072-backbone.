
async function startGameSession(pool, roomCode, playerId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `SELECT *
             FROM backbone_rooms
             WHERE code = $1
             FOR UPDATE`,
            [roomCode]
        );

        if (result.rowCount === 0) {
            throw new Error("Room not found");
        }

        const room = result.rows[0];

        if (room.owner_player_id !== playerId) {
            throw new Error("Only the room owner can start");
        }

        if (room.status !== "starting" || !room.selected_map) {
            throw new Error("Room is not ready to start");
        }

        const session = await client.query(
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

        return session.rows[0];

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function finishGameSession(pool, sessionId) {
    const result = await pool.query(
        `UPDATE backbone_game_sessions
         SET status = 'finished',
             finished_at = NOW()
         WHERE id = $1
         AND status = 'active'
         RETURNING id, status, finished_at`,
        [sessionId]
    );

    if (result.rowCount === 0) {
        throw new Error("Active game session not found");
    }

    await pool.query(
        `UPDATE backbone_rooms
         SET status = 'finished'
         WHERE id = (
             SELECT room_id
             FROM backbone_game_sessions
             WHERE id = $1
         )`,
        [sessionId]
    );

    return result.rows[0];
}

module.exports = {
    startGameSession,
    finishGameSession
};
