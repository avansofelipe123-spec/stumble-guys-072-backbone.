
-- =========================================
-- STUMBLE GUYS 0.72 - BACKBONE DATABASE
-- Usa a tabela players do backend original.
-- =========================================

CREATE TABLE IF NOT EXISTS backbone_rooms (
    id BIGSERIAL PRIMARY KEY,

    code VARCHAR(7) NOT NULL UNIQUE,

    owner_player_id BIGINT NOT NULL
        REFERENCES players(id) ON DELETE CASCADE,

    selected_map VARCHAR(100),

    status VARCHAR(20) NOT NULL DEFAULT 'waiting',

    max_players INTEGER NOT NULL DEFAULT 4,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT backbone_room_code_format
        CHECK (code ~ '^SGX[0-9]{4}$'),

    CONSTRAINT backbone_room_status
        CHECK (status IN (
            'waiting',
            'starting',
            'playing',
            'finished'
        )),

    CONSTRAINT backbone_room_max_players
        CHECK (max_players BETWEEN 2 AND 16)
);

-- =========================================
-- JOGADORES DENTRO DAS SALAS
-- =========================================

CREATE TABLE IF NOT EXISTS backbone_room_members (
    id BIGSERIAL PRIMARY KEY,

    room_id BIGINT NOT NULL
        REFERENCES backbone_rooms(id) ON DELETE CASCADE,

    player_id BIGINT NOT NULL
        REFERENCES players(id) ON DELETE CASCADE,

    is_ready BOOLEAN NOT NULL DEFAULT FALSE,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT backbone_unique_room_member
        UNIQUE (room_id, player_id)
);

-- =========================================
-- SESSÕES DE PARTIDA
-- =========================================

CREATE TABLE IF NOT EXISTS backbone_game_sessions (
    id BIGSERIAL PRIMARY KEY,

    room_id BIGINT NOT NULL
        REFERENCES backbone_rooms(id) ON DELETE CASCADE,

    map_name VARCHAR(100) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'active',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    finished_at TIMESTAMPTZ,

    CONSTRAINT backbone_session_status
        CHECK (status IN ('active', 'finished'))
);

-- =========================================
-- ÍNDICES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_backbone_rooms_code
    ON backbone_rooms(code);

CREATE INDEX IF NOT EXISTS idx_backbone_rooms_status
    ON backbone_rooms(status);

CREATE INDEX IF NOT EXISTS idx_backbone_members_player
    ON backbone_room_members(player_id);

CREATE INDEX IF NOT EXISTS idx_backbone_members_room
    ON backbone_room_members(room_id);

CREATE INDEX IF NOT EXISTS idx_backbone_sessions_room
    ON backbone_game_sessions(room_id);

-- Impede duas sessões ativas na mesma sala.
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_backbone_one_active_session_per_room
    ON backbone_game_sessions(room_id)
    WHERE status = 'active';
