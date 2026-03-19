-- Supabase에서 실행할 SQL 스키마
-- SQL Editor에서 이 내용을 붙여넣어 실행하세요

CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  characters JSONB NOT NULL DEFAULT '[]',
  week_start DATE NOT NULL,
  time_slots JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 주차별 조회를 위한 인덱스
CREATE INDEX idx_registrations_week_start ON registrations(week_start);

-- 실시간 구독을 위한 Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE registrations;

-- RLS (Row Level Security) - 모든 사용자가 읽기/쓰기 가능
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON registrations
  FOR ALL
  USING (true)
  WITH CHECK (true);
