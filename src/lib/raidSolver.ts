import type {
  DBRegistration,
  RaidComposition,
  RaidGroup,
  RaidMember,
  Team,
  BotCharacter,
  ClassType,
  TimeSlot,
  RaidType,
} from './types';
import { RAID_CONFIGS } from './types';

// 크로스 레이드 소유주 차단 슬롯 (owner_name -> TimeSlot[])
export type BlockedOwnerSlots = Map<string, TimeSlot[]>;

// ==========================================
// 공통 유틸
// ==========================================

const MIN_CP = 170; // 기준 전투력 (K)
const RAID_DURATION = 60; // 레이드 1시간 (분)
const MAX_BOTS_LAST = 6; // 마지막 공격대 봇 상한

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function slotsOverlapWithDuration(a: TimeSlot, b: TimeSlot, durationMin = RAID_DURATION): boolean {
  if (a.date !== b.date) return false;
  const aStart = timeToMinutes(a.start_time);
  const aEnd = Math.max(timeToMinutes(a.end_time), aStart + durationMin);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = Math.max(timeToMinutes(b.end_time), bStart + durationMin);
  return aStart < bEnd && bStart < aEnd;
}

function isOwnerBlockedAtSlot(ownerName: string, slot: TimeSlot, blocked: BlockedOwnerSlots | undefined): boolean {
  if (!blocked) return false;
  const ownerSlots = blocked.get(ownerName);
  if (!ownerSlots) return false;
  return ownerSlots.some(bs => slotsOverlapWithDuration(bs, slot));
}

// ==========================================
// 캐릭터/슬롯 데이터 구조
// ==========================================

interface CharacterWithOwner {
  id: string;
  owner_id: string;
  ownerName: string;
  nickname: string;
  class_type: ClassType;
  combat_power: number;
  can_clear_raid: boolean;
  is_underpowered: boolean;
  isBot?: false;
}

interface SlotGroup {
  slot: TimeSlot;
  characters: CharacterWithOwner[];
}

// 시간대별 가용 캐릭터 그룹핑 (1시간 단위 분할)
function buildSlotGroups(registrations: DBRegistration[], blockedOwnerSlots?: BlockedOwnerSlots): SlotGroup[] {
  const byDate = new Map<string, { reg: DBRegistration; slot: TimeSlot }[]>();
  for (const reg of registrations) {
    for (const slot of reg.time_slots) {
      if (!byDate.has(slot.date)) byDate.set(slot.date, []);
      byDate.get(slot.date)!.push({ reg, slot });
    }
  }

  const result: SlotGroup[] = [];

  for (const [, entries] of byDate) {
    const rawSlots = new Map<string, TimeSlot>();
    for (const e of entries) {
      const key = `${e.slot.start_time}_${e.slot.end_time}`;
      rawSlots.set(key, e.slot);
    }

    // 1시간 초과 슬롯을 1시간 단위로 분할
    const uniqueSlots = new Map<string, TimeSlot>();
    for (const [, slot] of rawSlots) {
      const startMin = timeToMinutes(slot.start_time);
      const endMin = timeToMinutes(slot.end_time);
      if (endMin - startMin > 60) {
        for (let t = startMin; t + 60 <= endMin; t += 60) {
          const subStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          const subEnd = `${String(Math.floor((t + 60) / 60)).padStart(2, '0')}:${String((t + 60) % 60).padStart(2, '0')}`;
          const key = `${subStart}_${subEnd}`;
          if (!uniqueSlots.has(key)) {
            uniqueSlots.set(key, { date: slot.date, start_time: subStart, end_time: subEnd });
          }
        }
      } else {
        const key = `${slot.start_time}_${slot.end_time}`;
        uniqueSlots.set(key, slot);
      }
    }

    for (const [, slot] of uniqueSlots) {
      const chars: CharacterWithOwner[] = [];
      const charIdSet = new Set<string>();

      for (const e of entries) {
        if (e.slot.start_time <= slot.start_time && e.slot.end_time >= slot.end_time) {
          if (isOwnerBlockedAtSlot(e.reg.owner_name, slot, blockedOwnerSlots)) continue;

          for (const char of e.reg.characters) {
            const charId = `${e.reg.id}_${char.nickname}`;
            if (!charIdSet.has(charId)) {
              charIdSet.add(charId);
              chars.push({
                id: charId,
                owner_id: e.reg.id,
                ownerName: e.reg.owner_name,
                nickname: char.nickname,
                class_type: char.class_type,
                combat_power: char.combat_power ?? 0,
                can_clear_raid: char.can_clear_raid ?? false,
                is_underpowered: char.is_underpowered ?? false,
              });
            }
          }
        }
      }

      if (chars.length > 0) {
        result.push({ slot, characters: chars });
      }
    }
  }

  result.sort((a, b) => {
    const d = a.slot.date.localeCompare(b.slot.date);
    return d !== 0 ? d : a.slot.start_time.localeCompare(b.slot.start_time);
  });

  return result;
}

// ==========================================
// 팀 평균 전투력 계산 (새 규칙)
// ==========================================

// 4인 모두 기준 전투력 이상 → 전체 평균
// 서포터 1인 기준 이하 + 딜러 3명 → 딜러 3명 평균
// 서포터 2인+ → 가장 낮은 서포터 1인 제외, 나머지 3인 평균
// 단, 서포터 전투력 200k 이상이면 딜러로 간주
export function calcTeamAvg(members: RaidMember[]): number {
  const effectiveMembers = members.map(m => ({
    ...m,
    isDealerForCalc: (m.class_type === '근딜' || m.class_type === '원딜') ||
      ((m.class_type === '치유' || m.class_type === '호법') && m.combat_power >= 200),
  }));

  const allAboveMin = effectiveMembers.every(m => m.combat_power >= MIN_CP);
  if (allAboveMin) {
    return effectiveMembers.reduce((s, m) => s + m.combat_power, 0) / effectiveMembers.length;
  }

  const supports = effectiveMembers.filter(m => !m.isDealerForCalc && (m.class_type === '치유' || m.class_type === '호법'));
  const dealers = effectiveMembers.filter(m => m.isDealerForCalc);

  if (supports.length <= 1) {
    if (dealers.length === 0) return 0;
    return dealers.reduce((s, m) => s + m.combat_power, 0) / dealers.length;
  } else {
    const sorted = [...supports].sort((a, b) => a.combat_power - b.combat_power);
    const effective = [...dealers, ...sorted.slice(1)];
    if (effective.length === 0) return 0;
    return effective.reduce((s, m) => s + m.combat_power, 0) / Math.max(3, effective.length);
  }
}

export function hasUnderpoweredDealerSupport(members: RaidMember[]): boolean {
  const supports = members.filter(m => m.class_type === '치유' || m.class_type === '호법');
  if (supports.length < 2) return false;
  const sorted = [...supports].sort((a, b) => a.combat_power - b.combat_power);
  return sorted.slice(1).some(s => s.combat_power < MIN_CP);
}

// ==========================================
// 봇 생성 (DPS만)
// ==========================================

