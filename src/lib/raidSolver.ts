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

// 시간 문자열을 분 단위로 변환
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 레이드 소요시간(1시간)을 고려한 시간대 겹침 체크
function slotsOverlapWithDuration(a: TimeSlot, b: TimeSlot, durationMin = 60): boolean {
  if (a.date !== b.date) return false;
  const aStart = timeToMinutes(a.start_time);
  const aEnd = Math.max(timeToMinutes(a.end_time), aStart + durationMin);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = Math.max(timeToMinutes(b.end_time), bStart + durationMin);
  return aStart < bEnd && bStart < aEnd;
}

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

// 소유주가 해당 시간대에 차단되어 있는지 체크
function isOwnerBlockedAtSlot(ownerName: string, slot: TimeSlot, blocked: BlockedOwnerSlots | undefined): boolean {
  if (!blocked) return false;
  const ownerSlots = blocked.get(ownerName);
  if (!ownerSlots) return false;
  return ownerSlots.some(bs => slotsOverlapWithDuration(bs, slot));
}

// 시간대별 가용 캐릭터 그룹핑
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
    const uniqueSlots = new Map<string, TimeSlot>();
    for (const e of entries) {
      const key = `${e.slot.start_time}_${e.slot.end_time}`;
      uniqueSlots.set(key, e.slot);
    }

    for (const [, slot] of uniqueSlots) {
      const chars: CharacterWithOwner[] = [];

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

  // 시간순 정렬
  result.sort((a, b) => {
    const d = a.slot.date.localeCompare(b.slot.date);
    return d !== 0 ? d : a.slot.start_time.localeCompare(b.slot.start_time);
  });

  return result;
}

// 팀 평균 전투력 계산
// 케이스1: 서포터 0~1명 → 170K 이상이면 전원 평균, 미만이면 서포터 제외 평균
// 케이스2: 서포터 2명+ → 170K 이상 서포터는 딜러 취급
// 케이스2-1: 딜러 취급 가능 인원(딜러+170K이상서포터)이 3명 미만 → 합/3으로 계산
export function calcTeamAvg(members: RaidMember[]): number {
  const supporters = members.filter(m => m.class_type === '치유성' || m.class_type === '호법성');
  const dealers = members.filter(m => m.class_type === '근딜' || m.class_type === '원딜');

  if (supporters.length <= 1) {
    // 케이스1: 서포터 0~1명
    if (supporters.length === 1 && supporters[0].combat_power >= 170) {
      // 케이스1-1: 서포터 170K 이상 → 파티원 전원 평균
      if (members.length === 0) return 0;
      return members.reduce((sum, m) => sum + m.combat_power, 0) / members.length;
    } else {
      // 케이스1-2: 서포터 170K 미만 또는 서포터 없음 → 서포터 제외 평균
      if (dealers.length === 0) return 0;
      return dealers.reduce((sum, m) => sum + m.combat_power, 0) / dealers.length;
    }
  } else {
    // 케이스2: 서포터 2명 이상 → 170K 이상 서포터는 딜러 취급
    const strongSupporters = supporters.filter(s => s.combat_power >= 170);
    const effectiveDealers = [...dealers, ...strongSupporters];
    if (effectiveDealers.length === 0) return 0;
    const sum = effectiveDealers.reduce((s, m) => s + m.combat_power, 0);
    // 케이스2-1: 딜러 취급 가능 인원이 3명 미만이면 합/3으로 계산
    // (딜러 수가 모자라는 만큼 딜러들 전투력이 높아야 하기 때문)
    const divisor = Math.max(3, effectiveDealers.length);
    return sum / divisor;
  }
}

function createBot(classType: ClassType, combatPower: number, idx: number): BotCharacter {
  return { isBot: true, nickname: `공방인원${idx}`, class_type: classType, combat_power: combatPower };
}

function getBotCombatPower(members: CharacterWithOwner[]): number {
  const dps = members.filter(m => m.class_type !== '호법성' && m.class_type !== '치유성');
  if (dps.length === 0) return members.length > 0 ? Math.min(...members.map(m => m.combat_power)) : 0;
  return Math.min(...dps.map(m => m.combat_power));
}

function countSupportInTeam(members: RaidMember[]): number {
  return members.filter(m => m.class_type === '치유성' || m.class_type === '호법성').length;
}

function sortRaidsBotsLast(raids: RaidGroup[]): RaidGroup[] {
  const sorted = [...raids].sort((a, b) => a.botCount - b.botCount);
  return sorted.map((r, i) => ({ ...r, id: i + 1 }));
}

const MAX_TOTAL_BOTS = 30;   // 전체 봇 상한 (넉넉하게, 스코어링으로 제어)
const MAX_BOTS_NORMAL = 0;   // 일반 공격대 봇 불가 (마지막 공격대에만 배치)
const MAX_BOTS_LAST = 8;     // 마지막 공격대 봇 제한
const MIN_TEAM_AVG = 160;    // 팀 최소 평균 전투력 (딜러 기준)

