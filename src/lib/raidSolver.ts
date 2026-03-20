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

// 시간대별 가용 캐릭터 그룹핑
function buildSlotGroups(registrations: DBRegistration[]): SlotGroup[] {
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
          for (const char of e.reg.characters) {
            const charId = `${e.reg.id}_${char.nickname}`;
            if (!chars.find(c => c.id === charId)) {
              chars.push({
                id: charId,
                owner_id: e.reg.id,
                ownerName: e.reg.owner_name,
                nickname: char.nickname,
                class_type: char.class_type,
                combat_power: char.combat_power,
                can_clear_raid: char.can_clear_raid,
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
function calcTeamAvg(members: RaidMember[]): number {
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

const MAX_TOTAL_BOTS = 5;

function scoreComposition(comp: RaidComposition, raidType: RaidType = '루드라'): number {
  let score = 0;
  const totalBots = comp.raids.reduce((sum, r) => sum + r.botCount, 0);

  // 최우선: 제외 인원 최소화
  score += comp.excludedCharacters.length * 10000;

  // 전체 봇 5개 초과 시 큰 패널티
  if (totalBots > MAX_TOTAL_BOTS) score += (totalBots - MAX_TOTAL_BOTS) * 8000;

  // 봇 수 패널티
  score += totalBots * 500;

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
    allTeamAvgs.push(raid.team1.avgCombatPower, raid.team2.avgCombatPower);
    const teamDiff = Math.abs(raid.team1.avgCombatPower - raid.team2.avgCombatPower);
    score += teamDiff * 20;
  }
  if (allTeamAvgs.length > 1) {
    const teamMean = allTeamAvgs.reduce((a, b) => a + b, 0) / allTeamAvgs.length;
    const teamVar = allTeamAvgs.reduce((s, v) => s + (v - teamMean) ** 2, 0) / allTeamAvgs.length;
    score += Math.sqrt(teamVar) * 20;
  }

  // 근딜 없는 팀 패널티
  for (const raid of comp.raids) {
    if (!raid.team1.members.some(m => m.class_type === '근딜')) score += 200;
    if (!raid.team2.members.some(m => m.class_type === '근딜')) score += 200;
  }

  // 서포트 과다 팀 패널티 (되도록 한 파티에 여러 서포트 비선호)
  for (const raid of comp.raids) {
    const t1Support = countSupportInTeam(raid.team1.members);
    const t2Support = countSupportInTeam(raid.team2.members);
    if (t1Support > 1) score += (t1Support - 1) * 300;
    if (t2Support > 1) score += (t2Support - 1) * 300;

    // 서포트 2명 이상이 한 팀에 들어가야 하는 경우, 양 팀 모두 치유성 선호
    const totalSupport = t1Support + t2Support;
    if (totalSupport >= 3) {
      const t1Healers = raid.team1.members.filter(m => m.class_type === '치유성').length;
      const t2Healers = raid.team2.members.filter(m => m.class_type === '치유성').length;
      // 양 팀 모두 치유성이 있으면 보너스 (패널티 감소)
      if (t1Healers >= 1 && t2Healers >= 1) score -= 150;
      // 한 쪽에만 치유성이 몰려 있으면 패널티
      if (t1Healers === 0 || t2Healers === 0) score += 200;
    }
  }

  // 전투력이 강한 딜러는 호법성과 같은 팀에 있으면 보너스
  for (const raid of comp.raids) {
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
    const allMembers = [...raid.team1.members, ...raid.team2.members];
    const hasUnder = allMembers.some(m => !('isBot' in m && m.isBot) && 'is_underpowered' in m && (m as any).is_underpowered);
    if (hasUnder) score += 30000;
  }

  // 봇이 마지막 공격대가 아닌 곳에 있으면 큰 패널티
  for (let i = 0; i < comp.raids.length - 1; i++) {
    if (comp.raids[i].botCount > 0) score += 5000;
  }

  // 2파티 전투력이 1파티보다 높아야 함
  for (const raid of comp.raids) {
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
      if (raid.team2.avgCombatPower < 160 && raid.botCount === 0) {
        score += (160 - raid.team2.avgCombatPower) * 50;
      }
    }
  }

  // 소유주별 참여 여부: 한번도 참여 못한 소유주가 있으면 큰 패널티
  const participatingOwners = new Set<string>();
  for (const raid of comp.raids) {
    for (const m of [...raid.team1.members, ...raid.team2.members]) {
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
      score += 15000; // 한번도 참여 못한 소유주 큰 패널티
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
    const t2 = r.team2.members.map(m => m.nickname).sort().join(',');
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

  // 나머지 배치 (DPS 우선, 전투력 균형 기반)
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
      // 2파티 전투력이 1파티보다 높도록 배치
      if (teamDpsSum(team2Members) <= teamDpsSum(team1Members)) {
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

  // DPS 부족 시 남은 서포트 캐릭터로 빈 자리 채우기
  // Team1: 치유성/호법성 모두 가능, Team2: 치유성만 가능 (호법성 불가)
  const remainingSupports = eligible
    .filter(c => !usedChars.find(u => u.id === c.id) && !isOwnerInRaid(c.owner_id) && (c.class_type === '치유성' || c.class_type === '호법성'))
    .sort((a, b) => b.combat_power - a.combat_power);

  for (const char of remainingSupports) {
    if (team1Members.length >= 4 && team2Members.length >= 4) break;
    if (isOwnerInRaid(char.owner_id)) continue;

    const can1 = team1Members.length < 4;
    const can2 = team2Members.length < 4 && char.class_type !== '호법성';

    if (can1 && can2) {
      const t1Support = countSupportInTeam(team1Members);
      const t2Support = countSupportInTeam(team2Members);
      const t1Healers = team1Members.filter(m => m.class_type === '치유성').length;
      const t2Healers = team2Members.filter(m => m.class_type === '치유성').length;

      if (char.class_type === '치유성') {
        // 치유성: 양 팀에 치유성이 없는 팀 우선 배치
        if (t1Healers === 0 && t2Healers > 0) {
          addToTeam(team1Members, char);
        } else if (t2Healers === 0 && t1Healers > 0) {
          addToTeam(team2Members, char);
        } else if (t1Support <= t2Support) {
          addToTeam(team1Members, char);
        } else {
          addToTeam(team2Members, char);
        }
      } else {
        // 호법성: 서포트가 적은 팀에 배치
        if (t1Support <= t2Support) {
          addToTeam(team1Members, char);
        } else {
          addToTeam(team2Members, char);
        }
      }
    } else if (can1) {
      addToTeam(team1Members, char);
    } else if (can2) {
      addToTeam(team2Members, char);
    }
  }

  // 봇 채우기
  const botPower = getBotCombatPower(usedChars);

  while (team1Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team1Members.some(m => m.class_type === '근딜');
    team1Members.push(createBot(needMelee ? '근딜' : '원딜', botPower, ++botCount));
  }
  while (team2Members.length < 4 && botCount < maxBotsPerRaid) {
    const needMelee = !team2Members.some(m => m.class_type === '근딜');
    team2Members.push(createBot(needMelee ? '근딜' : '원딜', botPower, ++botCount));
  }

  if (team1Members.length < 4 || team2Members.length < 4) return null;
  // 서포트 최소 요건: Team1에 최소 1명 서포트, Team2에 최소 1명 치유성 + 호법성 0명
  if (countSupportInTeam(team1Members) < 1) return null;
  const team2Healers = team2Members.filter(m => m.class_type === '치유성').length;
  const team2Tanks = team2Members.filter(m => m.class_type === '호법성').length;
  if (team2Healers < 1 || team2Tanks !== 0) return null;

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
      const t1Idx = team1Members.indexOf(t1Dps[si]);
      const t2Idx = team2Members.indexOf(t2Dps[sj]);
      [team1Members[t1Idx], team2Members[t2Idx]] = [team2Members[t2Idx], team1Members[t1Idx]];
    }
  }

  const team1: Team = { members: team1Members, avgCombatPower: calcTeamAvg(team1Members) };
  const team2: Team = { members: team2Members, avgCombatPower: calcTeamAvg(team2Members) };

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
      for (const m of [...raid.team1.members, ...raid.team2.members]) {
        if (!('isBot' in m && m.isBot) && 'owner_id' in m) {
          owners.add((m as any).owner_id);
        }
      }
    }
  }
  return owners;
}

// === 크로스-시간대 스케줄링 ===
function crossSlotComposition(
  slotGroups: SlotGroup[],
  maxBotsPerRaid: number,
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

  // 1단계: 봇 없이
  const sortedSlots = getSlotOrder();
  for (const sg of sortedSlots) {
    while (true) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 봇 포함
  const sortedSlots2 = getSlotOrder();
  for (const sg of sortedSlots2) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(maxBotsPerRaid, remainingBots), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
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
function crossSlotBalanced(slotGroups: SlotGroup[], maxBots: number, raidType: RaidType = '루드라'): RaidComposition | null {
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

  // 2단계: 봇 포함
  for (const sg of slotGroups) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot2 = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot2.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(maxBots, rem), usedOwnersInSlot2);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
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
  maxBotsPerRaid: number,
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

  // 1단계: 봇 없이
  for (const sg of orderedSlots) {
    while (true) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 봇 포함
  for (const sg of orderedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const remainingBots = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(maxBotsPerRaid, remainingBots), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
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
  maxBotsPerRaid: number,
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

  // 1단계: 봇 없이
  for (const sg of orderedSlots) {
    while (true) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 2단계: 봇 포함
  for (const sg of orderedSlots) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, Math.min(maxBotsPerRaid, rem), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
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
  maxBotsPerRaid: number,
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
    const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(maxBotsPerRaid, rem), usedOwnersInSlot);
    if (!result) continue;
    raids.push(result.raid);
    globalBotCount += result.raid.botCount;
    for (const c of result.usedChars) usedCharIds.add(c.id);
    raidId++;
  }

  // 2단계: 나머지 슬롯에서 봇 없이 공격대 구성
  for (const sg of slotGroups) {
    while (true) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, 0, 0, usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
    }
  }

  // 3단계: 남은 슬롯에서 봇 포함
  for (const sg of slotGroups) {
    if (globalBotCount >= MAX_TOTAL_BOTS) break;
    while (globalBotCount < MAX_TOTAL_BOTS) {
      const usedOwnersInSlot = getOwnersInOverlappingRaids(raids, sg.slot);
      const slotAvail = sg.characters.filter(c => !usedCharIds.has(c.id) && !usedOwnersInSlot.has(c.owner_id));
      if (slotAvail.length < 2) break;
      const rem = MAX_TOTAL_BOTS - globalBotCount;
      const result = tryFormRaid(sg.characters, usedCharIds, sg.slot, raidId, globalBotCount, Math.min(maxBotsPerRaid, rem), usedOwnersInSlot);
      if (!result) break;
      raids.push(result.raid);
      globalBotCount += result.raid.botCount;
      for (const c of result.usedChars) usedCharIds.add(c.id);
      raidId++;
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
    const allMembers = [...raid.team1.members, ...raid.team2.members];
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
  for (let seed = 0; seed < 30; seed++) {
    const comp = maxRaidsComposition(slotGroups, maxBots, seed * 3571, raidType);
    if (comp) allResults.push(comp);
  }

  // 셔플 기반 다양한 조합 생성 (50회)
  for (let seed = 1; seed <= 50; seed++) {
    const comp = shuffledComposition(slotGroups, maxBots, seed * 7919, raidType);
    if (comp) allResults.push(comp);
  }

  return allResults;
}

// 메인 솔버
export function solveRaidComposition(registrations: DBRegistration[], raidType: RaidType = '루드라'): RaidComposition[] {
  if (registrations.length === 0) return [];
  void RAID_CONFIGS[raidType];

  const slotGroups = buildSlotGroups(registrations);
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

  // 제외 인원 적은 순 → 점수순 정렬
  unique.sort((a, b) => {
    const exDiff = a.excludedCharacters.length - b.excludedCharacters.length;
    if (exDiff !== 0) return exDiff;
    return a.score - b.score;
  });
  return unique.slice(0, 4);
}