function createBot(classType: ClassType, combatPower: number, idx: number): BotCharacter {
  return { isBot: true, nickname: `공방인원${idx}`, class_type: classType, combat_power: combatPower };
}

function getBotCombatPower(members: CharacterWithOwner[]): number {
  const dps = members.filter(m => m.class_type !== '호법' && m.class_type !== '치유');
  if (dps.length === 0) return members.length > 0 ? Math.min(...members.map(m => m.combat_power)) : 0;
  return Math.min(...dps.map(m => m.combat_power));
}

function sortRaidsBotsLast(raids: RaidGroup[]): RaidGroup[] {
  return [...raids].sort((a, b) => a.botCount - b.botCount).map((r, i) => ({ ...r, id: i + 1 }));
}

// ==========================================
// 소유주 겹침 체크
// ==========================================

function getOwnersInOverlappingRaids(raids: RaidGroup[], slot: TimeSlot): Set<string> {
  const owners = new Set<string>();
  for (const raid of raids) {
    if (slotsOverlapWithDuration(raid.timeSlot, slot)) {
      for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
        if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
          owners.add((m as any).owner_id);
        }
      }
    }
  }
  return owners;
}

function getAllUniqueChars(slotGroups: SlotGroup[]): CharacterWithOwner[] {
  const seen = new Set<string>();
  const result: CharacterWithOwner[] = [];
  for (const sg of slotGroups) {
    for (const c of sg.characters) {
      if (!seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }
  }
  return result;
}

function getExcluded(allChars: CharacterWithOwner[], usedIds: Set<string>) {
  return allChars
    .filter(c => !usedIds.has(c.id))
    .map(c => ({
      id: c.id, owner_id: c.owner_id, nickname: c.nickname,
      class_type: c.class_type, combat_power: c.combat_power,
      can_clear_raid: c.can_clear_raid, is_underpowered: c.is_underpowered,
      ownerName: c.ownerName,
    }));
}

// ==========================================
// 단일 공격대 편성 (tryFormRaid)
// ==========================================

function tryFormRaid(
  available: CharacterWithOwner[],
  usedCharIds: Set<string>,
  timeSlot: TimeSlot,
  raidId: number,
  maxBotsPerRaid: number,
  usedOwnersInTimeSlot: Set<string>
): { raid: RaidGroup; usedChars: CharacterWithOwner[] } | null {
  const eligible = available.filter(
    c => !usedCharIds.has(c.id) && !usedOwnersInTimeSlot.has(c.owner_id)
      && !(maxBotsPerRaid > 0 && c.is_underpowered) // 봇 공격대에는 스펙미달 배치 불가
  );

  if (eligible.length === 0) return null;

  const isSupport = (ct: string) => ct === '치유' || ct === '호법';

  // DPS 보유 소유주 사전 계산 (서포트 배치 우선순위용)
  const ownerHasDpsSet = new Set<string>();
  for (const c of eligible) {
    if (c.class_type === '근딜' || c.class_type === '원딜') ownerHasDpsSet.add(c.owner_id);
  }

  const healers = eligible.filter(c => c.class_type === '치유')
    .sort((a, b) => (ownerHasDpsSet.has(a.owner_id) ? 1 : 0) - (ownerHasDpsSet.has(b.owner_id) ? 1 : 0));
  const tanks = eligible.filter(c => c.class_type === '호법')
    .sort((a, b) => (ownerHasDpsSet.has(a.owner_id) ? 1 : 0) - (ownerHasDpsSet.has(b.owner_id) ? 1 : 0));

  const team1Members: RaidMember[] = [];
  const team2Members: RaidMember[] = [];
  const usedChars: CharacterWithOwner[] = [];
  const usedCharIdSet = new Set<string>();
  const usedOwnerIds = new Set<string>();
  let botCount = 0;

  const addToTeam = (team: RaidMember[], char: CharacterWithOwner) => {
    team.push({ ...char, isBot: false, ownerName: char.ownerName });
    usedChars.push(char);
    usedCharIdSet.add(char.id);
    usedOwnerIds.add(char.owner_id);
  };
  const isOwnerInRaid = (oid: string) => usedOwnerIds.has(oid);

  // 2팀: 치유 필수 1명 (봇 사용 안 함)
  const availHealer = healers.find(h => !isOwnerInRaid(h.owner_id));
  if (!availHealer) return null;
  addToTeam(team2Members, availHealer);

  // 1팀: 서포터(치유/호법) 1명 필수 (봇 사용 안 함)
  const remainSupports = [...tanks, ...healers.filter(c => !usedCharIdSet.has(c.id))]
    .filter(c => !isOwnerInRaid(c.owner_id))
    .sort((a, b) => b.combat_power - a.combat_power);
  if (remainSupports.length === 0) return null;
  addToTeam(team1Members, remainSupports[0]);

  // 나머지: DPS + 강한 서포터를 전투력순으로 통합 배치
  const remainingAll = eligible
    .filter(c => !usedCharIdSet.has(c.id) && !isOwnerInRaid(c.owner_id))
    .sort((a, b) => b.combat_power - a.combat_power);

  const canPlaceSupportInTeam = (team: RaidMember[], char: CharacterWithOwner): boolean => {
    if (char.class_type === '호법') return !team.some(m => m.class_type === '호법');
    if (char.class_type === '치유') return !team.some(m => m.class_type === '치유');
    return true;
  };

  const countSupport = (team: RaidMember[]) => team.filter(m => isSupport(m.class_type)).length;
  const teamDpsSum = (team: RaidMember[]) =>
    team.filter(m => !isSupport(m.class_type)).reduce((s, m) => s + m.combat_power, 0);

  for (const char of remainingAll) {
    if (team1Members.length >= 4 && team2Members.length >= 4) break;
    if (isOwnerInRaid(char.owner_id)) continue;

    const can1 = team1Members.length < 4;
    const can2 = team2Members.length < 4;

    if (isSupport(char.class_type)) {
      const canP1 = can1 && canPlaceSupportInTeam(team1Members, char);
      const canP2 = can2 && canPlaceSupportInTeam(team2Members, char);
      if (!canP1 && !canP2) continue;
      if (canP1 && canP2) {
        if (countSupport(team1Members) <= countSupport(team2Members)) addToTeam(team1Members, char);
        else addToTeam(team2Members, char);
      } else if (canP1) addToTeam(team1Members, char);
      else addToTeam(team2Members, char);
    } else {
      // DPS: 근딜/원딜 혼합 선호 + 전투력 균등
      if (can1 && can2) {
        const t1HasType = team1Members.some(m => m.class_type === char.class_type);
        const t2HasType = team2Members.some(m => m.class_type === char.class_type);
        // 같은 타입이 없는 팀 우선 (근딜/원딜 혼합)
        if (!t1HasType && t2HasType) addToTeam(team1Members, char);
        else if (!t2HasType && t1HasType) addToTeam(team2Members, char);
        else if (teamDpsSum(team2Members) <= teamDpsSum(team1Members)) addToTeam(team2Members, char);
        else addToTeam(team1Members, char);
      } else if (can1) addToTeam(team1Members, char);
      else if (can2) addToTeam(team2Members, char);
    }
  }

  // DPS 봇 채우기 (마지막 공격대에서만)
  const botPower = getBotCombatPower(usedChars);
  while (team1Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team1Members.some(m => m.class_type === '근딜');
    const botClass: ClassType = needMelee ? '근딜' : '원딜';
    team1Members.push(createBot(botClass, botPower, ++botCount));
  }
  while (team2Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team2Members.some(m => m.class_type === '근딜');
    const botClass: ClassType = needMelee ? '근딜' : '원딜';
    team2Members.push(createBot(botClass, botPower, ++botCount));
  }

  if (team1Members.length < 4 || team2Members.length < 4) return null;

  // 검증
  if (countSupport(team1Members) < 1) return null;
  if (countSupport(team2Members) < 1) return null;
  if (!team2Members.some(m => m.class_type === '치유')) return null;
  if (team1Members.filter(m => m.class_type === '호법').length >= 2) return null;
  if (team2Members.filter(m => m.class_type === '호법').length >= 2) return null;
  if (team1Members.filter(m => m.class_type === '치유').length >= 2) return null;
  if (team2Members.filter(m => m.class_type === '치유').length >= 2) return null;

  // 2팀 전투력이 1팀보다 높도록 DPS 스왑
  const t1Avg = calcTeamAvg(team1Members);
  const t2Avg = calcTeamAvg(team2Members);
  if (t1Avg > t2Avg) {
    const t1Dps = team1Members.filter(m => !isSupport(m.class_type) && !('isBot' in m && m.isBot));
    const t2Dps = team2Members.filter(m => !isSupport(m.class_type) && !('isBot' in m && m.isBot));
    let bestSwap: [number, number] | null = null;
    let bestDiff = Infinity;
    for (let i = 0; i < t1Dps.length; i++) {
      for (let j = 0; j < t2Dps.length; j++) {
        const newT1Sum = teamDpsSum(team1Members) - t1Dps[i].combat_power + t2Dps[j].combat_power;
        const newT2Sum = teamDpsSum(team2Members) - t2Dps[j].combat_power + t1Dps[i].combat_power;
        if (newT2Sum > newT1Sum) {
          const diff = newT2Sum - newT1Sum;
          if (diff < bestDiff) { bestDiff = diff; bestSwap = [i, j]; }
        }
      }
    }
    if (bestSwap) {
      const t1Idx = team1Members.indexOf(t1Dps[bestSwap[0]]);
      const t2Idx = team2Members.indexOf(t2Dps[bestSwap[1]]);
      if (t1Idx !== -1 && t2Idx !== -1) {
        [team1Members[t1Idx], team2Members[t2Idx]] = [team2Members[t2Idx], team1Members[t1Idx]];
      }
    }
  }

  // 봇+스펙미달 공존 체크
  if (botCount > 0) {
    const allM = [...team1Members, ...team2Members];
    if (allM.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered)) return null;
    if (calcTeamAvg(team1Members) < MIN_CP || calcTeamAvg(team2Members) < MIN_CP) return null;
  }

  const team1: Team = { members: team1Members, avgCombatPower: calcTeamAvg(team1Members) };
  const team2: Team = { members: team2Members, avgCombatPower: calcTeamAvg(team2Members) };

  return {
    raid: {
      id: raidId, team1, team2,
      avgCombatPower: (team1.avgCombatPower + team2.avgCombatPower) / 2,
      botCount, timeSlot,
    },
    usedChars,
  };
}

