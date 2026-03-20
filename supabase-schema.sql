-- Supabase에서 실행할 SQL 스키마
-- SQL Editor에서 이 내용을 붙여넣어 실행하세요

-- =============================================
-- 1. 신청 데이터
-- =============================================
CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  raid_type TEXT NOT NULL DEFAULT '루드라',
  characters JSONB NOT NULL DEFAULT '[]',
  week_start DATE NOT NULL,
  time_slots JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registrations_week_start ON registrations(week_start);
CREATE INDEX idx_registrations_raid_type ON registrations(raid_type);

ALTER PUBLICATION supabase_realtime ADD TABLE registrations;

ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON registrations
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 2. 확정된 공격대
-- =============================================
CREATE TABLE confirmed_raids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_type TEXT NOT NULL,
  week_start DATE NOT NULL,
  composition JSONB NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_confirmed_raids_week ON confirmed_raids(week_start, raid_type);

ALTER TABLE confirmed_raids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON confirmed_raids
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- 3. 캐릭터 프로필
-- =============================================
CREATE TABLE character_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  raid_type TEXT NOT NULL,
  characters JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_character_profiles_raid_type ON character_profiles(raid_type);

ALTER TABLE character_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON character_profiles
  FOR ALL USING (true) WITH CHECK (true);
