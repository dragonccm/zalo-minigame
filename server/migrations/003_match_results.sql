-- Kết quả trận cho game đối kháng 1-1 (cờ vua...): thắng / thua / hòa
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_end_reason_check;
ALTER TABLE matches ADD CONSTRAINT matches_end_reason_check CHECK (end_reason IN ('death', 'left', 'room_closed', 'win', 'loss', 'draw'));