function scoreComposition(comp: RaidComposition, raidType: RaidType = '루드라'): number {
  let score = 0;
  const totalBots = comp.raids.reduce((sum, r) => sum + r.botCount, 0);

  // 최우선: 제외 인원 최소화 (매우 큰 패널티)
  score += comp.excludedCharacters.length * 30000;

  // 전체 봇 초과 시 큰 패널티
  if (totalBots > MAX_TOTAL_BOTS) score += (totalBots - MAX_TOTAL_BOTS) * 8000;

  // 마지막 공격대 외에 봇이 있으면 매우 큰 패널티 (봇은 마지막 공격대에만 배치)
  const raidsByBots = [...comp.raids].sort((a, b) => a.botCount - b.botCount);
  for (let i = 0; i < raidsByBots.length - 1; i++) {
    if (raidsByBots[i].botCount > 0) {
      score += raidsByBots[i].botCount * 50000;
    }
  }

  // 봇 수 패널티
  score += totalBots * 500;

  // 호법성/치유성 봇 사용 시 추가 패널티 (DPS 봇 선호)
  for (const raid of comp.raids) {
    for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
      for (const m of team.members) {
        if ('isBot' in m && m.isBot && (m.class_type === '호법성' || m.class_type === '치유성')) {
          score += 3000;
        }
      }
    }
  }

  // 공격대 간 전투력 균등 (봇 4개 미만만, 높은 가중치)
  const validRaids = comp.raids.filter(r => r.botCount < 4);
  if (validRaids.length > 1) {
    const avgs = validRaids.map(r => r.avgCombatPower);
    const maxDiff = Math.max(...avgs) - Math.min(...avgs);
    score += maxDiff * 50;
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    const variance = avgs.reduce((s, v) => s + (v - mean) ** 2, 0) / avgs.length;
    score += Math.sqrt(variance) * 30;
  }

  // 모든 팀 간 전투력 균등
  const allTeamAvgs: number[] = [];
  for (const raid of validRaids) {
    allTeamAvgs.push(raid.team1.avgCombatPower);
    if (raid.team2) {
      allTeamAvgs.push(raid.team2.avgCombatPower);
      const teamDiff = Math.abs(raid.team1.avgCombatPower - raid.team2.avgCombatPower);
      score += teamDiff * 20;
    }
  }
  if (allTeamAvgs.length > 1) {
    const teamMaxDiff = Math.max(...allTeamAvgs) - Math.min(...allTeamAvgs);
    score += teamMaxDiff * 100;
    const teamMean = allTeamAvgs.reduce((a, b) => a + b, 0) / allTeamAvgs.length;
    const teamVar = allTeamAvgs.reduce((s, v) => s + (v - teamMean) ** 2, 0) / allTeamAvgs.length;
    score += Math.sqrt(teamVar) * 80;
  }

  // 근딜/원딜 각각 최소 1명 없으면 큰 패널티 (봇 제외 실제 인원 기준)
  for (const raid of comp.raids) {
    const t1Real = raid.team1.members.filter(m => !('isBot' in m && m.isBot));
    const t2Real = raid.team2?.members.filter(m => !('isBot' in m && m.isBot)) || [];
    if (!raid.team1.members.some(m => m.class_type === '근딜')) score += 10000;
    if (!raid.team1.members.some(m => m.class_type === '원딜')) score += 10000;
    if (raid.team2) {
      if (!raid.team2.members.some(m => m.class_type === '근딜')) score += 10000;
      if (!raid.team2.members.some(m => m.class_type === '원딜')) score += 10000;
    }
    // 실제 인원(봇 제외) 중에서도 체크 — 봇으로만 채운 경우 추가 패널티
    if (t1Real.length >= 3 && !t1Real.some(m => m.class_type === '원딜')) score += 5000;
    if (t1Real.length >= 3 && !t1Real.some(m => m.class_type === '근딜')) score += 5000;
    if (t2Real.length >= 3 && !t2Real.some(m => m.class_type === '원딜')) score += 5000;
    if (t2Real.length >= 3 && !t2Real.some(m => m.class_type === '근딜')) score += 5000;
  }

  // 동일 서포트 2명 동일 팀 매우 큰 패널티 (호법성+호법성, 치유성+치유성 비선호)
  for (const raid of comp.raids) {
    const t1Tanks = raid.team1.members.filter(m => m.class_type === '호법성').length;
    const t1Healers = raid.team1.members.filter(m => m.class_type === '치유성').length;
    if (t1Tanks >= 2) score += 100000;
    if (t1Healers >= 2) score += 100000;
    if (raid.team2) {
      const t2Tanks = raid.team2.members.filter(m => m.class_type === '호법성').length;
      const t2Healers = raid.team2.members.filter(m => m.class_type === '치유성').length;
      if (t2Tanks >= 2) score += 100000;
      if (t2Healers >= 2) score += 100000;
    }
  }

  // 서포트 과다 팀 패널티 (되도록 한 파티에 여러 서포트 비선호)
  for (const raid of comp.raids) {
    if (!raid.team2) continue;
    const t1Support = countSupportInTeam(raid.team1.members);
    const t2Support = countSupportInTeam(raid.team2.members);
    if (t1Support > 1) score += (t1Support - 1) * 300;
    if (t2Support > 1) score += (t2Support - 1) * 300;

    // 서포트 2명 이상이 한 팀에 들어가야 하는 경우, 양 팀 모두 치유성 선호
    const totalSupport = t1Support + t2Support;
    if (totalSupport >= 3) {
      const t1Healers = raid.team1.members.filter(m => m.class_type === '치유성').length;
      const t2Healers = raid.team2.members.filter(m => m.class_type === '치유성').length;
      if (t1Healers >= 1 && t2Healers >= 1) score -= 150;
      if (t1Healers === 0 || t2Healers === 0) score += 200;
    }
  }

  // 전투력이 강한 딜러는 호법성과 같은 팀에 있으면 보너스
  for (const raid of comp.raids) {
    if (!raid.team2) continue;
    const allDealers = [...raid.team1.members, ...raid.team2.members]
      .filter(m => (m.class_type === '근딜' || m.class_type === '원딜') && !('isBot' in m && m.isBot));
    if (allDealers.length === 0) continue;
    const avgPower = allDealers.reduce((s, m) => s + m.combat_power, 0) / allDealers.length;

    for (const team of [raid.team1, raid.team2]) {
      const hasTank = team.members.some(m => m.class_type === '호법성' && !('isBot' in m && m.isBot));
      if (!hasTank) continue;
      const strongDealers = team.members.filter(
        m => (m.class_type === '근딜' || m.class_type === '원딜') && !('isBot' in m && m.isBot) && m.combat_power > avgPower
      );
      // 강한 딜러가 호법성과 같은 팀 → 보너스
      score -= strongDealers.length * 100;
    }
  }

  // 스펙 미달 인원과 봇이 같은 공격대에 있으면 큰 패널티
  for (const raid of comp.raids) {
    if (raid.botCount === 0) continue;
    const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
    const hasUnder = allMembers.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered);
    if (hasUnder) score += 30000;
  }

  // 봇이 있는 공격대 수에 따라 패널티 (봇 분산 비선호)
  const raidsWithBots = comp.raids.filter(r => r.botCount > 0).length;
  if (raidsWithBots > 1) score += (raidsWithBots - 1) * 1000;

  // 2파티 전투력이 1파티보다 높아야 함
  for (const raid of comp.raids) {
    if (!raid.team2) continue;
    if (raid.team1.avgCombatPower > raid.team2.avgCombatPower) {
      score += (raid.team1.avgCombatPower - raid.team2.avgCombatPower) * 100;
    }
  }

  // 루드라: 파티 평균 DPS 160K 이상 선호
  if (raidType === '루드라') {
    for (const raid of comp.raids) {
      if (raid.team1.avgCombatPower < 160 && raid.botCount === 0) {
        score += (160 - raid.team1.avgCombatPower) * 50;
      }
      if (raid.team2 && raid.team2.avgCombatPower < 160 && raid.botCount === 0) {
        score += (160 - raid.team2.avgCombatPower) * 50;
      }
    }
  }

  // 소유주별 참여 여부: 한번도 참여 못한 소유주가 있으면 큰 패널티
  const participatingOwners = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
        participatingOwners.add((m as any).owner_id);
      }
    }
  }
  const excludedOwners = new Set<string>();
  for (const ex of comp.excludedCharacters) {
    if ('owner_id' in ex) excludedOwners.add((ex as any).owner_id);
  }
  // 제외된 소유주 중 한번도 참여하지 못한 소유주
  for (const ownerId of excludedOwners) {
    if (!participatingOwners.has(ownerId)) {
      score += 50000; // 한번도 참여 못한 소유주 매우 큰 패널티
    }
  }

  // 제외 우선순위
  for (const ex of comp.excludedCharacters) {
    if ('is_underpowered' in ex && (ex as any).is_underpowered) {
      score += 50000;
    } else if (ex.can_clear_raid) {
      score -= Math.max(0, 500 - ex.combat_power);
    } else {
      score += 1000;
    }
  }

  return score;
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

