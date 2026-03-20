import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getWeekStartForRaid,
  formatDate,
  getRegistrationsByWeek,
  subscribeToRegistrations,
  deleteRegistration,
  saveConfirmedRaid,
  getConfirmedRaid,
  getAllConfirmedRaids,
  generateId,
} from '../../lib/storage';
import { solveRaidComposition, solveBriRaidComposition } from '../../lib/raidSolver';
import type { BlockedOwnerSlots } from '../../lib/raidSolver';
import RaidResult from '../RaidResult/RaidResult';
import WeekPicker from '../WeekPicker/WeekPicker';
import type { DBRegistration, RaidComposition, RaidType } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

const COMP_STORAGE_KEY = 'raid-planner-compositions';

function saveComps(raidType: string, weekStart: string, comps: RaidComposition[]) {
  localStorage.setItem(`${COMP_STORAGE_KEY}-${raidType}-${weekStart}`, JSON.stringify(comps));
}

function loadComps(raidType: string, weekStart: string): RaidComposition[] {
  const data = localStorage.getItem(`${COMP_STORAGE_KEY}-${raidType}-${weekStart}`);
  return data ? JSON.parse(data) : [];
}

function clearComps(raidType: string, weekStart: string) {
  localStorage.removeItem(`${COMP_STORAGE_KEY}-${raidType}-${weekStart}`);
}