// ==========================================
// 스코어링
// ==========================================

function scoreComposition(comp: RaidComposition): number {
  let score = 0;
  const totalBots = comp.raids.reduce((s, r) => s + r.botCount, 0);

  // 제외 인원 패널티
  score += comp.excludedCharacters.length * 30000;

  // 전체 봇 패널티
  score += totalBots * 500;

  // 마지막 공격대 외에 봇 → 매우 큰 패널티
  const raidsByBots = [...comp.raids].sort((a, b) => a.botCount - b.botCount);
  for (let i = 0; i < raidsByBots.length - 1; i++) {
    if (raidsByBots[i].botCount > 0) score += raidsByBots[i].botCount * 50000;
  }

  // 상위 DPS 4인 제외 시 패널티
  const allDealerPowers: number[] = [];
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && (m.class_type === '근딜' || m.class_type === '원딜')) {
        allDealerPowers.push(m.combat_power);
      }
    }
  }
  for (const ex of comp.excludedCharacters) {
    if (ex.class_type === '근딜' || ex.class_type === '원딜') allDealerPowers.push(ex.combat_power);
  }
  allDealerPowers.sort((a, b) => b - a);
  const topDpsThreshold = allDealerPowers[3] ?? allDealerPowers[allDealerPowers.length - 1] ?? 0;

  for (const ex of comp.excludedCharacters) {
    const isDps = ex.class_type === '근딜' || ex.class_type === '원딜';
    if (isDps && ex.combat_power >= topDpsThreshold) score += 100000; // 2순위: 상위 DPS 배치
    else if (ex.is_underpowered) score += 120000; // 1순위: 스펙미달 배치
    else score += 1000;
  }

  // 미참여 소유주 패널티
  const participating = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) participating.add((m as any).owner_id);
    }
  }
  for (const ex of comp.excludedCharacters) {
    if ('owner_id' in ex && !participating.has((ex as any).owner_id)) score += 50000;
  }

  // 팀 전투력 균등 (분산 최소화)
  const validRaids = comp.raids.filter(r => r.botCount < 4);
  const allTeamAvgs: number[] = [];
  for (const raid of validRaids) {
    allTeamAvgs.push(raid.team1.avgCombatPower);
    if (raid.team2) {
      allTeamAvgs.push(raid.team2.avgCombatPower);
      score += Math.abs(raid.team1.avgCombatPower - raid.team2.avgCombatPower) * 200;
    }
  }
  if (allTeamAvgs.length > 1) {
    const mean = allTeamAvgs.reduce((a, b) => a + b, 0) / allTeamAvgs.length;
    const variance = allTeamAvgs.reduce((s, v) => s + (v - mean) ** 2, 0) / allTeamAvgs.length;
    score += Math.sqrt(variance) * 300;
    score += (Math.max(...allTeamAvgs) - Math.min(...allTeamAvgs)) * 500;
  }

  // 동일 서포트 타입 2명 동일 팀 패널티
  for (const raid of comp.raids) {
    for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
      if (team.members.filter(m => m.class_type === '호법').length >= 2) score += 100000;
      if (team.members.filter(m => m.class_type === '치유').length >= 2) score += 100000;
    }
  }

  // 근딜/원딜 혼합 선호 (한 종류만 있으면 패널티)
  for (const raid of comp.raids) {
    for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
      const realMembers = team.members.filter(m => !('isBot' in m && m.isBot));
      const hasMelee = realMembers.some(m => m.class_type === '근딜');
      const hasRanged = realMembers.some(m => m.class_type === '원딜');
      if (realMembers.length >= 3 && (!hasMelee || !hasRanged)) score += 5000;
    }
  }

  // 스펙미달+봇 같은 공격대 패널티
  for (const raid of comp.raids) {
    if (raid.botCount === 0) continue;
    const allM = [...raid.team1.members, ...(raid.team2?.members || [])];
    if (allM.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered)) score += 30000;
  }

  // 2파티가 1파티보다 전투력 높아야 함
  for (const raid of comp.raids) {
    if (!raid.team2) continue;
    if (raid.team1.avgCombatPower > raid.team2.avgCombatPower) {
      score += (raid.team1.avgCombatPower - raid.team2.avgCombatPower) * 100;
    }
  }

  return score;
}