// 소유자가 DPS 캐릭도 보유하는지 체크 (서포트 배치 우선순위용)
function ownerHasDps(ownerId: string, eligible: CharacterWithOwner[]): boolean {
  return eligible.some(c => c.owner_id === ownerId && (c.class_type === '근딜' || c.class_type === '원딜'));
}

// 단일 공격대 생성
function tryFormRaid(
  available: CharacterWithOwner[],
  usedCharIds: Set<string>,
  timeSlot: TimeSlot,
  raidId: number,
  _globalBotCount: number,
  maxBotsPerRaid: number,
  usedOwnersInTimeSlot: Set<string>
): { raid: RaidGroup; usedChars: CharacterWithOwner[] } | null {
  const eligible = available.filter(
    c => !usedCharIds.has(c.id) && !usedOwnersInTimeSlot.has(c.owner_id)
      && !(maxBotsPerRaid > 0 && c.is_underpowered)
  );

  if (eligible.length === 0) return null;

  // 서포트 우선순위: DPS 캐릭이 없는 전용 서포트 소유자를 먼저 배치
  // (멀티캐릭 소유자의 서포트를 아끼고, DPS 캐릭을 다른 시간대에서 활용할 수 있도록)
  const healers = eligible
    .filter(c => c.class_type === '치유성')
    .sort((a, b) => {
      const aHasDps = ownerHasDps(a.owner_id, eligible) ? 1 : 0;
      const bHasDps = ownerHasDps(b.owner_id, eligible) ? 1 : 0;
      return aHasDps - bHasDps; // DPS 없는 소유자 우선
    });

  const tanks = eligible
    .filter(c => c.class_type === '호법성')
    .sort((a, b) => {
      const aHasDps = ownerHasDps(a.owner_id, eligible) ? 1 : 0;
      const bHasDps = ownerHasDps(b.owner_id, eligible) ? 1 : 0;
      return aHasDps - bHasDps;
    });

  const team1Members: RaidMember[] = [];
  const team2Members: RaidMember[] = [];
  const usedChars: CharacterWithOwner[] = [];
  const usedOwnerIds = new Set<string>();
  let botCount = 0;

  const addToTeam = (team: RaidMember[], char: CharacterWithOwner) => {
    team.push({ ...char, isBot: false, ownerName: char.ownerName });
    usedChars.push(char);
    usedOwnerIds.add(char.owner_id);
  };

  const isOwnerInRaid = (ownerId: string) => usedOwnerIds.has(ownerId);

  // 2팀: 치유성 정확히 1명
  const availHealer = healers.find(h => !isOwnerInRaid(h.owner_id));
  if (availHealer) {
    addToTeam(team2Members, availHealer);
  } else if (botCount < maxBotsPerRaid) {
    team2Members.push(createBot('치유성', getBotCombatPower(eligible), ++botCount));
  } else {
    return null;
  }

  // 1팀: 호법성 > 치유성 > 봇 정확히 1명
  const remainTanks = tanks.filter(c => !usedChars.find(u => u.id === c.id) && !isOwnerInRaid(c.owner_id));
  const remainHealers = healers.filter(c => !usedChars.find(u => u.id === c.id) && !isOwnerInRaid(c.owner_id));

  if (remainTanks.length > 0) {
    addToTeam(team1Members, remainTanks[0]);
  } else if (remainHealers.length > 0) {
    addToTeam(team1Members, remainHealers[0]);
  } else if (botCount < maxBotsPerRaid) {
    team1Members.push(createBot('호법성', getBotCombatPower(eligible), ++botCount));
  } else {
    return null;
  }

  // 나머지 배치 (DPS 우선, 전투력 균형 기반 + 근딜/원딜 분산)
  const remainingDps = eligible
    .filter(c => !usedChars.find(u => u.id === c.id) && !isOwnerInRaid(c.owner_id) && (c.class_type === '근딜' || c.class_type === '원딜'))
    .sort((a, b) => b.combat_power - a.combat_power);

  const teamDpsSum = (team: RaidMember[]) =>
    team.filter(m => m.class_type === '근딜' || m.class_type === '원딜').reduce((s, m) => s + m.combat_power, 0);

  for (const char of remainingDps) {
    if (team1Members.length >= 4 && team2Members.length >= 4) break;
    if (isOwnerInRaid(char.owner_id)) continue;

    const can1 = team1Members.length < 4;
    const can2 = team2Members.length < 4;

    if (can1 && can2) {
      // 근딜/원딜 분산: 한쪽 팀에 해당 타입이 없으면 우선 배치
      const t1HasType = team1Members.some(m => m.class_type === char.class_type);
      const t2HasType = team2Members.some(m => m.class_type === char.class_type);
      if (!t1HasType && t2HasType) {
        addToTeam(team1Members, char);
      } else if (!t2HasType && t1HasType) {
        addToTeam(team2Members, char);
      } else if (teamDpsSum(team2Members) <= teamDpsSum(team1Members)) {
        addToTeam(team2Members, char);
      } else {
        addToTeam(team1Members, char);
      }
    } else if (can1) {
      addToTeam(team1Members, char);
    } else if (can2) {
      addToTeam(team2Members, char);
    }
  }

  // DPS 배치 후 근딜/원딜 균형 스왑
  // team1에 원딜 없고 team2에 원딜 2+이면, team2 원딜 ↔ team1 근딜 스왑
  // team1에 근딜 없고 team2에 근딜 2+이면, team2 근딜 ↔ team1 원딜 스왑 (역방향도)
  for (const [teamA, teamB] of [[team1Members, team2Members], [team2Members, team1Members]] as [RaidMember[], RaidMember[]][]) {
    for (const missingType of ['근딜', '원딜'] as ClassType[]) {
      const otherType = missingType === '근딜' ? '원딜' : '근딜';
      const hasMissing = teamA.some(m => m.class_type === missingType);
      if (hasMissing) continue;
      const bCandidates = teamB.filter(m => m.class_type === missingType && !('isBot' in m && m.isBot));
      const aCandidates = teamA.filter(m => m.class_type === otherType && !('isBot' in m && m.isBot));
      if (bCandidates.length >= 2 && aCandidates.length >= 1) {
        // 스왑: teamA의 otherType 하나 ↔ teamB의 missingType 하나
        const aIdx = teamA.indexOf(aCandidates[0]);
        const bIdx = teamB.indexOf(bCandidates[0]);
        [teamA[aIdx], teamB[bIdx]] = [teamB[bIdx], teamA[aIdx]];
      } else if (bCandidates.length >= 1 && aCandidates.length >= 1) {
        // teamB에 1명이라도 있고 teamA에 해당 타입이 0명이면 스왑
        const bHasOther = teamB.some(m => m.class_type === otherType);
        if (bHasOther || aCandidates.length >= 2) {
          const aIdx = teamA.indexOf(aCandidates[aCandidates.length - 1]);
          const bIdx = teamB.indexOf(bCandidates[0]);
          [teamA[aIdx], teamB[bIdx]] = [teamB[bIdx], teamA[aIdx]];
        }
      }
    }
  }

  // DPS 부족 시 남은 서포트 캐릭터로 빈 자리 채우기
  // 치유성+호법성 같은 팀 허용, 호법성+호법성 동일 팀은 비허용
  const remainingSupports = eligible
    .filter(c => !usedChars.find(u => u.id === c.id) && !isOwnerInRaid(c.owner_id) && (c.class_type === '치유성' || c.class_type === '호법성'))
    .sort((a, b) => b.combat_power - a.combat_power);

  for (const char of remainingSupports) {
    if (team1Members.length >= 4 && team2Members.length >= 4) break;
    if (isOwnerInRaid(char.owner_id)) continue;

    const can1 = team1Members.length < 4;
    const can2 = team2Members.length < 4;
    const t1Tanks = team1Members.filter(m => m.class_type === '호법성').length;
    const t2Tanks = team2Members.filter(m => m.class_type === '호법성').length;

    if (char.class_type === '호법성') {
      // 호법성: 이미 호법성이 있는 팀에는 배치하지 않음 (호법성+호법성 방지)
      const canPlace1 = can1 && t1Tanks === 0;
      const canPlace2 = can2 && t2Tanks === 0;
      if (canPlace1 && canPlace2) {
        const t1Support = countSupportInTeam(team1Members);
        const t2Support = countSupportInTeam(team2Members);
        if (t1Support <= t2Support) {
          addToTeam(team1Members, char);
        } else {
          addToTeam(team2Members, char);
        }
      } else if (canPlace1) {
        addToTeam(team1Members, char);
      } else if (canPlace2) {
        addToTeam(team2Members, char);
      }
    } else {
      // 치유성: 이미 치유성이 있는 팀에는 배치하지 않음 (치유성+치유성 방지)
      const t1Healers = team1Members.filter(m => m.class_type === '치유성').length;
      const t2Healers = team2Members.filter(m => m.class_type === '치유성').length;
      const canPlace1 = can1 && t1Healers === 0;
      const canPlace2 = can2 && t2Healers === 0;
      if (canPlace1 && canPlace2) {
        const t1Support = countSupportInTeam(team1Members);
        const t2Support = countSupportInTeam(team2Members);
        if (t1Support <= t2Support) {
          addToTeam(team1Members, char);
        } else {
          addToTeam(team2Members, char);
        }
      } else if (canPlace1) {
        addToTeam(team1Members, char);
      } else if (canPlace2) {
        addToTeam(team2Members, char);
      }
    }
  }

  // 봇 채우기 (근딜/원딜 각각 최소 1명 보장)
  const botPower = getBotCombatPower(usedChars);

  while (team1Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team1Members.some(m => m.class_type === '근딜');
    const needRanged = !team1Members.some(m => m.class_type === '원딜');
    const botClass = needMelee ? '근딜' : needRanged ? '원딜' : '원딜';
    team1Members.push(createBot(botClass, botPower, ++botCount));
  }
  while (team2Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team2Members.some(m => m.class_type === '근딜');
    const needRanged = !team2Members.some(m => m.class_type === '원딜');
    const botClass = needMelee ? '근딜' : needRanged ? '원딜' : '원딜';
    team2Members.push(createBot(botClass, botPower, ++botCount));
  }

  if (team1Members.length < 4 || team2Members.length < 4) return null;
  // 서포트 최소 요건: 각 팀에 최소 1명 서포트, 동일 서포트 중복 불가
  if (countSupportInTeam(team1Members) < 1) return null;
  if (countSupportInTeam(team2Members) < 1) return null;
  const team2Healers = team2Members.filter(m => m.class_type === '치유성').length;
  if (team2Healers < 1) return null; // 2팀에는 치유성 최소 1명 필수
  // 동일 서포트 2명 동일 팀 방지 (호법성+호법성, 치유성+치유성)
  if (team1Members.filter(m => m.class_type === '호법성').length >= 2) return null;
  if (team2Members.filter(m => m.class_type === '호법성').length >= 2) return null;
  if (team1Members.filter(m => m.class_type === '치유성').length >= 2) return null;
  if (team2Members.filter(m => m.class_type === '치유성').length >= 2) return null;

  // 후처리: 2파티 전투력이 1파티보다 높도록 DPS 스왑
  const t1Avg = calcTeamAvg(team1Members);
  const t2Avg = calcTeamAvg(team2Members);
  if (t1Avg > t2Avg) {
    const t1Dps = team1Members.filter(m => m.class_type === '근딜' || m.class_type === '원딜');
    const t2Dps = team2Members.filter(m => m.class_type === '근딜' || m.class_type === '원딜');
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
      const [si, sj] = bestSwap;
      // 스왑 후 근딜/원딜 밸런스가 깨지지 않는지 확인
      const t1WouldLoseType = t1Dps[si].class_type;
      const t2WouldLoseType = t2Dps[sj].class_type;
      const t1OthersOfType = t1Dps.filter((m, idx) => idx !== si && m.class_type === t1WouldLoseType).length;
      const t2OthersOfType = t2Dps.filter((m, idx) => idx !== sj && m.class_type === t2WouldLoseType).length;
      // 스왑으로 한쪽 팀에서 해당 타입이 0이 되지 않으면 스왑
      const t1GainsType = t2WouldLoseType;
      const t2GainsType = t1WouldLoseType;
      const t1StillHasLostType = t1OthersOfType > 0 || t1GainsType === t1WouldLoseType;
      const t2StillHasLostType = t2OthersOfType > 0 || t2GainsType === t2WouldLoseType;
      if (t1StillHasLostType && t2StillHasLostType) {
        const t1Idx = team1Members.indexOf(t1Dps[si]);
        const t2Idx = team2Members.indexOf(t2Dps[sj]);
        [team1Members[t1Idx], team2Members[t2Idx]] = [team2Members[t2Idx], team1Members[t1Idx]];
      }
    }
  }

  // 최종 근딜/원딜 보장 스왑 (봇 포함 후 최종 검증)
  for (const [teamA, teamB] of [[team1Members, team2Members], [team2Members, team1Members]] as [RaidMember[], RaidMember[]][]) {
    for (const needType of ['근딜', '원딜'] as ClassType[]) {
      if (teamA.some(m => m.class_type === needType)) continue;
      // teamA에 needType이 없음 → teamB에서 needType 하나를 가져오고 대신 다른 DPS를 보냄
      const otherType = needType === '근딜' ? '원딜' : '근딜';
      const bCandidate = teamB.filter(m => m.class_type === needType && !('isBot' in m && m.isBot));
      const aCandidate = teamA.filter(m => m.class_type === otherType && !('isBot' in m && m.isBot));
      if (bCandidate.length >= 1 && aCandidate.length >= 1) {
        // teamB가 스왑 후에도 needType을 유지하는지 확인
        if (bCandidate.length >= 2 || teamB.some(m => m.class_type === otherType)) {
          const aIdx = teamA.indexOf(aCandidate[aCandidate.length - 1]);
          const bIdx = teamB.indexOf(bCandidate[0]);
          [teamA[aIdx], teamB[bIdx]] = [teamB[bIdx], teamA[aIdx]];
        }
      }
    }
  }

  const team1: Team = { members: team1Members, avgCombatPower: calcTeamAvg(team1Members) };
  const team2: Team = { members: team2Members, avgCombatPower: calcTeamAvg(team2Members) };

  // 팀 평균 전투력 최소 기준 미달 시 거부 (봇이 있는 공격대만 체크)
  if (botCount > 0) {
    if (team1.avgCombatPower < MIN_TEAM_AVG || team2.avgCombatPower < MIN_TEAM_AVG) {
      return null;
    }
  }

  return {
    raid: {
      id: raidId,
      team1, team2,
      avgCombatPower: (team1.avgCombatPower + team2.avgCombatPower) / 2,
      botCount,
      timeSlot,
    },
    usedChars,
  };
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

