import { getSupabase, isSupabaseConfigured } from './supabase';
import type { DBRegistration, TimeSlot, ConfirmedRaid, DBCharacterProfile, RaidType } from './types';
import { RAID_CONFIGS } from './types';

const STORAGE_KEY = 'raid-planner-registrations';
const CONFIRMED_KEY = 'raid-planner-confirmed';

function getLocalRegistrations(): DBRegistration[] {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveLocalRegistrations(registrations: DBRegistration[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
}

export async function saveRegistration(reg: DBRegistration): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('registrations').upsert(reg);
    if (error) throw error;
  } else {
    const regs = getLocalRegistrations();
    const idx = regs.findIndex(r => r.id === reg.id);
    if (idx >= 0) regs[idx] = reg;
    else regs.push(reg);
    saveLocalRegistrations(regs);
  }
}

export async function getRegistrationsByWeek(weekStart: string, raidType?: string): Promise<DBRegistration[]> {
  if (isSupabaseConfigured()) {
    let query = getSupabase()
      .from('registrations')
      .select('*')
      .eq('week_start', weekStart);
    if (raidType) query = query.eq('raid_type', raidType);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } else {
    let regs = getLocalRegistrations().filter(r => r.week_start === weekStart);
    if (raidType) regs = regs.filter(r => r.raid_type === raidType);
    return regs;
  }
}

export async function deleteRegistration(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('registrations').delete().eq('id', id);
    if (error) throw error;
  } else {
    const regs = getLocalRegistrations().filter(r => r.id !== id);
    saveLocalRegistrations(regs);
  }
}

export async function getAllRegistrations(): Promise<DBRegistration[]> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase().from('registrations').select('*');
    if (error) throw error;
    return data || [];
  } else {
    return getLocalRegistrations();
  }
}

export function subscribeToRegistrations(
  weekStart: string,
  callback: (registrations: DBRegistration[]) => void
) {
  if (!isSupabaseConfigured()) return () => {};

  const supabase = getSupabase();
  const channel = supabase
    .channel('registrations-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'registrations',
        filter: `week_start=eq.${weekStart}`,
      },
      async () => {
        const regs = await getRegistrationsByWeek(weekStart);
        callback(regs);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// === 확정 공대 관련 ===
function getLocalConfirmed(): ConfirmedRaid[] {
  const data = localStorage.getItem(CONFIRMED_KEY);
  return data ? JSON.parse(data) : [];
}

function saveLocalConfirmed(confirmed: ConfirmedRaid[]) {
  localStorage.setItem(CONFIRMED_KEY, JSON.stringify(confirmed));
}

export async function saveConfirmedRaid(confirmed: ConfirmedRaid): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('confirmed_raids').upsert(confirmed);
    if (error) throw error;
  } else {
    const all = getLocalConfirmed();
    const idx = all.findIndex(c => c.id === confirmed.id);
    if (idx >= 0) all[idx] = confirmed;
    else all.push(confirmed);
    saveLocalConfirmed(all);
  }
}

export async function getConfirmedRaid(weekStart: string, raidType: string): Promise<ConfirmedRaid | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase()
      .from('confirmed_raids')
      .select('*')
      .eq('week_start', weekStart)
      .eq('raid_type', raidType)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } else {
    const all = getLocalConfirmed();
    return all.find(c => c.week_start === weekStart && c.raid_type === raidType) || null;
  }
}

export async function deleteConfirmedRaid(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('confirmed_raids').delete().eq('id', id);
    if (error) throw error;
  } else {
    const all = getLocalConfirmed().filter(c => c.id !== id);
    saveLocalConfirmed(all);
  }
}

// === 캐릭터 프로필 관련 ===
const PROFILE_KEY = 'raid-planner-profiles';

function getLocalProfiles(): DBCharacterProfile[] {
  const data = localStorage.getItem(PROFILE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveLocalProfiles(profiles: DBCharacterProfile[]) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
}

export async function saveCharacterProfile(profile: DBCharacterProfile): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('character_profiles').upsert(profile);
    if (error) throw error;
  } else {
    const all = getLocalProfiles();
    const idx = all.findIndex(p => p.id === profile.id);
    if (idx >= 0) all[idx] = profile;
    else all.push(profile);
    saveLocalProfiles(all);
  }
}

export async function getCharacterProfiles(raidType?: string): Promise<DBCharacterProfile[]> {
  if (isSupabaseConfigured()) {
    let query = getSupabase().from('character_profiles').select('*');
    if (raidType) query = query.eq('raid_type', raidType);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } else {
    let profiles = getLocalProfiles();
    if (raidType) profiles = profiles.filter(p => p.raid_type === raidType);
    return profiles;
  }
}

export async function deleteCharacterProfile(id: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().from('character_profiles').delete().eq('id', id);
    if (error) throw error;
  } else {
    const all = getLocalProfiles().filter(p => p.id !== id);
    saveLocalProfiles(all);
  }
}

export function getWednesday(date: Date): Date {
  return getWeekStart(date, 3);
}

// resetDay 기준으로 주 시작일 구하기 (3=수, 4=목 등)
export function getWeekStart(date: Date, resetDay: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  let diff: number;
  if (day >= resetDay) {
    diff = day - resetDay;
  } else {
    diff = day + (7 - resetDay);
  }
  d.setDate(d.getDate() - diff);
  return d;
}

export function getWeekStartForRaid(date: Date, raidType: RaidType): Date {
  const config = RAID_CONFIGS[raidType];
  return getWeekStart(date, config.resetDay);
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export function getDayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    slots.push(`${h.toString().padStart(2, '0')}:30`);
  }
  return slots;
}

export function generateId(): string {
  return crypto.randomUUID();
}

// "mm월 n주차 dd일 (요일)" 형식으로 주차 표기
export function formatWeekLabel(weekStartStr: string, resetDay: number = 3): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];

  // n주차: 해당 월의 첫째 resetDay부터 카운트
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const fDay = firstOfMonth.getDay();
  const toResetDay = fDay <= resetDay ? resetDay - fDay : 7 - fDay + resetDay;
  const firstResetDay = new Date(firstOfMonth);
  firstResetDay.setDate(firstOfMonth.getDate() + toResetDay);

  let weekNum: number;
  if (d.getTime() < firstResetDay.getTime()) {
    const prevMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const pDay = prevMonth.getDay();
    const toResetDayP = pDay <= resetDay ? resetDay - pDay : 7 - pDay + resetDay;
    const firstResetDayPrev = new Date(prevMonth);
    firstResetDayPrev.setDate(prevMonth.getDate() + toResetDayP);
    weekNum = Math.floor((d.getTime() - firstResetDayPrev.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const prevMonthNum = prevMonth.getMonth() + 1;
    return `${prevMonthNum}월 ${weekNum}주차 ${day}일 (${dayName})`;
  } else {
    weekNum = Math.floor((d.getTime() - firstResetDay.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  }

  return `${month}월 ${weekNum}주차 ${day}일 (${dayName})`;
}

export function timeSlotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  if (a.date !== b.date) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

export function findCommonTimeSlot(slots: TimeSlot[][]): TimeSlot[] {
  if (slots.length === 0) return [];
  const allSlots = slots.flat();
  const grouped: Record<string, TimeSlot[]> = {};
  for (const slot of allSlots) {
    if (!grouped[slot.date]) grouped[slot.date] = [];
    grouped[slot.date].push(slot);
  }
  return Object.values(grouped).flat();
}