// ==========================================
// 슬롯 정렬 유틸
// ==========================================

function sortSlotsByTopDps(slots: SlotGroup[], usedCharIds: Set<string>): SlotGroup[] {
  return [...slots].sort((a, b) => {
    const getTopAvg = (sg: SlotGroup) => {
      const dps = sg.characters
        .filter(c => !usedCharIds.has(c.id) && (c.class_type === '근딜' || c.class_type === '원딜'))
        .map(c => c.combat_power)
        .sort((x, y) => y - x);
      if (dps.length === 0) return 0;
      return dps.slice(0, 6).reduce((s, v) => s + v, 0) / Math.min(6, dps.length);
    };
    return getTopAvg(b) - getTopAvg(a);
  });
}

function compositionKey(comp: RaidComposition): string {
  const raidKeys = comp.raids.map(r => {
    const t1 = r.team1.members.map(m => m.nickname).sort().join(',');
    const t2 = r.team2 ? r.team2.members.map(m => m.nickname).sort().join(',') : '';
    const slotKey = `${r.timeSlot.date}_${r.timeSlot.start_time}`;
    return [slotKey, [t1, t2].sort().join('|')].join('::');
  });
  raidKeys.sort();
  return raidKeys.join('||');
}

// ==========================================
// Greedy 스케줄링
// ==========================================

function greedySchedule(
  orderedSlots: SlotGroup[],
  slotGroups: SlotGroup[],
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let raidId = 1;

  // 1단계: 봇 없이 공대 구성
  for (const sg of orderedSlots) {
    while (true) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 제외 인원이 있는 시간대에서 봇 포함 공대 추가 편성
  // 아직 참여하지 못한 소유주가 가용한 슬롯을 우선 시도
  const participatingOwners = new Set<string>();
  for (const raid of raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) participatingOwners.add((m as any).owner_id);
    }
  }

  // 미참여 소유주가 있는 슬롯 우선 정렬
  const slotsForRescue = [...slotGroups].sort((a, b) => {
    const aUnincluded = a.characters.filter(c => !usedCharIds.has(c.id) && !participatingOwners.has(c.owner_id)).length;
    const bUnincluded = b.characters.filter(c => !usedCharIds.has(c.id) && !participatingOwners.has(c.owner_id)).length;
    return bUnincluded - aUnincluded; // 미참여 소유주 많은 슬롯 우선
  });

  for (const sg of slotsForRescue) {
    const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
    const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
    if (slotAvail.length < 2) continue;
    const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, MAX_BOTS_LAST, usedOwnersInSlot);
    if (!result) continue;
    raids.push(result.raid);
    for (const c of result.usedChars) usedCharIds.add(c.id);
    raidId++;
    break; // 봇 공대 1개만
  }

  if (raids.length === 0) return null;
  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp);
  return comp;
}

// ==========================================
// 셔플
// ==========================================

function shuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ==========================================
// 조합 생성
// ==========================================

function generateCompositions(slotGroups: SlotGroup[]): RaidComposition[] {
  const allResults: RaidComposition[] = [];
  const emptyUsed = new Set<string>();

  // 기본 전략: DPS 높은 슬롯 우선
  const dpsOrdered = greedySchedule(sortSlotsByTopDps(slotGroups, emptyUsed), slotGroups);
  if (dpsOrdered) allResults.push(dpsOrdered);

  // 셔플 기반 3000회
  for (let seed = 1; seed <= 3000; seed++) {
    const shuffledSlots: SlotGroup[] = slotGroups.map(sg => ({
      slot: sg.slot,
      characters: shuffle(sg.characters, seed + sg.slot.date.charCodeAt(0)),
    }));

    const emptyUsed2 = new Set<string>();
    const orderedSlots = seed % 4 === 0
      ? [...shuffledSlots].reverse()
      : seed % 4 === 1
        ? shuffle(shuffledSlots, seed)
        : seed % 4 === 2
          ? sortSlotsByTopDps(shuffledSlots, emptyUsed2)
          : shuffledSlots;

    const comp = greedySchedule(orderedSlots, slotGroups);
    if (comp) allResults.push(comp);
  }

  // Rescue: 제외 인원 구제
  const rescued: RaidComposition[] = [];
  for (const comp of allResults) {
    if (comp.excludedCharacters.length === 0) continue;
    const usedIds = new Set<string>();
    for (const raid of comp.raids) {
      for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
        if (!('isBot' in m && m.isBot) && 'id' in m) usedIds.add((m as any).id);
      }
    }
    // 봇 포함 추가 공대 시도
    let raidId = comp.raids.length + 1;
    const newRaids = [...comp.raids];
    const newUsedIds = new Set(usedIds);
    for (const sg of slotGroups) {
      const usedOwners = getOwnersInOverlappingRaids(newRaids, sg.slot);
      const avail = sg.characters.filter(c => !newUsedIds.has(c.id) && !usedOwners.has(c.owner_id));
      if (avail.length < 2) continue;
      const result = tryFormRaid(sg.characters, newUsedIds, sg.slot, raidId, MAX_BOTS_LAST, usedOwners);
      if (!result) continue;
      newRaids.push(result.raid);
      for (const c of result.usedChars) newUsedIds.add(c.id);
      raidId++;
      break;
    }
    if (newRaids.length > comp.raids.length) {
      const allChars = getAllUniqueChars(slotGroups);
      const rescuedComp: RaidComposition = {
        raids: sortRaidsBotsLast(newRaids),
        excludedCharacters: getExcluded(allChars, newUsedIds),
        score: 0,
      };
      rescuedComp.score = scoreComposition(rescuedComp);
      if (rescuedComp.excludedCharacters.length < comp.excludedCharacters.length) {
        rescued.push(rescuedComp);
      }
    }
  }
  allResults.push(...rescued);

  return allResults;
}

// ==========================================
// 미참여 소유주 구제 (스왑 삽입)
// ==========================================