export default function Home() {
  const navigate = useNavigate();
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    return formatDate(getWeekStartForRaid(new Date(), '루드라'));
  });
  const [registrations, setRegistrations] = useState<DBRegistration[]>([]);
  const [compositions, setCompositions] = useState<RaidComposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRegistrations, setShowRegistrations] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedRaid) { setRegistrations([]); return; }
    try {
      const regs = await getRegistrationsByWeek(selectedWeek, selectedRaid);
      setRegistrations(regs);
    } catch (err) {
      console.error('데이터 로드 실패:', err);
    }
  }, [selectedWeek, selectedRaid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 레이드/주차 변경 시 저장된 조합 로드
  useEffect(() => {
    if (!selectedRaid) { setCompositions([]); return; }
    const stored = loadComps(selectedRaid, selectedWeek);
    setCompositions(stored);
  }, [selectedRaid, selectedWeek]);

  useEffect(() => {
    if (!selectedRaid) return () => {};
    const unsubscribe = subscribeToRegistrations(selectedWeek, (regs) => {
      setRegistrations(regs.filter(r => r.raid_type === selectedRaid));
    });
    return unsubscribe;
  }, [selectedWeek, selectedRaid]);

  const [insufficientMsg, setInsufficientMsg] = useState('');

  const handleSolve = async () => {
    if (!selectedRaid) return;
    setLoading(true);
    setInsufficientMsg('');

    try {
      // 크로스 레이드 충돌 방지: 다른 레이드의 확정된 소유주 시간대 로드
      const allConfirmed = await getAllConfirmedRaids();
      const otherConfirmed = allConfirmed.filter(c => c.raid_type !== selectedRaid);

      const blockedOwnerSlots: BlockedOwnerSlots = new Map();
      for (const confirmed of otherConfirmed) {
        for (const raid of confirmed.composition.raids) {
          const allMembers = [...raid.team1.members, ...(raid.team2?.members || [])];
          for (const m of allMembers) {
            if ('isBot' in m && m.isBot) continue;
            if (!('ownerName' in m)) continue;
            const ownerName = (m as any).ownerName as string;
            if (!blockedOwnerSlots.has(ownerName)) blockedOwnerSlots.set(ownerName, []);
            blockedOwnerSlots.get(ownerName)!.push(raid.timeSlot);
          }
        }
      }

      const results = selectedRaid === '브리레흐'
        ? solveBriRaidComposition(registrations, blockedOwnerSlots)
        : solveRaidComposition(registrations, selectedRaid, blockedOwnerSlots);
      setCompositions(results);
      saveComps(selectedRaid, selectedWeek, results);
      if (results.length === 0 && registrations.length > 0) {
        setInsufficientMsg('인원이 부족하여 공격대 배치가 불가합니다.');
      }
    } catch (err) {
      console.error('배치 실패:', err);
      setInsufficientMsg('배치 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (comp: RaidComposition) => {
    if (!selectedRaid) return;
    try {
      const existing = await getConfirmedRaid(selectedWeek, selectedRaid);
      if (existing) {
        alert('이미 확정된 공격대가 있습니다. 홈에서 기존 공대를 삭제한 후 다시 확정해주세요.');
        return;
      }
      await saveConfirmedRaid({
        id: generateId(),
        raid_type: selectedRaid,
        week_start: selectedWeek,
        composition: comp,
        confirmed_at: new Date().toISOString(),
      });
      alert('공격대가 확정되었습니다!');
    } catch (err) {
      alert('확정 실패: ' + (err as Error).message);
    }
  };

  const handleUpdateCompositions = (comps: RaidComposition[]) => {
    if (!selectedRaid) return;
    setCompositions(comps);
    saveComps(selectedRaid, selectedWeek, comps);
  };

  const handleEdit = (reg: DBRegistration) => {
    navigate('/register', { state: { editRegistration: reg } });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 신청을 삭제하시겠습니까?')) return;
    await deleteRegistration(id);
    loadData();
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">공격대 배치</h1>

      {/* 레이드 선택 */}
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">레이드 선택</label>
        <div className="flex gap-2">
          {RAID_TYPES.map(rt => (
            <button
              key={rt}
              onClick={() => {
                setSelectedRaid(rt);
                setSelectedWeek(formatDate(getWeekStartForRaid(new Date(), rt)));
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                selectedRaid === rt
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-300'
              }`}
            >
              {RAID_CONFIGS[rt].label}
            </button>
          ))}
        </div>
      </div>

      {/* 레이드 선택 후에만 하위 콘텐츠 표시 */}
      {selectedRaid && (
        <>
          {/* 주차 선택 + 배치 버튼 */}
          <div className="mb-6 flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">주차 선택</label>
              <WeekPicker
                value={selectedWeek}
                onChange={(v) => {
                  setSelectedWeek(v);
                }}
                resetDay={RAID_CONFIGS[selectedRaid].resetDay}
              />
            </div>
            <button
              onClick={() => { loadData(); }}
              className="px-3 py-2.5 rounded-lg font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 transition-colors flex items-center gap-1.5"
              title="새로고침"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.636 19.364A9 9 0 1020.364 4.636M18.364 4.636A9 9 0 103.636 19.364" />
              </svg>
              새로고침
            </button>
            <button
              onClick={handleSolve}
              disabled={registrations.length === 0}
              className={`px-5 py-2.5 rounded-lg font-semibold text-white transition-colors flex items-center gap-2 ${
                registrations.length > 0
                  ? 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
                  : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
              공격대 배치
            </button>
            {compositions.length > 0 && (
              <button
                onClick={() => {
                  setCompositions([]);
                  setInsufficientMsg('');
                  if (selectedRaid) clearComps(selectedRaid, selectedWeek);
                }}
                className="px-3 py-2.5 rounded-lg font-semibold text-red-600 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 active:bg-red-100 transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                배치 초기화
              </button>
            )}
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{registrations.length}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">신청자</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {registrations.reduce((s, r) => s + r.characters.length, 0)}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">캐릭터</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {compositions.length > 0 ? compositions[0].raids.length : 0}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">공격대</div>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{compositions.length}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">가능 조합</div>
            </div>
          </div>

          {/* 신청자 목록 */}
          <div className="mb-6">
            <button
              onClick={() => setShowRegistrations(!showRegistrations)}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {showRegistrations ? '신청자 목록 숨기기' : '신청자 목록 보기'} ({registrations.length}명|{registrations.reduce((s, r) => s + r.characters.length, 0)}캐릭)
            </button>

            {showRegistrations && (
              <div className="mt-3 space-y-2">
                {registrations.map(reg => (
                  <div
                    key={reg.id}
                    className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <div>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{reg.owner_name}</span>
                      <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">
                        캐릭터: {reg.characters.map((c, ci) => (
                          <span key={ci}>
                            {ci > 0 && ', '}
                            {selectedRaid === '브리레흐'
                              ? `${c.nickname}(${c.class_type})`
                              : `${c.nickname}(${c.class_type}/${c.combat_power}K)`}
                            {selectedRaid === '브리레흐' && c.has_destruction_robe && (
                              <span className="ml-1 px-1 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 text-[10px] rounded border border-purple-200 dark:border-purple-700">파롭</span>
                            )}
                            {selectedRaid === '브리레흐' && c.is_blast_lancer && (
                              <span className="ml-1 px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 text-[10px] rounded border border-blue-200 dark:border-blue-700">블랜</span>
                            )}
                            {selectedRaid === '브리레흐' && c.has_soul_weapon && (
                              <span className="ml-1 px-1 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 text-[10px] rounded border border-amber-200 dark:border-amber-700">소울</span>
                            )}
                          </span>
                        ))}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleEdit(reg)}
                        className="text-indigo-500 text-sm hover:text-indigo-700"
                      >
                        수정
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => handleDelete(reg.id)}
                        className="text-red-500 text-sm hover:text-red-700"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
                {registrations.length === 0 && (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">아직 신청자가 없습니다.</p>
                )}
              </div>
            )}
          </div>

          {/* 인원 부족 메시지 */}
          {insufficientMsg && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-center">
              <p className="text-red-700 dark:text-red-300 font-semibold">{insufficientMsg}</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">신청 인원을 추가하거나 시간대를 조정해주세요.</p>
            </div>
          )}

          {/* 결과 */}
          {loading ? (
            <div className="text-center py-12 text-gray-600 dark:text-gray-400">배치 중...</div>
          ) : (
            <RaidResult
              compositions={compositions}
              selectedIndex={0}
              onSelectIndex={() => {}}
              onConfirm={handleConfirm}
              onUpdate={handleUpdateCompositions}
              raidType={selectedRaid}
              weekStart={selectedWeek}
              registrations={registrations}
            />
          )}
        </>
      )}
    </div>
  );
}
