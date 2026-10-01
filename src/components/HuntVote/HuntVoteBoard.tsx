import { useEffect, useMemo, useState } from 'react';
import { buildHeatmap, countAssignments, formatExtendedTime, heatmapKey, isAlreadyInSlot } from '../../lib/huntVote';
import type { HuntVoter } from '../../lib/huntVote';
import { formatDate, getWeekDates, getDayName, getConfirmedRaid, saveConfirmedRaid, generateId } from '../../lib/storage';
import type { ClassType, DBRegistration, HuntAssignment, HuntParty } from '../../lib/types';
import { isRaidComposition } from '../../lib/types';
import HuntHeatmap from './HuntHeatmap';
import type { SelectedCell } from './HuntHeatmap';
import HuntVoterList from './HuntVoterList';
import HuntPartyCard from './HuntPartyCard';

interface Props {
  registrations: DBRegistration[];
  weekStart: string;
}

export default function HuntVoteBoard({ registrations, weekStart }: Props) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const [assignment, setAssignment] = useState<HuntAssignment>({ slots: [] });
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [activePartyId, setActivePartyId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConfirmedRaid(weekStart, '정규사냥')
      .then(row => {
        if (cancelled) return;
        if (row && !isRaidComposition(row.composition)) {
          setConfirmedId(row.id);
          setAssignment(row.composition);
          setSavedAt(row.confirmed_at);
        } else {
          setConfirmedId(null);
          setAssignment({ slots: [] });
          setSavedAt(null);
        }
        setDirty(false);
        setActivePartyId(null);
      })
      .catch(err => console.error('정규 사냥 배정 로드 실패:', err));
    return () => { cancelled = true; };
  }, [weekStart]);

  const weekDates = useMemo(
    () => getWeekDates(new Date(weekStart + 'T00:00:00')),
    [weekStart]
  );
  const weekDateStrs = useMemo(() => weekDates.map(formatDate), [weekDates]);
  const heatmap = useMemo(
    () => buildHeatmap(registrations, weekDateStrs),
    [registrations, weekDateStrs]
  );

  const voters = selected ? heatmap.get(heatmapKey(selected.date, selected.start)) ?? [] : [];

  const selectedLabel = selected
    ? `${new Date(selected.date + 'T00:00:00').getMonth() + 1}/${new Date(selected.date + 'T00:00:00').getDate()}` +
      ` (${getDayName(new Date(selected.date + 'T00:00:00'))}) ${formatExtendedTime(selected.start)}`
    : '';

  const assignedCounts = useMemo(() => countAssignments(assignment), [assignment]);

  const slotParties: HuntParty[] = useMemo(() => {
    if (!selected) return [];
    return assignment.slots.find(s => s.date === selected.date && s.start_time === selected.start)?.parties ?? [];
  }, [assignment, selected]);

  /** 활성 파티. 슬롯을 옮기거나 파티를 지워 id가 사라지면 첫 파티로 되돌린다. */
  const activeId = slotParties.some(p => p.id === activePartyId)
    ? activePartyId
    : slotParties[0]?.id ?? null;

  const disabledNicknames = useMemo(() => {
    const set = new Set<string>();
    if (!selected) return set;
    for (const p of slotParties) for (const m of p.members) if (!m.isMercenary) set.add(m.nickname);
    return set;
  }, [slotParties, selected]);

  /** 선택된 슬롯의 파티 배열을 통째로 갈아끼운다. 비면 슬롯 자체를 지운다. */
  const updateSlotParties = (fn: (parties: HuntParty[]) => HuntParty[]) => {
    if (!selected) return;
    setAssignment(prev => {
      const idx = prev.slots.findIndex(s => s.date === selected.date && s.start_time === selected.start);
      const current = idx >= 0 ? prev.slots[idx].parties : [];
      const next = fn(current);
      const slots = [...prev.slots];
      if (idx >= 0) {
        if (next.length === 0) slots.splice(idx, 1);
        else slots[idx] = { ...slots[idx], parties: next };
      } else if (next.length > 0) {
        slots.push({ date: selected.date, start_time: selected.start, parties: next });
      }
      return { slots };
    });
    setDirty(true);
  };

  const addParty = () => {
    const id = generateId();
    updateSlotParties(ps => [...ps, { id, capacity: 4, members: [] }]);
    setActivePartyId(id);
  };

  const pickVoter = (v: HuntVoter) => {
    if (!selected) return;
    const targetId = activeId;
    if (!targetId) return;
    if (isAlreadyInSlot(assignment, selected.date, selected.start, v.nickname)) return;
    updateSlotParties(ps => ps.map(p => {
      if (p.id !== targetId) return p;
      if (p.members.length >= p.capacity) return p;
      return { ...p, members: [...p.members, { nickname: v.nickname, class_type: v.class_type, ownerName: v.ownerName }] };
    }));
  };

  const addMercenary = (partyId: string, nickname: string, cls: ClassType) => {
    updateSlotParties(ps => ps.map(p => {
      if (p.id !== partyId) return p;
      if (p.members.length >= p.capacity) return p;
      return { ...p, members: [...p.members, { nickname, class_type: cls, ownerName: '용병', isMercenary: true }] };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleaned: HuntAssignment = {
        slots: assignment.slots
          .map(s => ({ ...s, parties: s.parties.filter(p => p.members.length > 0) }))
          .filter(s => s.parties.length > 0),
      };
      const id = confirmedId ?? generateId();
      const now = new Date().toISOString();
      await saveConfirmedRaid({
        id,
        raid_type: '정규사냥',
        week_start: weekStart,
        composition: cleaned,
        confirmed_at: now,
      });
      setConfirmedId(id);
      setSavedAt(now);
      setDirty(false);
    } catch (err) {
      alert('저장 실패: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <HuntHeatmap
        heatmap={heatmap}
        weekDates={weekDates}
        selected={selected}
        onSelect={setSelected}
      />

      {selected && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {selectedLabel} 가능 인원 ({voters.length}명)
          </h2>
          <HuntVoterList
            voters={voters}
            assignedCounts={assignedCounts}
            disabled={disabledNicknames}
            onPick={slotParties.length > 0 ? pickVoter : undefined}
          />

          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold text-gray-700 dark:text-gray-300">파티 배정</h3>
              <button
                onClick={addParty}
                className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
              >
                + 파티 추가
              </button>
            </div>

            {slotParties.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                파티를 추가하면 위 명단에서 인원을 담을 수 있습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {slotParties.map((p, i) => (
                  <HuntPartyCard
                    key={p.id}
                    party={p}
                    index={i}
                    isActive={activeId === p.id}
                    onActivate={() => setActivePartyId(p.id)}
                    onCapacityChange={cap => updateSlotParties(ps => ps.map(x => (x.id === p.id ? { ...x, capacity: cap } : x)))}
                    onRemoveMember={mi => updateSlotParties(ps => ps.map(x => (x.id === p.id ? { ...x, members: x.members.filter((_, k) => k !== mi) } : x)))}
                    onRemoveParty={() => updateSlotParties(ps => ps.filter(x => x.id !== p.id))}
                    onAddMercenary={(nick, cls) => addMercenary(p.id, nick, cls)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="sticky bottom-16 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {dirty
            ? '저장하지 않은 변경이 있습니다.'
            : savedAt
              ? `마지막 저장 ${new Date(savedAt).toLocaleString('ko-KR')}`
              : '아직 저장된 배정이 없습니다.'}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`px-5 py-2 rounded-lg font-semibold text-white transition-colors ${
            dirty && !saving ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? '저장 중...' : '배정 저장'}
        </button>
      </div>
    </div>
  );
}
