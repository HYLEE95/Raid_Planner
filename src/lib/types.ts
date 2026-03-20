export type ClassType = '근딜' | '원딜' | '호법성' | '치유성' | '세가' | '세바' | '딜러';

// 레이드 타입
export type RaidType = '루드라' | '브리레흐';

export interface RaidConfig {
  name: RaidType;
  label: string;
  resetDay: number;           // 주간 초기화 요일 (3=수, 4=목)
  teamsPerRaid: number;       // 팀 수 (루드라: 2, 브리레흐: 1)
  membersPerTeam: number;     // 팀당 인원
  minPartySize?: number;      // 최소 파티 인원 (브리레흐: 4)
  maxPartySize?: number;      // 최대 파티 인원 (브리레흐: 8)
  durationHours: number;      // 소요 시간
  maxBots: number;            // 최대 봇 수
  // 팀별 서포트 규칙 (루드라용)
  teamRules?: {
    team1: { supportType: ('치유성' | '호법성')[]; exactCount: number };
    team2: { supportType: ('치유성')[]; exactCount: number };
  };
}

export const RAID_CONFIGS: Record<RaidType, RaidConfig> = {
  '루드라': {
    name: '루드라',
    label: '루드라',
    resetDay: 3, // 수요일
    teamsPerRaid: 2,
    membersPerTeam: 4,
    durationHours: 1,
    maxBots: 4,
    teamRules: {
      team1: { supportType: ['치유성', '호법성'], exactCount: 1 },
      team2: { supportType: ['치유성'], exactCount: 1 },
    },
  },
  '브리레흐': {
    name: '브리레흐',
    label: '브리레흐 1-3관문',
    resetDay: 4, // 목요일
    teamsPerRaid: 1,
    membersPerTeam: 8,
    minPartySize: 4,
    maxPartySize: 8,
    durationHours: 1,
    maxBots: 2,
  },
};

export const RAID_TYPES: RaidType[] = ['루드라', '브리레흐'];

export interface Character {
  id: string;
  owner_id: string;
  nickname: string;
  class_type: ClassType;
  combat_power: number; // 단위 K
  can_clear_raid: boolean;  // 공팟 가도 상관 없음
  is_underpowered: boolean; // 공팟 스펙 미달(부캐)
}

export interface Owner {
  id: string;
  name: string;
  created_at: string;
}

export interface TimeSlot {
  date: string;       // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
}

export interface Availability {
  id: string;
  owner_id: string;
  week_start: string; // 해당 주 시작일 YYYY-MM-DD
  slots: TimeSlot[];
}

export interface RegistrationData {
  ownerName: string;
  characters: Omit<Character, 'id' | 'owner_id'>[];
  weekStart: string;
  timeSlots: TimeSlot[];
}

// 봇 캐릭터 (빈 슬롯 채우기)
export interface BotCharacter {
  isBot: true;
  nickname: string;
  class_type: ClassType;
  combat_power: number;
}

export type RaidMember = (Character & { isBot?: false; ownerName: string; is_underpowered?: boolean }) | BotCharacter;

export interface Team {
  members: RaidMember[];
  avgCombatPower: number;
}

export interface RaidGroup {
  id: number;
  team1: Team;
  team2?: Team;  // optional for 브리레흐 (단일 파티)
  avgCombatPower: number;
  botCount: number;
  timeSlot: TimeSlot;
}

export interface RaidComposition {
  raids: RaidGroup[];
  excludedCharacters: (Character & { ownerName: string; is_underpowered?: boolean })[];
  score: number;
}

// 확정된 공격대
export interface ConfirmedRaid {
  id: string;
  raid_type: RaidType;
  week_start: string;
  composition: RaidComposition;
  confirmed_at: string;
}

// 소유주별 캐릭터 프로필 (레이드별 저장)
export interface DBCharacterProfile {
  id: string;
  owner_name: string;
  raid_type: RaidType;
  characters: {
    nickname: string;
    class_type: ClassType;
    combat_power?: number;
    can_clear_raid?: boolean;
    is_underpowered?: boolean;
    // 브리레흐 전용
    has_destruction_robe?: boolean;
    has_soul_weapon?: boolean;
    desired_clears?: number;
  }[];
  created_at: string;
}

// DB에 저장되는 형태
export interface DBRegistration {
  id: string;
  owner_name: string;
  raid_type: RaidType;
  characters: {
    nickname: string;
    class_type: ClassType;
    combat_power?: number;
    can_clear_raid?: boolean;
    is_underpowered?: boolean;
    // 브리레흐 전용
    has_destruction_robe?: boolean;
    has_soul_weapon?: boolean;
    desired_clears?: number;
  }[];
  week_start: string;
  time_slots: TimeSlot[];
  created_at: string;
}