function tryIncludeExcludedOwners(comp: RaidComposition, slotGroups: SlotGroup[]): RaidComposition {
  const participating = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) participating.add((m as any).owner_id);
    }
  }

  const excludedByOwner = new Map<string, typeof comp.excludedCharacters>();
  for (const ex of comp.excludedCharacters) {
    if ('owner_id' in ex && !participating.has((ex as any).owner_id)) {
      const oid = (ex as any).owner_id;
      if (!excludedByOwner.has(oid)) excludedByOwner.set(oid, []);
      excludedByOwner.get(oid)!.push(ex);
    }
  }

  if (excludedByOwner.size === 0) return comp;

  const ownerSlots = new Map<string, TimeSlot[]>();
  for (const sg of slotGroups) {
    for (const c of sg.characters) {
      const exChars = excludedByOwner.get(c.owner_id);
      if (exChars && exChars.some(ex => ex.id === c.id)) {
        if (!ownerSlots.has(c.owner_id)) ownerSlots.set(c.owner_id, []);
        ownerSlots.get(c.owner_id)!.push(sg.slot);
      }
    }
  }

  const newComp: RaidComposition = structuredClone(comp);

  for (const [excludedOwnerId, exChars] of excludedByOwner) {
    const availSlots = ownerSlots.get(excludedOwnerId) || [];
    const bestChar = exChars.filter(c => !c.is_underpowered).sort((a, b) => b.combat_power - a.combat_power)[0];
    if (!bestChar) continue;

    for (const raid of newComp.raids) {
      const canJoin = availSlots.some(s =>
        s.date === raid.timeSlot.date &&
        s.start_time <= raid.timeSlot.start_time &&
        s.end_time >= raid.timeSlot.end_time
      );
      if (!canJoin) continue;

      const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
      if (allMembers.some(m => 'owner_id' in m && (m as any).owner_id === excludedOwnerId)) continue;

      // 시간대 겹침 소유주 충돌 검증
      const ownersInOverlapping = getOwnersInOverlappingRaids(
        newComp.raids.filter(r => r.id !== raid.id), raid.timeSlot
      );
      if (ownersInOverlapping.has(excludedOwnerId)) continue;

      for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
        let swapped = false;
        for (let i = 0; i < team.members.length; i++) {
          const member = team.members[i];
          if ('isBot' in member && member.isBot) continue;
          if (!('owner_id' in member)) continue;
          const memberOwnerId = (member as any).owner_id;

          const ownerInOtherRaids = newComp.raids.some(r => {
            if (r.id === raid.id) return false;
            return [...r.team1.members, ...(r.team2?.members || [])].some(
              m => 'owner_id' in m && (m as any).owner_id === memberOwnerId && !('isBot' in m && m.isBot)
            );
          });
          if (!ownerInOtherRaids) continue;

          const isSupport = (ct: string) => ct === '치유' || ct === '호법';
          if (isSupport(member.class_type) !== isSupport(bestChar.class_type)) continue;
          if (member.class_type !== bestChar.class_type) {
            const others = team.members.filter((m, idx) => idx !== i && m.class_type === member.class_type).length;
            if (others === 0) continue;
          }

          const newMember: RaidMember = { ...bestChar, isBot: false, ownerName: bestChar.ownerName } as any;
          const replaced = team.members[i];
          team.members[i] = newMember;

          const newExcluded = newComp.excludedCharacters.filter(c => c.id !== bestChar.id);
          newExcluded.push({
            id: (replaced as any).id, owner_id: (replaced as any).owner_id,
            nickname: replaced.nickname, class_type: replaced.class_type,
            combat_power: replaced.combat_power,
            can_clear_raid: (replaced as any).can_clear_raid ?? false,
            is_underpowered: (replaced as any).is_underpowered ?? false,
            ownerName: (replaced as any).ownerName || '',
          });
          newComp.excludedCharacters = newExcluded;
          team.avgCombatPower = calcTeamAvg(team.members);
          raid.avgCombatPower = raid.team2
            ? (raid.team1.avgCombatPower + raid.team2.avgCombatPower) / 2
            : raid.team1.avgCombatPower;
          swapped = true;
          break;
        }
        if (swapped) break;
      }
    }
  }

  newComp.score = scoreComposition(newComp);
  return newComp;
}

// ==========================================
// Hill Climbing 전투력 균등화
// ==========================================

function optimizeBalance(comp: RaidComposition, slotGroups: SlotGroup[]): RaidComposition {
  const result: RaidComposition = structuredClone(comp);
  const noBotRaids = result.raids.filter(r => r.botCount === 0 && r.team2);
  if (noBotRaids.length < 1) return result;

  const isSupport = (ct: string) => ct === '치유' || ct === '호법';

  const canParticipateInSlot = (member: RaidMember, targetSlot: TimeSlot): boolean => {
    if ('isBot' in member && member.isBot) return true;
    const charId = 'id' in member ? (member as any).id : null;
    if (!charId) return true;
    return slotGroups.some(sg =>
      slotsOverlapWithDuration(sg.slot, targetSlot) && sg.characters.some(c => c.id === charId)
    );
  };

  const calcObjective = (): number => {
    const avgs: number[] = [];
    for (const r of noBotRaids) {
      avgs.push(r.team1.avgCombatPower);
      if (r.team2) avgs.push(r.team2.avgCombatPower);
    }
    if (avgs.length < 2) return 0;
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    const variance = avgs.reduce((s, v) => s + (v - mean) ** 2, 0) / avgs.length;
    return variance * 10 - mean;
  };

  const isValidSwap = (teamMembers: RaidMember[], incoming: RaidMember, outgoing: RaidMember): boolean => {
    if (incoming.class_type === outgoing.class_type) return true;
    if (isSupport(incoming.class_type) !== isSupport(outgoing.class_type)) return false;
    const remaining = teamMembers.filter(m => m !== outgoing);
    remaining.push(incoming);
    if (!remaining.some(m => m.class_type === '근딜')) return false;
    if (!remaining.some(m => m.class_type === '원딜')) return false;
    if (isSupport(incoming.class_type)) {
      if (remaining.filter(m => m.class_type === '치유').length > 1) return false;
      if (remaining.filter(m => m.class_type === '호법').length > 1) return false;
    }
    return true;
  };

  const hasOwnerConflict = (raid: RaidGroup, member: RaidMember, excludeMember: RaidMember): boolean => {
    if ('isBot' in member && member.isBot) return false;
    const memberOwner = 'owner_id' in member ? (member as any).owner_id : null;
    if (!memberOwner) return false;
    const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
    return allMembers.some(m =>
      m !== excludeMember && !('isBot' in m && m.isBot) &&
      'owner_id' in m && (m as any).owner_id === memberOwner
    );
  };

  const recalc = (raid: RaidGroup) => {
    raid.team1.avgCombatPower = calcTeamAvg(raid.team1.members);
    if (raid.team2) raid.team2.avgCombatPower = calcTeamAvg(raid.team2.members);
    raid.avgCombatPower = raid.team2
      ? (raid.team1.avgCombatPower + raid.team2.avgCombatPower) / 2
      : raid.team1.avgCombatPower;
  };

  let currentObj = calcObjective();
  let noImproveStreak = 0;

  for (let iter = 0; iter < 500; iter++) {
    let improved = false;

    // 공격대 내 팀 간 + 공격대 간 스왑
    const allTargetRaids = [...noBotRaids];
    for (let ri = 0; ri < allTargetRaids.length; ri++) {
      // 내부 스왑
      const rA = allTargetRaids[ri];
      if (rA.team2) {
        for (let i = 0; i < rA.team1.members.length; i++) {
          for (let j = 0; j < rA.team2.members.length; j++) {
            const mA = rA.team1.members[i], mB = rA.team2.members[j];
            if (('isBot' in mA && mA.isBot) || ('isBot' in mB && mB.isBot)) continue;
            if (!isValidSwap(rA.team1.members, mB, mA)) continue;
            if (!isValidSwap(rA.team2.members, mA, mB)) continue;
            rA.team1.members[i] = mB; rA.team2.members[j] = mA;
            recalc(rA);
            const newObj = calcObjective();
            if (newObj < currentObj - 0.01) { currentObj = newObj; improved = true; }
            else { rA.team1.members[i] = mA; rA.team2.members[j] = mB; recalc(rA); }
          }
        }
      }

      // 크로스 스왑
      for (let rj = ri + 1; rj < allTargetRaids.length; rj++) {
        const rB = allTargetRaids[rj];
        const differentSlot = rA.timeSlot.date !== rB.timeSlot.date ||
          rA.timeSlot.start_time !== rB.timeSlot.start_time;
        const teamPairs: [RaidMember[], RaidMember[]][] = [[rA.team1.members, rB.team1.members]];
        if (rA.team2 && rB.team2) teamPairs.push([rA.team2.members, rB.team2.members]);
        if (rB.team2) teamPairs.push([rA.team1.members, rB.team2.members]);
        if (rA.team2) teamPairs.push([rA.team2.members, rB.team1.members]);

        for (const [membersA, membersB] of teamPairs) {
          for (let i = 0; i < membersA.length; i++) {
            for (let j = 0; j < membersB.length; j++) {
              const mA = membersA[i], mB = membersB[j];
              if (('isBot' in mA && mA.isBot) || ('isBot' in mB && mB.isBot)) continue;
              if (!isValidSwap(membersA, mB, mA)) continue;
              if (!isValidSwap(membersB, mA, mB)) continue;
              if (hasOwnerConflict(rA, mB, mA)) continue;
              if (hasOwnerConflict(rB, mA, mB)) continue;
              if (differentSlot) {
                if (!canParticipateInSlot(mA, rB.timeSlot)) continue;
                if (!canParticipateInSlot(mB, rA.timeSlot)) continue;
              }
              membersA[i] = mB; membersB[j] = mA;
              recalc(rA); recalc(rB);
              const newObj = calcObjective();
              if (newObj < currentObj - 0.01) { currentObj = newObj; improved = true; }
              else { membersA[i] = mA; membersB[j] = mB; recalc(rA); recalc(rB); }
            }
          }
        }
      }
    }

    if (!improved) { noImproveStreak++; if (noImproveStreak >= 5) break; }
    else noImproveStreak = 0;
  }

  result.score = scoreComposition(result);
  return result;
}

