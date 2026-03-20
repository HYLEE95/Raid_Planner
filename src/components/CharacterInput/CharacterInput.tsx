import { useState, useEffect } from 'react';
import {
  generateId,
  saveCharacterProfile,
  getCharacterProfiles,
  deleteCharacterProfile,
  getAllRegistrations,
  saveRegistration,
} from '../../lib/storage';
import type { ClassType, DBCharacterProfile, RaidType } from '../../lib/types';
import { RAID_TYPES, RAID_CONFIGS } from '../../lib/types';

const CLASS_TYPES: ClassType[] = ['근딜', '원딜', '호법성', '치유성'];

const CLASS_COLORS: Record<ClassType, string> = {
  '근딜': 'bg-red-100 text-red-800 border-red-300',
  '원딜': 'bg-blue-100 text-blue-800 border-blue-300',
  '호법성': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  '치유성': 'bg-green-100 text-green-800 border-green-300',
};

interface CharacterForm {
  nickname: string;
  class_type: ClassType;
  combat_power: number;
  can_clear_raid: boolean;
  is_underpowered: boolean;
}

type Mode = null | 'input' | 'edit';

export default function CharacterInput() {
  const [selectedRaid, setSelectedRaid] = useState<RaidType | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [ownerName, setOwnerName] = useState('');
  const [characters, setCharacters] = useState<CharacterForm[]>([
    { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false },
  ]);
  const [profiles, setProfiles] = useState<DBCharacterProfile[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!selectedRaid) { setProfiles([]); return; }
    loadProfiles();
    setMode(null);
    resetForm();
  }, [selectedRaid]);

  const loadProfiles = async () => {
    if (!selectedRaid) return;
    const data = await getCharacterProfiles(selectedRaid);
    setProfiles(data);
  };

  const addCharacter = () => {
    setCharacters([
      ...characters,
      { nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false },
    ]);
  };

  const removeCharacter = (idx: number) => {
    if (characters.length <= 1) return;
    setCharacters(characters.filter((_, i) => i !== idx));
  };

  const updateCharacter = (idx: number, field: keyof CharacterForm, value: any) => {
    const updated = [...characters];
    (updated[idx] as any)[field] = value;
    if (field === 'can_clear_raid' && value === true) updated[idx].is_underpowered = false;
    if (field === 'is_underpowered' && value === true) updated[idx].can_clear_raid = false;
    if (field === 'class_type' && (value === '치유성' || value === '호법성')) {
      updated[idx].can_clear_raid = false;
      updated[idx].is_underpowered = false;
    }
    setCharacters(updated);
  };

  const isValid = () => {
    if (!selectedRaid) return false;
    if (!ownerName.trim()) return false;
    if (characters.some(c => !c.nickname.trim() || c.combat_power <= 0)) return false;
    const nicknames = characters.map(c => c.nickname.trim());
    if (new Set(nicknames).size !== nicknames.length) return false;
    return true;
  };

  const handleSubmit = async () => {
    if (!isValid()) return;
    setSaving(true);
    try {
      const profile: DBCharacterProfile = {
        id: editId || generateId(),
        owner_name: ownerName.trim(),
        raid_type: selectedRaid!,
        characters: characters.map(c => ({
          nickname: c.nickname.trim(),
          class_type: c.class_type,
          combat_power: c.combat_power,
          can_clear_raid: c.can_clear_raid,
          is_underpowered: c.is_underpowered,
        })),
        created_at: new Date().toISOString(),
      };
      await saveCharacterProfile(profile);

      // 기존 신청 데이터에도 캐릭터 정보 동기화
      try {
        const allRegs = await getAllRegistrations();
        const ownerRegs = allRegs.filter(
          r => r.owner_name === ownerName.trim() && r.raid_type === selectedRaid!
        );
        for (const reg of ownerRegs) {
          const updatedChars = reg.characters.map(rc => {
            const updated = profile.characters.find(pc => pc.nickname === rc.nickname);
            return updated ? { ...rc, ...updated } : rc;
          });
          await saveRegistration({ ...reg, characters: updatedChars });
        }
      } catch (syncErr) {
        console.error('신청 데이터 동기화 실패:', syncErr);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      resetForm();
      setMode(null);
      loadProfiles();
    } catch (err) {
      alert('저장 실패: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditId(null);
    setOwnerName('');
    setCharacters([{ nickname: '', class_type: '근딜', combat_power: 0, can_clear_raid: false, is_underpowered: false }]);
  };

  const handleEdit = (profile: DBCharacterProfile) => {
    setMode('edit');
    setEditId(profile.id);
    setOwnerName(profile.owner_name);
    setCharacters(profile.characters.map(c => ({
      nickname: c.nickname,
      class_type: c.class_type,
      combat_power: c.combat_power,
      can_clear_raid: c.can_clear_raid,
      is_underpowered: c.is_underpowered ?? false,
    })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 캐릭터 프로필을 삭제하시겠습니까?')) return;
    await deleteCharacterProfile(id);
    loadProfiles();
  };

  const handleStartInput = () => {
    setMode('input');
    resetForm();
  };

  const handleStartEdit = () => {
    if (profiles.length === 0) {
      alert('수정할 소유주가 없습니다. 먼저 캐릭터 정보를 입력해주세요.');
      return;
    }
    setMode('edit');
    resetForm();
  };

  const handleCancel = () => {
    setMode(null);
    resetForm();
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">캐릭터 정보 입력</h1>

      {saved && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded-lg border border-green-300">
          저장되었습니다!
        </div>
      )}

      {/* 레이드 선택 */}
      <section className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">레이드 선택</label>
        <div className="flex gap-2">
          {RAID_TYPES.map(rt => (
            <button
              key={rt}
              onClick={() => { setSelectedRaid(rt); }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                selectedRaid === rt
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-300'
              }`}
            >
              {RAID_CONFIGS[rt].label}
            </button>
          ))}
        </div>
      </section>

      {selectedRaid && (<>
        {/* 입력/수정 모드 선택 버튼 */}
        {mode === null && (
          <section className="mb-6">
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={handleStartInput}
                className="flex-1 min-w-[140px] py-3 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                캐릭터 정보 입력
              </button>
              <button
                onClick={handleStartEdit}
                className="flex-1 min-w-[140px] py-3 rounded-lg font-semibold text-indigo-600 bg-white dark:bg-gray-800 border-2 border-indigo-300 hover:bg-indigo-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                캐릭터 정보 수정
              </button>
            </div>
          </section>
        )}

        {/* 입력/수정 폼 */}
        {mode !== null && (
          <>
            {/* 모드 표시 */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">
                {mode === 'input' ? '새 캐릭터 정보 입력' : editId ? `${ownerName} 수정 중` : '수정할 소유주 선택'}
              </h2>
              <button
                onClick={handleCancel}
                className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                취소
              </button>
            </div>

            {/* 수정 모드: 소유주 선택 목록 (editId가 없을 때) */}
            {mode === 'edit' && !editId && (
              <section className="mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">수정할 소유주를 선택하세요.</p>
                <div className="space-y-2">
                  {profiles.map(p => (
                    <div
                      key={p.id}
                      onClick={() => handleEdit(p)}
                      className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{p.owner_name}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                          {p.characters.map(c => `${c.nickname}(${c.class_type}/${c.combat_power}K)`).join(', ')}
                        </span>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 입력 모드이거나, 수정 모드에서 소유주 선택됨 */}
            {(mode === 'input' || (mode === 'edit' && editId)) && (
              <>
                {/* 소유주 이름 */}
                <section className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">소유주 이름</label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    placeholder="소유주 이름을 입력하세요"
                    disabled={mode === 'edit'}
                    className={`w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${mode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                </section>

                {/* 캐릭터 목록 */}
                <section className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">캐릭터 정보</h2>
                    <button
                      onClick={addCharacter}
                      className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
                    >
                      + 캐릭터 추가
                    </button>
                  </div>

                  <div className="space-y-3">
                    {characters.map((char, idx) => (
                      <div key={idx} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">캐릭터 {idx + 1}</span>
                          {characters.length > 1 && (
                            <button onClick={() => removeCharacter(idx)} className="text-red-500 text-sm hover:text-red-700">삭제</button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">닉네임</label>
                            <input
                              type="text"
                              value={char.nickname}
                              onChange={e => updateCharacter(idx, 'nickname', e.target.value)}
                              placeholder="캐릭터 닉네임"
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">직업군</label>
                            <div className="flex gap-1 flex-wrap">
                              {CLASS_TYPES.map(ct => (
                                <button
                                  key={ct}
                                  onClick={() => updateCharacter(idx, 'class_type', ct)}
                                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                                    char.class_type === ct
                                      ? CLASS_COLORS[ct] + ' font-bold'
                                      : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                                  }`}
                                >
                                  {ct}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">전투력 (K)</label>
                            <input
                              type="number"
                              value={char.combat_power || ''}
                              onChange={e => updateCharacter(idx, 'combat_power', parseFloat(e.target.value) || 0)}
                              placeholder="예: 150"
                              min={0}
                              step={0.1}
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            />
                          </div>
                          <div className="flex flex-col gap-2 justify-end">
                            {(() => {
                              const isSupport = char.class_type === '치유성' || char.class_type === '호법성';
                              return (
                                <>
                                  <label className={`flex items-center gap-2 ${isSupport || char.is_underpowered ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <input
                                      type="checkbox"
                                      checked={isSupport ? false : char.can_clear_raid}
                                      disabled={isSupport || char.is_underpowered}
                                      onChange={e => updateCharacter(idx, 'can_clear_raid', e.target.checked)}
                                      className="w-4 h-4 text-indigo-600"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">공팟 가도 상관 없음</span>
                                  </label>
                                  <label className={`flex items-center gap-2 ${isSupport || char.can_clear_raid ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <input
                                      type="checkbox"
                                      checked={isSupport ? false : char.is_underpowered}
                                      disabled={isSupport || char.can_clear_raid}
                                      onChange={e => updateCharacter(idx, 'is_underpowered', e.target.checked)}
                                      className="w-4 h-4 text-orange-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">공팟 스펙 미달(저스펙)</span>
                                  </label>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* 저장 버튼 */}
                <div className="flex gap-2 mb-8">
                  <button
                    onClick={handleSubmit}
                    disabled={!isValid() || saving}
                    className={`flex-1 py-3 rounded-lg text-white font-semibold transition-colors ${
                      isValid() && !saving
                        ? 'bg-indigo-600 hover:bg-indigo-700'
                        : 'bg-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {saving ? '저장 중...' : editId ? '수정하기' : '저장하기'}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-3 rounded-lg text-gray-600 dark:text-gray-300 font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    취소
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* 저장된 프로필 목록 */}
        {profiles.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">등록된 소유주 ({profiles.length}명)</h2>
            <div className="space-y-2">
              {profiles.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg">
                  <div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{p.owner_name}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                      {p.characters.map(c => `${c.nickname}(${c.class_type}/${c.combat_power}K)`).join(', ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleEdit(p)} className="text-indigo-500 text-sm hover:text-indigo-700">수정</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => handleDelete(p.id)} className="text-red-500 text-sm hover:text-red-700">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="h-20" />
      </>)}
    </div>
  );
}
