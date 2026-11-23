import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileText, Info } from 'lucide-react';

interface LockedExamViewportProps {
  formUrl: string;
  subjectName: string;
  studentName: string;
  nis: string;
  onRequestFinish: () => void;
}

interface SampleQuestion {
  id: string;
  prompt: string;
  type: 'choice' | 'essay';
  options?: string[];
}

const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    id: 'q1',
    prompt: '1. Jika f(x) = 3x² - 4x + 5, maka nilai turunan pertama f\'(2) adalah...',
    type: 'choice',
    options: ['6', '8', '10', '12'],
  },
  {
    id: 'q2',
    prompt: '2. Sebuah dadu bersisi enam dilempar satu kali. Peluang munculnya mata dadu bilangan prima adalah...',
    type: 'choice',
    options: ['1/6', '1/3', '1/2', '2/3'],
  },
  {
    id: 'q3',
    prompt: '3. Nilai dari lim (x -> 3) (x² - 9) / (x - 3) adalah...',
    type: 'choice',
    options: ['0', '3', '6', '9'],
  },
  {
    id: 'q4',
    prompt: '4. Diketahui barisan aritmatika dengan suku ke-3 adalah 11 dan suku ke-7 adalah 23. Suku pertama barisan tersebut adalah...',
    type: 'choice',
    options: ['3', '5', '7', '9'],
  },
  {
    id: 'q5',
    prompt: '5. Jelaskan secara singkat langkah-langkah menentukan titik stasioner dari suatu fungsi polinomial!',
    type: 'essay',
  },
];

function normalizeGoogleFormUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('examshield://')) return trimmed;
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (parsed.hostname.includes('docs.google.com') && parsed.pathname.includes('/forms/')) {
      parsed.searchParams.set('embedded', 'true');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export const LockedExamViewport: React.FC<LockedExamViewportProps> = ({
  formUrl,
  subjectName,
  studentName,
  nis,
  onRequestFinish,
}) => {
  const isBuiltInSample = formUrl.startsWith('examshield://');
  const embeddedUrl = useMemo(() => normalizeGoogleFormUrl(formUrl), [formUrl]);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Built-in form state
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submittedSample, setSubmittedSample] = useState(false);

  if (isBuiltInSample) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-100 py-8 px-4 sm:px-6 exam-locked-surface">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Header Form Card */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="h-2.5 bg-blue-800" />
            <div className="p-6 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-800">
                <FileText className="w-4 h-4" />
                <span>Lembar Soal Terisolasi ExamShield</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">{subjectName}</h2>
              <p className="text-sm text-slate-600">
                Peserta: <strong className="text-slate-900">{studentName}</strong> · NIS:{' '}
                <strong className="font-mono tabular-nums text-slate-900">{nis}</strong>
              </p>
            </div>
          </div>

          {submittedSample ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900">Jawaban Anda Telah Direkam</h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Silakan tekan tombol <strong>Selesai Ujian</strong> di kanan atas dan minta PIN
                  Keluar dari pengawas ruangan untuk menutup sesi.
                </p>
              </div>
              <button
                type="button"
                onClick={onRequestFinish}
                className="px-5 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Masukkan PIN Keluar Sekarang
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSubmittedSample(true);
              }}
              className="space-y-4"
            >
              {SAMPLE_QUESTIONS.map((q) => (
                <div
                  key={q.id}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <p className="text-sm font-semibold text-slate-900 leading-relaxed">{q.prompt}</p>
                  {q.type === 'choice' && q.options ? (
                    <div className="space-y-2">
                      {q.options.map((opt) => {
                        const checked = answers[q.id] === opt;
                        return (
                          <label
                            key={opt}
                            className={`flex items-center gap-3 p-3 rounded-lg border text-sm cursor-pointer transition-colors ${
                              checked
                                ? 'border-blue-800 bg-blue-50/70 text-slate-900 font-medium'
                                : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              value={opt}
                              checked={checked}
                              onChange={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [q.id]: opt,
                                }))
                              }
                              className="w-4 h-4 accent-blue-800"
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea
                      rows={3}
                      value={answers[q.id] || ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      placeholder="Tuliskan jawaban uraian Anda di sini..."
                      className="w-full p-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    />
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500 tabular-nums">
                  Terjawab: {Object.values(answers).filter((v) => v.trim().length > 0).length} /{' '}
                  {SAMPLE_QUESTIONS.length} soal
                </span>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-800 hover:bg-blue-900 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Kirim Jawaban
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative bg-white flex flex-col exam-locked-surface">
      {!iframeLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 z-10 p-6 text-center">
          <div className="w-8 h-8 border-2 border-blue-800 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-700">Memuat formulir soal terisolasi...</p>
        </div>
      )}

      <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-4 text-xs text-slate-600">
        <div className="flex items-center gap-2 min-w-0">
          <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="truncate">
            Mode Peramban Terkunci aktif · Bilah alamat disembunyikan · Dilarang meninggalkan layar
          </span>
        </div>
      </div>

      <iframe
        title={`Soal Ujian ${subjectName}`}
        src={embeddedUrl}
        onLoad={() => setIframeLoaded(true)}
        sandbox="allow-forms allow-scripts allow-same-origin"
        className="w-full flex-1 border-0 bg-white"
      />
    </div>
  );
};
