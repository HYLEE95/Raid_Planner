import type { DBRegistration } from '../../lib/types';

interface Props {
  registrations: DBRegistration[];
  show: boolean;
  onToggle: () => void;
  onEdit: (reg: DBRegistration) => void;
  onDelete: (id: string) => void;
  /** 브리레흐 전용 장비 배지(파롭/블랜/소울) 표시 여부. 정규 사냥에서는 끈다. */
  showBriBadges: boolean;
}

/** 홈 화면 신청자 목록 (접기/펼치기, 수정·삭제). 브리레흐와 정규 사냥이 함께 쓴다. */
export default function RegistrationList({ registrations, show, onToggle, onEdit, onDelete, showBriBadges }: Props) {
  return (
    <div className="mb-6">
      <button
        onClick={onToggle}
        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
      >
        {show ? '신청자 목록 숨기기' : '신청자 목록 보기'} ({registrations.length}명|{registrations.reduce((s, r) => s + r.characters.length, 0)}캐릭)
      </button>

      {show && (
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
                      {`${c.nickname}(${c.class_type})`}
                      {showBriBadges && c.has_destruction_robe && (
                        <span className="ml-1 px-1 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 text-[10px] rounded border border-purple-200 dark:border-purple-700">파롭</span>
                      )}
                      {showBriBadges && c.is_blast_lancer && (
                        <span className="ml-1 px-1 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 text-[10px] rounded border border-blue-200 dark:border-blue-700">블랜</span>
                      )}
                      {showBriBadges && c.has_soul_weapon && (
                        <span className="ml-1 px-1 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 text-[10px] rounded border border-amber-200 dark:border-amber-700">소울</span>
                      )}
                    </span>
                  ))}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onEdit(reg)}
                  className="text-indigo-500 text-sm hover:text-indigo-700"
                >
                  수정
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => onDelete(reg.id)}
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
  );
}