// ==========================================
// 무결성 검증
// ==========================================

function validateComposition(comp: RaidComposition): boolean {
  for (const raid of comp.raids) {
    const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];

    // 같은 공격대 내 소유주 중복
    const ownerIds = new Set<string>();
    for (const m of allMembers) {
      if ('isBot' in m && m.isBot) continue;
      if ('owner_id' in m) {
        const oid = (m as any).owner_id;
        if (ownerIds.has(oid)) return false;
        ownerIds.add(oid);
      }
    }

    // 시간대 겹치는 공격대 간 소유주 중복
    for (const otherRaid of comp.raids) {
      if (otherRaid.id === raid.id) continue;
      if (!slotsOverlapWithDuration(raid.timeSlot, otherRaid.timeSlot)) continue;
      const otherMembers = [...otherRaid.team1.members, ...(otherRaid.team2?.members || [])];
      for (const m of allMembers) {
        if ('isBot' in m && m.isBot) continue;
        if (!('owner_id' in m)) continue;
        if (otherMembers.some(om => !('isBot' in om && om.isBot) && 'owner_id' in om && (om as any).owner_id === (m as any).owner_id)) return false;
      }
    }

    // 서포트 검증
    for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
      if (team.members.filter(m => m.class_type === '치유').length > 1) return false;
      if (team.members.filter(m => m.class_type === '호법').length > 1) return false;
    }
    if (raid.team2 && !raid.team2.members.some(m => m.class_type === '치유')) return false;

    // 스펙미달+봇
    const hasBots = allMembers.some(m => 'isBot' in m && m.isBot);
    const hasUnder = allMembers.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered);
    if (hasBots && hasUnder) return false;
  }
  return true;
}

// ==========================================
// 메인 솔버 (루드라)
// ==========================================

export function solveRaidComposition(registrations: DBRegistration[], raidType: RaidType = '루드라', blockedOwnerSlots?: BlockedOwnerSlots): RaidComposition[] {
  if (registrations.length === 0) return [];
  void RAID_CONFIGS[raidType];

  const slotGroups = buildSlotGroups(registrations, blockedOwnerSlots);
  let allResults = generateCompositions(slotGroups);

  // 스펙미달+봇 필터
  const clean = allResults.filter(c => {
    for (const raid of c.raids) {
      if (raid.botCount === 0) continue;
      const allM = [...raid.team1.members, ...(raid.team2?.members || [])];
      if (allM.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered)) return false;
    }
    return true;
  });
  if (clean.length > 0) allResults = clean;

  // tryInclude 전수 적용
  allResults = allResults.map(comp => tryIncludeExcludedOwners(comp, slotGroups));

  // 중복 제거
  const seen = new Set<string>();
  const unique: RaidComposition[] = [];
  for (const comp of allResults) {
    const key = compositionKey(comp);
    if (!seen.has(key)) { seen.add(key); unique.push(comp); }
  }

  // 상위 50개 선별 → optimize
  unique.sort((a, b) => {
    const exDiff = a.excludedCharacters.length - b.excludedCharacters.length;
    if (exDiff !== 0) return exDiff;
    return a.score - b.score;
  });
  const top50 = unique.slice(0, 50);

  let processed = top50.map(comp => optimizeBalance(comp, slotGroups));
  processed = processed.filter(comp => validateComposition(comp));

  processed.sort((a, b) => {
    const exDiff = a.excludedCharacters.length - b.excludedCharacters.length;
    if (exDiff !== 0) return exDiff;
    return a.score - b.score;
  });
  return processed.slice(0, 5);
}

// ==========================================
// 브리레흐 1-3관문 솔버
// ==========================================

interface BriCharWithOwner {
  id: string;
  owner_id: string;
  ownerName: string;
  nickname: string;
  class_type: ClassType;
  has_destruction_robe: boolean;
  is_blast_lancer: boolean;
  has_soul_weapon: boolean;
  desired_clears: number;
  combat_power: number; // 0 (미사용, 타입 호환용)
  can_clear_raid: boolean;
  is_underpowered: boolean;
  isBot?: false;
}

interface BriSlotGroup {
  slot: TimeSlot;
  characters: BriCharWithOwner[];
}