function getAllUniqueChars(slotGroups: SlotGroup[]): CharacterWithOwner[] {
  const seen = new Set<string>();
  const result: CharacterWithOwner[] = [];
  for (const sg of slotGroups) {
    for (const c of sg.characters) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        result.push(c);
      }
    }
  }
  return result;
}

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

// === 잔여 인원 구제 단계 ===
// 아직 참여하지 못한 캐릭터가 있는 시간대에서 봇을 활용하여 추가 공격대 편성
function rescueExcludedCharacters(
  slotGroups: SlotGroup[],
  raids: RaidGroup[],
  usedCharIds: Set<string>,
  raidIdStart: number,
): { newRaids: RaidGroup[]; newUsedIds: string[] } {
  const newRaids: RaidGroup[] = [];
  const newUsedIds: string[] = [];
  let raidId = raidIdStart;

  // 아직 참여하지 못한 소유주 파악
  const participatingOwners = new Set<string>();
  for (const raid of [...raids, ...newRaids]) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
        participatingOwners.add((m as any).owner_id);
      }
    }
  }

  const allChars = getAllUniqueChars(slotGroups);
  const excludedOwnerIds = new Set<string>();
  for (const c of allChars) {
    if (!usedCharIds.has(c.id) && !participatingOwners.has(c.owner_id)) {
      excludedOwnerIds.add(c.owner_id);
    }
  }

  if (excludedOwnerIds.size === 0) return { newRaids, newUsedIds };

  // 기존 공격대에 이미 봇이 있는지 확인
  const existingBotRaid = raids.some(r => r.botCount > 0);

  // 미참여 소유주가 가용한 시간대에서 공격대 편성 시도
  // 봇 없이 구성 가능한 공격대 먼저, 이후 봇 포함 공격대는 1개만
  let botRaidFormed = existingBotRaid; // 기존에 봇 공격대가 있으면 추가 불가
  for (const sg of slotGroups) {
    const usedOwnersInSlot = getOwnersInOverlappingRaids([...raids, ...newRaids], sg.slot);
    const available = sg.characters.filter(c =>
      !usedCharIds.has(c.id) && !newUsedIds.includes(c.id) && !usedOwnersInSlot.has(c.owner_id)
    );

    // 이 슬롯에 미참여 소유주의 캐릭터가 있는지
    const hasExcludedOwner = available.some(c => excludedOwnerIds.has(c.owner_id));
    if (!hasExcludedOwner) continue;
    if (available.length < 1) continue;

    // 봇 없이 시도
    const combinedUsed = new Set([...usedCharIds, ...newUsedIds]);
    const result = tryFormRaid(sg.characters, combinedUsed, sg.slot, raidId, 0, 0, usedOwnersInSlot);
    if (!result) continue;

    newRaids.push(result.raid);
    for (const c of result.usedChars) newUsedIds.push(c.id);
    raidId++;

    for (const m of [...result.raid.team1.members, ...(result.raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
        excludedOwnerIds.delete((m as any).owner_id);
      }
    }

    if (excludedOwnerIds.size === 0) break;
  }

  // 봇 포함 공격대 (마지막 1개만)
  if (excludedOwnerIds.size > 0 && !botRaidFormed) {
    for (const sg of slotGroups) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids([...raids, ...newRaids], sg.slot);
      const available = sg.characters.filter(c =>
        !usedCharIds.has(c.id) && !newUsedIds.includes(c.id) && !usedOwnersInSlot.has(c.owner_id)
      );

      const hasExcludedOwner = available.some(c => excludedOwnerIds.has(c.owner_id));
      if (!hasExcludedOwner) continue;
      if (available.length < 1) continue;

      const combinedUsed = new Set([...usedCharIds, ...newUsedIds]);
      const result = tryFormRaid(sg.characters, combinedUsed, sg.slot, raidId, 0, MAX_BOTS_LAST, usedOwnersInSlot);
      if (!result) continue;

      newRaids.push(result.raid);
      for (const c of result.usedChars) newUsedIds.push(c.id);
      raidId++;
      botRaidFormed = true;
      break; // 봇 포함 공격대 1개만
    }
  }

  return { newRaids, newUsedIds };
}

