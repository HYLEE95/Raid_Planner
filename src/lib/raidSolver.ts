import type {
  DBRegistration,
  RaidComposition,
  RaidGroup,
  RaidMember,
  Team,
  BotCharacter,
  ClassType,
  TimeSlot,
} from './types';

// 크로스 레이드 소유주 차단 슬롯 (owner_name -> TimeSlot[])
export type BlockedOwnerSlots = Map<string, TimeSlot[]>;

// ==========================================
// 공통 유틸
// ==========================================

const RAID_DURATION = 60; // 레이드 1시간 (분)

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
// 팀 평균 전투력 계산
// ==========================================

export function calcTeamAvg(members: RaidMember[]): number {
  if (members.length === 0) return 0;
  return members.reduce((s, m) => s + m.combat_power, 0) / members.length;
}

// ==========================================
// 봇 생성
// ==========================================

function createBot(classType: ClassType, combatPower: number, idx: number): BotCharacter {
  return { isBot: true, nickname: `공방인원${idx}`, class_type: classType, combat_power: combatPower };
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