function buildBriSlotGroups(registrations: DBRegistration[], blockedOwnerSlots?: BlockedOwnerSlots): BriSlotGroup[] {
  const byDate = new Map<string, { reg: DBRegistration; slot: TimeSlot }[]>();
  for (const reg of registrations) {
    for (const slot of reg.time_slots) {
      if (!byDate.has(slot.date)) byDate.set(slot.date, []);
      byDate.get(slot.date)!.push({ reg, slot });
    }
  }

  const result: BriSlotGroup[] = [];

  for (const [, entries] of byDate) {
    const rawSlots = new Map<string, TimeSlot>();
    for (const e of entries) {
      const key = `${e.slot.start_time}_${e.slot.end_time}`;
      rawSlots.set(key, e.slot);
    }

    // 1시간 초과 슬롯을 1시간 단위로 분할 (레이드 소요시간 = 1시간)
    const uniqueSlots = new Map<string, TimeSlot>();
    for (const [, slot] of rawSlots) {
      const startMin = timeToMinutes(slot.start_time);
      const endMin = timeToMinutes(slot.end_time);
      if (endMin - startMin > 60) {
        for (let t = startMin; t + 60 <= endMin; t += 60) {
          const subStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          const subEnd = `${String(Math.floor((t + 60) / 60)).padStart(2, '0')}:${String((t + 60) % 60).padStart(2, '0')}`;
          const key = `${subStart}_${subEnd}`;
          if (!uniqueSlots.has(key)) {
            uniqueSlots.set(key, { date: slot.date, start_time: subStart, end_time: subEnd });
          }
        }
      } else {
        const key = `${slot.start_time}_${slot.end_time}`;
        uniqueSlots.set(key, slot);
      }
    }

    for (const [, slot] of uniqueSlots) {
      const chars: BriCharWithOwner[] = [];
      for (const e of entries) {
        if (e.slot.start_time <= slot.start_time && e.slot.end_time >= slot.end_time) {
          // 크로스 레이드 차단 체크
          if (isOwnerBlockedAtSlot(e.reg.owner_name, slot, blockedOwnerSlots)) continue;

          for (const char of e.reg.characters) {
            const charId = `${e.reg.id}_${char.nickname}`;
            if (!chars.find(c => c.id === charId)) {
              chars.push({
                id: charId,
                owner_id: e.reg.id,
                ownerName: e.reg.owner_name,
                nickname: char.nickname,
                class_type: char.class_type,
                has_destruction_robe: char.has_destruction_robe ?? false,
                is_blast_lancer: char.is_blast_lancer ?? false,
                has_soul_weapon: char.has_soul_weapon ?? false,
                desired_clears: char.desired_clears ?? 1,
                combat_power: 0,
                can_clear_raid: false,
                is_underpowered: false,
              });
            }
          }
        }
      }

      if (chars.length > 0) {
        result.push({ slot, characters: chars });
      }
    }
  }

  result.sort((a, b) => {
    const d = a.slot.date.localeCompare(b.slot.date);
    return d !== 0 ? d : a.slot.start_time.localeCompare(b.slot.start_time);
  });
  return result;
}

function getAllBriChars(slotGroups: BriSlotGroup[]): BriCharWithOwner[] {
  const seen = new Set<string>();
  const result: BriCharWithOwner[] = [];
  for (const sg of slotGroups) {
    for (const c of sg.characters) {
      if (!seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }
  }
  return result;
}

// 브리레흐 파티 유효성 검사 (봇 포함 시 botCount 전달)
function isValidBriParty(members: BriCharWithOwner[], botCount: number = 0): boolean {
  const size = members.length + botCount;
  if (size < 4 || size > 8) return false;

  const sagaCount = members.filter(m => m.class_type === '세가').length;
  const sebaCount = members.filter(m => m.class_type === '세바').length;
  const realDealers = members.filter(m => m.class_type === '딜러');

  // 반드시 세가 1명
  if (sagaCount !== 1) return false;

  // 세바 규칙
  if (size <= 6) {
    if (sebaCount !== 1) return false;
  } else {
    if (sebaCount < 1 || sebaCount > 2) return false;
  }

  // 5인 이하: 실제 딜러만 파멸의 로브 또는 블래스트 랜서 체크 (봇 제외)
  if (size <= 5) {
    if (realDealers.some(d => !d.has_destruction_robe && !d.is_blast_lancer)) return false;
  }

  // 4인: 실제 딜러만 소울 무기 체크 (봇 제외)
  if (size === 4) {
    if (realDealers.some(d => !d.has_soul_weapon)) return false;
  }

  return true;
}

// 브리레흐 파티 선호도 점수 (낮을수록 좋음, realMembers만 전달)
function scoreBriParty(realMembers: BriCharWithOwner[]): number {
  let score = 0;
  const size = realMembers.length;

  // 7인에서 세바 1명 선호, 8인에서 세바 2명 선호
  const sebaCount = realMembers.filter(m => m.class_type === '세바').length;
  if (size === 7 && sebaCount > 1) score += 50;
  if (size === 8 && sebaCount < 2) score += 50;

  // 큰 파티 선호
  score -= size * 10;

  return score;
}

// 브리레흐 조합 점수
function scoreBriComposition(comp: RaidComposition, allChars: BriCharWithOwner[]): number {
  let score = 0;

  // 제외 인원 최소화 (매우 큰 패널티)
  score += comp.excludedCharacters.length * 30000;

  // 희망 클리어 횟수 충족도
  const charClears = new Map<string, number>();
  for (const raid of comp.raids) {
    for (const m of raid.team1.members) {
      if (!('isBot' in m && m.isBot)) {
        const key = m.nickname;
        charClears.set(key, (charClears.get(key) || 0) + 1);
      }
    }
  }

  for (const c of allChars) {
    const actual = charClears.get(c.nickname) || 0;
    const desired = c.desired_clears;
    if (actual < desired) {
      score += (desired - actual) * 500; // 미달 패널티
    } else if (actual > desired) {
      score += (actual - desired) * 200; // 초과 패널티 (약함)
    }
  }

  // 소유주별 참여 여부
  const participatingOwners = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of raid.team1.members) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
        participatingOwners.add((m as any).owner_id);
      }
    }
  }
  const allOwners = new Set(allChars.map(c => c.owner_id));
  for (const oid of allOwners) {
    if (!participatingOwners.has(oid)) score += 50000;
  }

  // 봇 패널티 (되도록 사용 안함)
  const totalBots = comp.raids.reduce((s, r) => s + r.botCount, 0);
  score += totalBots * 2000;

  // 파티 점수
  for (const raid of comp.raids) {
    const realMembers = raid.team1.members.filter(m => !('isBot' in m && m.isBot)) as any as BriCharWithOwner[];
    score += scoreBriParty(realMembers);
  }

  return score;
}