// 조합에 잔여 인원 구제 단계 적용
function applyRescue(
  raids: RaidGroup[],
  usedCharIds: Set<string>,
  slotGroups: SlotGroup[],
  raidType: RaidType,
): RaidComposition {
  const { newRaids, newUsedIds } = rescueExcludedCharacters(
    slotGroups, raids, usedCharIds, raids.length + 1
  );

  const allUsedIds = new Set([...usedCharIds, ...newUsedIds]);
  const allRaids = [...raids, ...newRaids];
  const allChars = getAllUniqueChars(slotGroups);

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(allRaids),
    excludedCharacters: getExcluded(allChars, allUsedIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// === 크로스-시간대 스케줄링 ===
function crossSlotComposition(
  slotGroups: SlotGroup[],
  _maxBotsPerRaid: number,
  strategy: 'greedy' | 'balanced',
  raidType: RaidType = '루드라'
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  const getSlotOrder = () => {
    if (strategy === 'greedy') {
      return [...slotGroups].sort((a, b) => {
        const aAvail = a.characters.filter(c => !usedCharIds.has(c.id)).length;
        const bAvail = b.characters.filter(c => !usedCharIds.has(c.id)).length;
        return bAvail - aAvail;
      });
    }
    return [...slotGroups];
  };

  // 1단계: 봇 포함하여 공격대 구성 (공격대당 최대 MAX_BOTS_NORMAL봇)
  const sortedSlots = getSlotOrder();
  for (const sg of sortedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(MAX_BOTS_NORMAL, remainingBots), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 마지막 공격대 (최대 MAX_BOTS_LAST봇)
  if (globalBotCount < MAX_TOTAL_BOTS) {
    const sortedSlots2 = getSlotOrder();
    for (const sg of sortedSlots2) {
      if (globalBotCount >= MAX_TOTAL_BOTS) break;
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) continue;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(MAX_BOTS_LAST, remainingBots), usedOwnersInSlot);
      if (!result) continue;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
      break; // 마지막 공격대 1개만
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// 균등 분배 크로스-시간대
function crossSlotBalanced(slotGroups: SlotGroup[], _maxBots: number, raidType: RaidType = '루드라'): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  for (const sg of slotGroups) {
    const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
    const available = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
    if (available.length < 2) continue;

    const numRaidsInSlot = Math.max(1, Math.floor(available.length / 8));

    if (numRaidsInSlot > 1) {
      const sorted = [...available].sort((a, b) => b.combat_power - a.combat_power);
      const groups: CharacterWithOwner[][] = Array.from({ length: numRaidsInSlot }, () => []);
      const healers = sorted.filter(c => c.class_type === '치유성');
      const tanks = sorted.filter(c => c.class_type === '호법성');
      const dps = sorted.filter(c => c.class_type === '근딜' || c.class_type === '원딜');
      const assignedIds = new Set<string>();

      for (let i = 0; i < numRaidsInSlot; i++) {
        if (i < healers.length) { groups[i].push(healers[i]); assignedIds.add(healers[i].id); }
        const t = tanks.find(c => !assignedIds.has(c.id));
        const h = healers.find(c => !assignedIds.has(c.id));
        if (t) { groups[i].push(t); assignedIds.add(t.id); }
        else if (h) { groups[i].push(h); assignedIds.add(h.id); }
      }

      let dir = 1, gi = 0;
      for (const c of dps) {
        if (assignedIds.has(c.id)) continue;
        while (gi >= 0 && gi < numRaidsInSlot && groups[gi].length >= 8) gi += dir;
        if (gi < 0 || gi >= numRaidsInSlot) { dir *= -1; gi += dir; while (gi >= 0 && gi < numRaidsInSlot && groups[gi].length >= 8) gi += dir; }
        if (gi < 0 || gi >= numRaidsInSlot) break;
        groups[gi].push(c);
        gi += dir;
        if (gi < 0 || gi >= numRaidsInSlot) { dir *= -1; gi += dir; }
      }

      for (const group of groups) {
        if (group.length < 2) continue;
        const result = tryFormRaid(group, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
        if (result) {
          raids.push(result.raid);
          for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
          raidId++;
        }
      }
    } else {
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (result) {
        raids.push(result.raid);
        for (const c of result.usedChars) { usedCharIds.add(c.id); usedOwnersInSlot.add(c.owner_id); }
        raidId++;
      }
    }
  }

  // 2단계: 봇 포함하여 추가 공격대 구성 (공격대당 최대 MAX_BOTS_NORMAL봇)
  for (const sg of slotGroups) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot2 = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot2.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_NORMAL, rem), usedOwnersInSlot2);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 3단계: 마지막 공격대 (최대 MAX_BOTS_LAST봇)
  if (globalBotCount < MAX_TOTAL_BOTS) {
    for (const sg of slotGroups) {
      if (globalBotCount >= MAX_TOTAL_BOTS) break;
      const usedOwnersInSlot3 = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot3.has(c.owner_id));
      if (slotAvail.length < 2) continue;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_LAST, rem), usedOwnersInSlot3);
      if (!result) continue;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
      break;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// 배열 셔플 (Fisher-Yates)
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

// 셔플된 캐릭터 순서로 크로스-시간대 구성
function shuffledComposition(
  slotGroups: SlotGroup[],
  _maxBotsPerRaid: number,
  seed: number,
  raidType: RaidType = '루드라'
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  const shuffledSlots: SlotGroup[] = slotGroups.map(sg => ({
    slot: sg.slot,
    characters: shuffle(sg.characters, seed + sg.slot.date.charCodeAt(0)),
  }));

  const orderedSlots = seed % 3 === 0
    ? [...shuffledSlots].reverse()
    : seed % 3 === 1
      ? shuffle(shuffledSlots, seed)
      : shuffledSlots;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  // 1단계: 봇 포함하여 공격대 구성 (공격대당 최대 MAX_BOTS_NORMAL봇)
  for (const sg of orderedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_NORMAL, remainingBots), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 마지막 공격대 (최대 MAX_BOTS_LAST봇)
  if (globalBotCount < MAX_TOTAL_BOTS) {
    for (const sg of orderedSlots) {
      if (globalBotCount >= MAX_TOTAL_BOTS) break;
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) continue;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_LAST, rem), usedOwnersInSlot);
      if (!result) continue;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
      break;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// === 최대 공격대 수 전략 ===
// 서포트를 DPS 역할에서 분리하여, 다른 시간대에서 서포트가 부족하지 않게 함
function maxRaidsComposition(
  slotGroups: SlotGroup[],
  _maxBotsPerRaid: number,
  seed: number,
  raidType: RaidType = '루드라'
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  // 소유자별 캐릭터 매핑
  const ownerChars = new Map<string, CharacterWithOwner[]>();
  for (const c of allChars) {
    if (!ownerChars.has(c.owner_id)) ownerChars.set(c.owner_id, []);
    ownerChars.get(c.owner_id)!.push(c);
  }

  // 소유자를 분류: 서포트 전용 vs 서포트+DPS vs DPS 전용
  const supportOnlyOwners: string[] = []; // 서포트만 있는 소유자
  const multiRoleOwners: string[] = []; // 서포트+DPS 둘 다 있는 소유자

  for (const [ownerId, chars] of ownerChars) {
    const hasSupport = chars.some(c => c.class_type === '치유성' || c.class_type === '호법성');
    const hasDps = chars.some(c => c.class_type === '근딜' || c.class_type === '원딜');
    if (hasSupport && !hasDps) supportOnlyOwners.push(ownerId);
    else if (hasSupport && hasDps) multiRoleOwners.push(ownerId);
  }

  // 시간대별 가용 소유자 수를 기반으로 "빈도가 낮은 시간대" 우선
  // → 인원이 적은 시간대에서 서포트 전용 소유자를 먼저 사용
  const slotsByScarcity = [...slotGroups].sort((a, b) => {
    const aOwners = new Set(a.characters.map(c => c.owner_id)).size;
    const bOwners = new Set(b.characters.map(c => c.owner_id)).size;
    return aOwners - bOwners; // 적은 인원 시간대 우선
  });

  // seed로 전략 변형
  const orderedSlots = seed % 4 === 0
    ? slotsByScarcity
    : seed % 4 === 1
      ? [...slotsByScarcity].reverse()
      : seed % 4 === 2
        ? shuffle(slotGroups, seed)
        : slotGroups;

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  // 1단계: 봇 포함하여 공격대 구성 (공격대당 최대 MAX_BOTS_NORMAL봇)
  for (const sg of orderedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_NORMAL, rem), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 마지막 공격대 (최대 MAX_BOTS_LAST봇)
  if (globalBotCount < MAX_TOTAL_BOTS) {
    for (const sg of orderedSlots) {
      if (globalBotCount >= MAX_TOTAL_BOTS) break;
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) continue;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(MAX_BOTS_LAST, rem), usedOwnersInSlot);
      if (!result) continue;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
      break;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// === 소유주 포함 우선 전략 ===
// 가용 시간대가 적은 소유주의 슬롯에서 먼저 공격대를 구성 (봇 허용)
function inclusiveComposition(
  slotGroups: SlotGroup[],
  _maxBotsPerRaid: number,
  raidType: RaidType = '루드라'
): RaidComposition | null {
  const allChars = getAllUniqueChars(slotGroups);
  if (allChars.length === 0) return null;

  // 소유주별 가용 슬롯 수 계산
  const ownerSlotCount = new Map<string, number>();
  for (const sg of slotGroups) {
    const owners = new Set(sg.characters.map(c => c.owner_id));
    for (const oid of owners) {
      ownerSlotCount.set(oid, (ownerSlotCount.get(oid) || 0) + 1);
    }
  }

  // 가용 슬롯이 가장 적은 소유주가 포함된 슬롯을 우선 처리
  const slotsWithScarcity = slotGroups.map(sg => {
    const minOwnerSlots = Math.min(
      ...sg.characters.map(c => ownerSlotCount.get(c.owner_id) || 999)
    );
    return { sg, minOwnerSlots };
  });
  slotsWithScarcity.sort((a, b) => a.minOwnerSlots - b.minOwnerSlots);

  const raids: RaidGroup[] = [];
  const usedCharIds = new Set<string>();
  let globalBotCount = 0;
  let raidId = 1;

  // 1단계: 희소 소유주가 있는 슬롯에서 봇 허용하여 먼저 공격대 구성
  for (const { sg } of slotsWithScarcity) {
    const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
    const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));

    // 이 슬롯에 아직 참여하지 못한 희소 소유주가 있는지 확인
    const hasUnincludedScarceOwner = slotAvail.some(c => {
      const slotCnt = ownerSlotCount.get(c.owner_id) || 0;
      // 가용 슬롯이 3개 이하인 소유주
      return slotCnt <= 3 && !usedCharIds.has(c.id);
    });

    if (!hasUnincludedScarceOwner) continue;
    if (slotAvail.length < 2) continue;
    if (globalBotCount >= MAX_TOTAL_BOTS) break;

    const rem = MAX_TOTAL_BOTS - globalBotCount;
    const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(MAX_BOTS_NORMAL, rem), usedOwnersInSlot);
    if (!result) continue;
    raids.push(result.raid);
    globalBotCount += result.raid.botCount;
    for (const c of result.usedChars) usedCharIds.add(c.id);
    raidId++;
  }

  // 2단계: 나머지 슬롯에서 봇 포함하여 공격대 구성 (공격대당 최대 MAX_BOTS_NORMAL봇)
  for (const sg of slotGroups) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(MAX_BOTS_NORMAL, rem), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 3단계: 마지막 공격대 (최대 MAX_BOTS_LAST봇)
  if (globalBotCount < MAX_TOTAL_BOTS) {
    for (const sg of slotGroups) {
      if (globalBotCount >= MAX_TOTAL_BOTS) break;
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) continue;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(MAX_BOTS_LAST, rem), usedOwnersInSlot);
      if (!result) continue;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
      break;
    }
  }

  if (raids.length === 0) return null;

  const comp: RaidComposition = {
    raids: sortRaidsBotsLast(raids),
    excludedCharacters: getExcluded(allChars, usedCharIds),
    score: 0,
  };
  comp.score = scoreComposition(comp, raidType);
  return comp;
}

