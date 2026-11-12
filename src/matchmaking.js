
async function findAvailableRoom(pool, playerId) {
    const result = await pool.query(
        `SELECT
            r.id,
            r.code,
            r.selected_map,
            r.max_players,
            COUNT(m.id)::int AS current_players
        FROM backbone_rooms r
        LEFT JOIN backbone_room_members m
            ON m.room_id = r.id
        WHERE r.status = 'waiting'
        AND r.id NOT IN (
            SELECT room_id
            FROM backbone_room_members
            WHERE player_id = $1
        )
        GROUP BY r.id
        HAVING COUNT(m.id) < r.max_players
        ORDER BY COUNT(m.id) DESC, r.created_at ASC
        LIMIT 1`,
        [playerId]
    );

    return result.rows[0] || null;
}

async function findOrCreateMatch(pool, playerId) {
    const room = await findAvailableRoom(pool, playerId);

    if (!room) {
        return {
            found: false,
            message: "No available room found"
        };
    }

    return {
        found: true,
        room: {
            code: room.code,
            map: room.selected_map,
            players: room.current_players,
            maxPlayers: room.max_players
        }
    };
}

module.exports = {
    findAvailableRoom,
    findOrCreateMatch
};