// 브리레흐 파티 형성 시도
function tryFormBriParty(
  available: BriCharWithOwner[],
  usedCharIds: Set<string>,
  timeSlot: TimeSlot,
  raidId: number,
  usedOwnersInSlot: Set<string>,
  targetSize: number,
  maxBots: number = 0,
): { raid: RaidGroup; usedChars: BriCharWithOwner[] } | null {
  const eligible = available.filter(
    c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id)
  );

  if (eligible.length < Math.min(4, targetSize)) return null;

  const sagas = eligible.filter(c => c.class_type === '세가');
  const sebas = eligible.filter(c => c.class_type === '세바');
  const dealers = eligible.filter(c => c.class_type === '딜러');

  if (sagas.length < 1) return null;
  if (sebas.length < 1) return null;

  const party: BriCharWithOwner[] = [];
  const usedOwners = new Set<string>();

  const addMember = (char: BriCharWithOwner): boolean => {
    if (usedOwners.has(char.owner_id)) return false;
    party.push(char);
    usedOwners.add(char.owner_id);
    return true;
  };

  // 1. 세가 1명 배치
  const saga = sagas.find(s => !usedOwners.has(s.owner_id));
  if (!saga) return null;
  addMember(saga);

  // 2. 세바 배치 (7인+ 파티는 2명까지)
  const sebaTarget = targetSize >= 8 ? 2 : 1;
  let sebaAdded = 0;
  for (const seba of sebas) {
    if (sebaAdded >= sebaTarget) break;
    if (usedOwners.has(seba.owner_id)) continue;
    addMember(seba);
    sebaAdded++;
  }
  if (sebaAdded < 1) return null;

  // 3. 딜러 채우기
  // targetSize가 5 이하면 파멸의 로브 필수, 4이면 소울 무기도 필수
  const filteredDealers = dealers.filter(d => {
    if (targetSize <= 5 && !d.has_destruction_robe && !d.is_blast_lancer) return false;
    if (targetSize === 4 && !d.has_soul_weapon) return false;
    return true;
  });

  // 희망 클리어 횟수 높은 딜러 우선
  const sortedDealers = [...filteredDealers].sort((a, b) => b.desired_clears - a.desired_clears);

  for (const dealer of sortedDealers) {
    if (party.length >= targetSize) break;
    if (usedOwners.has(dealer.owner_id)) continue;
    addMember(dealer);
  }

  // 7인+ 파티에서 세바 추가 배치 시도
  if (party.length >= 7 && sebaAdded < 2) {
    for (const seba of sebas) {
      if (party.length >= targetSize) break;
      if (usedOwners.has(seba.owner_id)) continue;
      if (party.includes(seba)) continue;
      addMember(seba);
      sebaAdded++;
      if (sebaAdded >= 2) break;
    }
  }

  // 봇 추가 (최소 인원 충족을 위해)
  let botCount = 0;
  if (party.length < 4 && maxBots > 0) {
    botCount = Math.min(maxBots, 4 - party.length);
  }

  if (!isValidBriParty(party, botCount)) return null;

  const teamMembers: RaidMember[] = party.map(c => ({ ...c, isBot: false as const, ownerName: c.ownerName }));
  for (let i = 0; i < botCount; i++) {
    teamMembers.push(createBot('딜러', 0, i + 1));
  }

  const team: Team = {
    members: teamMembers,
    avgCombatPower: 0,
  };

  return {
    raid: {
      id: raidId,
      team1: team,
      avgCombatPower: 0,
      botCount,
      timeSlot,
    },
    usedChars: party,
  };
}

function getBriOwnersInOverlappingRaids(raids: RaidGroup[], slot: TimeSlot): Set<string> {
  const owners = new Set<string>();
  for (const raid of raids) {
    if (slotsOverlapWithDuration(raid.timeSlot, slot)) {
      for (const m of raid.team1.members) {
        if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
          owners.add((m as any).owner_id);
        }
      }
    }
  }
  return owners;
}

function solveBriComposition(
  slotGroups: BriSlotGroup[],
  seed: number = 0,
): RaidComposition | null {
  const allChars = getAllBriChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let raidId = 1;

  // 소유주별 남은 희망 클리어 횟수 추적
  const ownerRemainingClears = new Map<string, number>();
  for (const c of allChars) {
    const current = ownerRemainingClears.get(c.owner_id) || 0;
    ownerRemainingClears.set(c.owner_id, Math.max(current, c.desired_clears));
  }

  // 시간대 순서 (seed로 변형)
  const orderedSlots = seed === 0
    ? [...slotGroups]
    : seed % 3 === 0
      ? [...slotGroups].reverse()
      : shuffle(slotGroups, seed);

  // 다양한 파티 크기로 시도 (8→4)
  const partySizes = seed % 2 === 0 ? [8, 7, 6, 5, 4] : [6, 7, 8, 5, 4];

  // 1단계: 봇 없이
  for (const targetSize of partySizes) {
    for (const sg of orderedSlots) {
      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        const usedOwnersInSlot = getBriOwnersInOverlappingRaids(raids, sg.slot);
        const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
        if (slotAvail.length < 4) break;

        const result = tryFormBriParty(sg.characters, usedCharIds, sg.slot, raidId, usedOwnersInSlot, targetSize, 0);
        if (!result) break;

        raids.push(result.raid);
        for (const c of result.usedChars) usedCharIds.add(c.id);
        raidId++;
      }
    }
  }

  // 2단계: 봇 포함 (남은 캐릭터 배치)
  for (const sg of orderedSlots) {
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const usedOwnersInSlot = getBriOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;

      const result = tryFormBriParty(sg.characters, usedCharIds, sg.slot, raidId, usedOwnersInSlot, 4, 2);
      if (!result) break;

      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  if (raids.length === 0) return null;

  const excluded = allChars
    .filter(c => !usedCharIds.has(c.id))
    .map(c => ({
      id: c.id, owner_id: c.owner_id, nickname: c.nickname,
      class_type: c.class_type, combat_power: 0,
      can_clear_raid: false, is_underpowered: false,
      ownerName: c.ownerName,
      has_destruction_robe: c.has_destruction_robe,
      is_blast_lancer: c.is_blast_lancer,
      has_soul_weapon: c.has_soul_weapon,
      desired_clears: c.desired_clears,
    }));

  const comp: RaidComposition = {
    raids: raids.map((r, i) => ({ ...r, id: i + 1 })),
    excludedCharacters: excluded,
    score: 0,
  };
  comp.score = scoreBriComposition(comp, allChars);
  return comp;
}

function brCompositionKey(comp: RaidComposition): string {
  const raidKeys = comp.raids.map(r => {
    const members = r.team1.members.map(m => m.nickname).sort().join(',');
    const slotKey = `${r.timeSlot.date}_${r.timeSlot.start_time}`;
    return `${slotKey}::${members}`;
  });
  raidKeys.sort();
  return raidKeys.join('||');
}

// 브리레흐 메인 솔버
export function solveBriRaidComposition(registrations: DBRegistration[], blockedOwnerSlots?: BlockedOwnerSlots): RaidComposition[] {
  if (registrations.length === 0) return [];

  const slotGroups = buildBriSlotGroups(registrations, blockedOwnerSlots);

  const allResults: RaidComposition[] = [];

  // 다양한 전략으로 조합 생성 (1000회 셔플)
  for (let seed = 0; seed < 1000; seed++) {
    const comp = solveBriComposition(slotGroups, seed * 7919);
    if (comp) allResults.push(comp);
  }

  // 중복 제거
  const seen = new Set<string>();
  const unique: RaidComposition[] = [];
  for (const comp of allResults) {
    const key = brCompositionKey(comp);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(comp);
    }
  }

  // 점수순 정렬 (점수에 제외 인원, 소유주 미참여 등 모두 반영됨)
  unique.sort((a, b) => a.score - b.score);

  return unique.slice(0, 5);
}