// 조합에서 스펙미달+봇이 같은 공격대에 있는지 체크
function hasUnderpoweredWithBot(comp: RaidComposition): boolean {
  for (const raid of comp.raids) {
    if (raid.botCount === 0) continue;
    const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
    const hasUnder = allMembers.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered);
    if (hasUnder) return true;
  }
  return false;
}

function filterSlotGroups(slotGroups: SlotGroup[], excludeIds: Set<string>): SlotGroup[] {
  return slotGroups.map(sg => ({
    slot: sg.slot,
    characters: sg.characters.filter(c => !excludeIds.has(c.id)),
  })).filter(sg => sg.characters.length > 0);
}

// 모든 전략으로 조합 생성
function generateCompositions(slotGroups: SlotGroup[], maxBots: number, raidType: RaidType = '루드라'): RaidComposition[] {
  const allResults: RaidComposition[] = [];

  const greedy = crossSlotComposition(slotGroups, maxBots, 'greedy', raidType);
  if (greedy) allResults.push(greedy);

  const balanced = crossSlotBalanced(slotGroups, maxBots, raidType);
  if (balanced) allResults.push(balanced);

  const timeOrdered = crossSlotComposition(slotGroups, maxBots, 'balanced', raidType);
  if (timeOrdered) allResults.push(timeOrdered);

  // 소유주 포함 우선 전략
  const inclusive = inclusiveComposition(slotGroups, maxBots, raidType);
  if (inclusive) allResults.push(inclusive);

  // 최대 공격대 수 전략 (다양한 seed)
  for (let seed = 0; seed < 1000; seed++) {
    const comp = maxRaidsComposition(slotGroups, maxBots, seed * 3571, raidType);
    if (comp) allResults.push(comp);
  }

  // 셔플 기반 다양한 조합 생성 (3000회)
  for (let seed = 1; seed <= 3000; seed++) {
    const comp = shuffledComposition(slotGroups, maxBots, seed * 7919, raidType);
    if (comp) allResults.push(comp);
  }

  // 각 조합에 잔여 인원 구제 단계 적용한 버전도 추가
  const rescuedResults: RaidComposition[] = [];
  for (const comp of allResults) {
    if (comp.excludedCharacters.length === 0) continue;
    // 기존 조합의 raids/usedCharIds 복원
    const usedIds = new Set<string>();
    for (const raid of comp.raids) {
      for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
        if (!('isBot' in m && m.isBot) && 'id' in m) {
          usedIds.add((m as any).id);
        }
      }
    }
    const rescued = applyRescue(comp.raids, usedIds, slotGroups, raidType);
    if (rescued.excludedCharacters.length < comp.excludedCharacters.length) {
      rescuedResults.push(rescued);
    }
  }
  allResults.push(...rescuedResults);

  return allResults;
}

