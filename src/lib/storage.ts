import { getSupabase, isSupabaseConfigured } from './supabase';
import type { DBRegistration, TimeSlot } from './types';

const STORAGE_KEY = 'raid-planner-registrations';

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

export function getWednesday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
  // 수요일(3)을 기준으로 해당 주의 수요일 찾기
  let diff: number;
  if (day >= 3) {
    diff = day - 3; // 수~토: 이번 주 수요일
  } else {
    diff = day + 4; // 일~화: 지난 주 수요일
  }
  d.setDate(d.getDate() - diff);
  return d;
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

// "mm월 n주차 dd일 (수)" 형식으로 주차 표기
export function formatWeekLabel(weekStartStr: string): string {
  const d = new Date(weekStartStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();

  // n주차: 해당 월에서 몇 번째 주인지 (수요일 기준)
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const firstWed = new Date(firstOfMonth);
  const fDay = firstOfMonth.getDay();
  const toWed = fDay <= 3 ? 3 - fDay : 7 - fDay + 3;
  firstWed.setDate(firstOfMonth.getDate() + toWed);

  let weekNum = 1;
  const tempWed = new Date(firstWed);
  while (tempWed < d) {
    tempWed.setDate(tempWed.getDate() + 7);
    weekNum++;
  }
  // d가 정확히 tempWed와 같으면 해당 주
  if (tempWed.getTime() !== d.getTime() && weekNum > 1) {
    // d가 firstWed 이전이면 이전 달의 마지막 주
  }

  return `${month}월 ${weekNum}주차 ${day}일 (수)`;
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
