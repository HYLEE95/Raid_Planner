import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getWednesday,
  formatDate,
  getRegistrationsByWeek,
  subscribeToRegistrations,
  deleteRegistration,
} from '../../lib/storage';
import { solveRaidComposition } from '../../lib/raidSolver';
import RaidResult from '../RaidResult/RaidResult';
import WeekPicker from '../WeekPicker/WeekPicker';
import type { DBRegistration, RaidComposition, RaidType } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

export default function Home() {
  const navigate = useNavigate();
  const [selectedWeek, setSelectedWeek] = useState(() => {
    return formatDate(getWednesday(new Date()));
  });
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
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

  useEffect(() => {
    if (!selectedRaid) return () => {};
    const unsubscribe = subscribeToRegistrations(selectedWeek, (regs) => {
      setRegistrations(regs.filter(r => r.raid_type === selectedRaid));
    });
    return unsubscribe;
  }, [selectedWeek, selectedRaid]);

  const [insufficientMsg, setInsufficientMsg] = useState('');

  const handleSolve = () => {
    if (!selectedRaid) return;
    setLoading(true);
    setInsufficientMsg('');
    setTimeout(() => {
      const results = solveRaidComposition(registrations, selectedRaid);
      setCompositions(results);
      if (results.length === 0 && registrations.length > 0) {
        setInsufficientMsg('인원이 부족하여 공격대 배치가 불가합니다.');
      }
      setLoading(false);
    }, 50);
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">공격대 구성</h1>

      {/* 레이드 선택 */}
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">레이드 선택</label>
        <div className="flex gap-2">
          {RAID_TYPES.map(rt => (
            <button
              key={rt}
              onClick={() => {
                setSelectedRaid(rt);
                setCompositions([]);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                selectedRaid === rt
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'
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
              <label className="block text-sm font-semibold text-gray-700 mb-2">주차 선택</label>
              <WeekPicker
                value={selectedWeek}
                onChange={(v) => {
                  setSelectedWeek(v);
                  setCompositions([]);
                }}
              />
            </div>
            <button
              onClick={() => { loadData(); }}
              className="px-3 py-2.5 rounded-lg font-semibold text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-1.5"
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
          </div>

          {/* 통계 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{registrations.length}</div>
              <div className="text-xs text-gray-500">신청자</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {registrations.reduce((s, r) => s + r.characters.length, 0)}
              </div>
              <div className="text-xs text-gray-500">캐릭터</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {compositions.length > 0 ? compositions[0].raids.length : 0}
              </div>
              <div className="text-xs text-gray-500">공격대</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{compositions.length}</div>
              <div className="text-xs text-gray-500">가능 조합</div>
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
                    className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                  >
                    <div>
                      <span className="font-medium text-gray-800">{reg.owner_name}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        캐릭터: {reg.characters.map(c => `${c.nickname}(${c.class_type}/${c.combat_power}K)`).join(', ')}
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
                  <p className="text-gray-400 text-sm">아직 신청자가 없습니다.</p>
                )}
              </div>
            )}
          </div>

          {/* 인원 부족 메시지 */}
          {insufficientMsg && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-center">
              <p className="text-red-700 font-semibold">{insufficientMsg}</p>
              <p className="text-sm text-red-500 mt-1">신청 인원을 추가하거나 시간대를 조정해주세요.</p>
            </div>
          )}

          {/* 결과 */}
          {loading ? (
            <div className="text-center py-12 text-gray-500">배치 중...</div>
          ) : (
            <RaidResult
              compositions={compositions}
              selectedIndex={0}
              onSelectIndex={() => {}}
            />
          )}
        </>
      )}
    </div>
  );
}