// 미참여 소유주의 캐릭터를 기존 공격대에 스왑하여 포함시키는 후처리
function tryIncludeExcludedOwners(comp: RaidComposition, slotGroups: SlotGroup[], raidType: RaidType): RaidComposition {
  // 참여 중인 소유주 파악
  const participatingOwners = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...(raid.team2?.members || [])]) {
      if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
        participatingOwners.add((m as any).owner_id);
      }
    }
  }

  // 미참여 소유주의 제외 캐릭터 찾기
  const excludedByOwner = new Map<string, typeof comp.excludedCharacters>();
  for (const ex of comp.excludedCharacters) {
    if ('owner_id' in ex && !participatingOwners.has((ex as any).owner_id)) {
      const oid = (ex as any).owner_id;
      if (!excludedByOwner.has(oid)) excludedByOwner.set(oid, []);
      excludedByOwner.get(oid)!.push(ex);
    }
  }

  if (excludedByOwner.size === 0) return comp;

  // 미참여 소유주별로 가용한 시간대 파악
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

  // 깊은 복사
  const newComp: RaidComposition = JSON.parse(JSON.stringify(comp));
  let improved = false;

  for (const [excludedOwnerId, exChars] of excludedByOwner) {
    // 이 소유주가 참여할 수 있는 시간대의 공격대 찾기
    const availSlots = ownerSlots.get(excludedOwnerId) || [];
    // 스펙미달이 아닌 가장 강한 캐릭터 선택
    const bestChar = exChars
      .filter(c => !c.is_underpowered)
      .sort((a, b) => b.combat_power - a.combat_power)[0];
    if (!bestChar) continue;

    for (const raid of newComp.raids) {
      // 이 공격대의 시간대에 해당 소유주가 가용한지 확인
      const canJoin = availSlots.some(s =>
        s.date === raid.timeSlot.date &&
        s.start_time <= raid.timeSlot.start_time &&
        s.end_time >= raid.timeSlot.end_time
      );
      if (!canJoin) continue;

      // 이 소유주가 이미 이 공격대에 있는지 확인
      const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
      if (allMembers.some(m => 'owner_id' in m && (m as any).owner_id === excludedOwnerId)) continue;

      // 교체 대상 찾기: 동일 클래스의 멤버 중, 해당 소유주가 다른 공격대에도 캐릭터가 있는 경우
      // (교체해도 해당 소유주는 다른 곳에서 참여하므로 손실 없음)
      for (const team of [raid.team1, raid.team2].filter(Boolean) as Team[]) {
        for (let i = 0; i < team.members.length; i++) {
          const member = team.members[i];
          if ('isBot' in member && member.isBot) continue;
          if (!('owner_id' in member)) continue;
          const memberOwnerId = (member as any).owner_id;

          // 이 멤버의 소유주가 다른 공격대에도 참여하는지 확인
          const ownerInOtherRaids = newComp.raids.some(r => {
            if (r.id === raid.id) return false;
            return [...r.team1.members, ...(r.team2?.members || [])].some(
              m => 'owner_id' in m && (m as any).owner_id === memberOwnerId && !('isBot' in m && m.isBot)
            );
          });
          if (!ownerInOtherRaids) continue;

          // 클래스 호환성 체크: 교체 후에도 팀의 근딜/원딜/서포트 밸런스 유지
          const memberClass = member.class_type;
          const charClass = bestChar.class_type;

          // 같은 클래스면 바로 교체 가능
          // 다른 클래스면 밸런스 체크 필요
          if (memberClass !== charClass) {
            // 서포트 ↔ DPS 교체는 위험하므로 스킵
            const isSupport = (ct: string) => ct === '치유성' || ct === '호법성';
            if (isSupport(memberClass) !== isSupport(charClass)) continue;
            // DPS 간 교체 (근딜↔원딜): 팀에 해당 타입이 남아있는지 확인
            const othersOfType = team.members.filter((m, idx) => idx !== i && m.class_type === memberClass).length;
            if (othersOfType === 0) continue; // 마지막 근딜/원딜이면 교체 불가
          }

          // 호법성 중복 방지
          if (charClass === '호법성') {
            const teamTanks = team.members.filter((m, idx) => idx !== i && m.class_type === '호법성').length;
            if (teamTanks > 0) continue;
          }

          // 교체 실행
          const newMember: RaidMember = {
            ...bestChar,
            isBot: false,
            ownerName: bestChar.ownerName,
          } as any;
          const replacedMember = team.members[i];
          team.members[i] = newMember;

          // 제외 목록 업데이트: 교체된 캐릭터 추가, 삽입된 캐릭터 제거
          const newExcluded = newComp.excludedCharacters.filter(c => c.id !== bestChar.id);
          newExcluded.push({
            id: (replacedMember as any).id,
            owner_id: (replacedMember as any).owner_id,
            nickname: replacedMember.nickname,
            class_type: replacedMember.class_type,
            combat_power: replacedMember.combat_power,
            can_clear_raid: (replacedMember as any).can_clear_raid ?? false,
            is_underpowered: (replacedMember as any).is_underpowered ?? false,
            ownerName: (replacedMember as any).ownerName || '',
          });
          newComp.excludedCharacters = newExcluded;

          // 팀 평균 재계산
          team.avgCombatPower = calcTeamAvg(team.members);
          raid.avgCombatPower = raid.team2
            ? (raid.team1.avgCombatPower + raid.team2.avgCombatPower) / 2
            : raid.team1.avgCombatPower;

          improved = true;
          break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) continue;
    improved = false; // 다음 소유주 처리를 위해 리셋
  }

  newComp.score = scoreComposition(newComp, raidType);
  return newComp;
}

// 메인 솔버
export function solveRaidComposition(registrations: DBRegistration[], raidType: RaidType = '루드라', blockedOwnerSlots?: BlockedOwnerSlots): RaidComposition[] {
  if (registrations.length === 0) return [];
  void RAID_CONFIGS[raidType];

  const slotGroups = buildSlotGroups(registrations, blockedOwnerSlots);
  const maxBots = 4;
  let allResults = generateCompositions(slotGroups, maxBots, raidType);

  // 스펙미달+봇 동일 공격대 조합 필터링
  const cleanResults = allResults.filter(c => !hasUnderpoweredWithBot(c));

  if (cleanResults.length === 0 && allResults.length > 0) {
    const allChars = getAllUniqueChars(slotGroups);
    const underpoweredChars = allChars
      .filter(c => c.is_underpowered)
      .sort((a, b) => a.combat_power - b.combat_power);

    const excludeIds = new Set<string>();
    for (const underChar of underpoweredChars) {
      excludeIds.add(underChar.id);
      const filteredSlots = filterSlotGroups(slotGroups, excludeIds);
      if (filteredSlots.length === 0) continue;

      const retryResults = generateCompositions(filteredSlots, maxBots, raidType);
      const retryClean = retryResults.filter(c => !hasUnderpoweredWithBot(c));

      if (retryClean.length > 0) {
        const excludedUnders = underpoweredChars
          .filter(c => excludeIds.has(c.id))
          .map(c => ({
            id: c.id, owner_id: c.owner_id, nickname: c.nickname,
            class_type: c.class_type, combat_power: c.combat_power,
            can_clear_raid: c.can_clear_raid, is_underpowered: c.is_underpowered,
            ownerName: c.ownerName,
          }));

        for (const comp of retryClean) {
          comp.excludedCharacters = [...comp.excludedCharacters, ...excludedUnders];
          comp.score = scoreComposition(comp, raidType);
        }
        allResults = retryClean;
        break;
      }
    }

    if (allResults.every(c => hasUnderpoweredWithBot(c))) {
      // 원래 결과 유지
    }
  } else {
    allResults = cleanResults.length > 0 ? cleanResults : allResults;
  }

  // 미참여 소유주 캐릭터를 기존 공격대에 스왑 삽입하는 후처리
  allResults = allResults.map(comp => tryIncludeExcludedOwners(comp, slotGroups, raidType));

  // 중복 제거
  const seen = new Set<string>();
  const unique: RaidComposition[] = [];
  for (const comp of allResults) {
    const key = compositionKey(comp);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(comp);
    }
  }

  // 제외 인원 적은 순 우선, 동일 시 점수순 정렬
  unique.sort((a, b) => {
    const exDiff = a.excludedCharacters.length - b.excludedCharacters.length;
    if (exDiff !== 0) return exDiff;
    return a.score - b.score;
  });
  return unique.slice(0, 5);
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
    const uniqueSlots = new Map<string, TimeSlot>();
    for (const e of entries) {
      const key = `${e.slot.start_time}_${e.slot.end_time}`;
      uniqueSlots.set(key, e.slot);
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
