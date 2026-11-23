import React, { useState } from 'react';
import { X } from 'lucide-react';

interface CreateExamDialogProps {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    subjectName: string;
    formUrl: string;
    durationMinutes: number;
    supervisorPin: string;
    maxViolations: number;
  }) => Promise<void>;
}

export const CreateExamDialog: React.FC<CreateExamDialogProps> = ({
  isOpen,
  isCreating,
  onClose,
  onSubmit,
}) => {
  const [subjectName, setSubjectName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [supervisorPin, setSupervisorPin] = useState('4829');
  const [maxViolations, setMaxViolations] = useState('3');
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    const cleanSubject = subjectName.trim();
    const cleanUrl = formUrl.trim();
    const duration = Number(durationMinutes);
    const maxV = Number(maxViolations);

    if (cleanSubject.length < 2) {
      setErrorText('Nama mata pelajaran wajib diisi.');
      return;
    }
    if (
      cleanUrl !== 'examshield://sample-math-xii' &&
      !cleanUrl.includes('docs.google.com/forms') &&
      !cleanUrl.includes('forms.gle')
    ) {
      setErrorText('Masukkan link Google Form yang valid atau klik "Pakai Form Simulasi".');
      return;
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) {
      setErrorText('Durasi ujian minimal 1 menit dan maksimal 600 menit.');
      return;
    }
    if (!/^\d{4,6}$/.test(supervisorPin)) {
      setErrorText('PIN Pengawas harus 4 sampai 6 digit angka.');
      return;
    }

    try {
      await onSubmit({
        subjectName: cleanSubject,
        formUrl: cleanUrl,
        durationMinutes: duration,
        supervisorPin,
        maxViolations: Number.isFinite(maxV) ? maxV : 3,
      });
      setSubjectName('');
      setFormUrl('');
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Gagal membuat sesi ujian.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Buat Sesi Ujian Baru</h3>
          <button
            type="button"
            disabled={isCreating}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Nama Mata Pelajaran
            </label>
            <input
              type="text"
              value={subjectName}
              onChange={(e) => {
                setSubjectName(e.target.value);
                setErrorText(null);
              }}
              placeholder="Contoh: Bahasa Indonesia - Kelas XII"
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                URL Google Form
              </label>
              <button
                type="button"
                onClick={() => {
                  setFormUrl('examshield://sample-math-xii');
                  if (!subjectName) setSubjectName('Ujian Akhir Semester - Matematika XII');
                  setErrorText(null);
                }}
                className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
              >
                Pakai Form Simulasi
              </button>
            </div>
            <input
              type="text"
              value={formUrl}
              onChange={(e) => {
                setFormUrl(e.target.value);
                setErrorText(null);
              }}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Tautan disembunyikan dari siswa dan dimuat langsung di dalam browser terkunci.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Durasi (Menit)
              </label>
              <input
                type="number"
                min={1}
                max={600}
                value={durationMinutes}
                onChange={(e) => {
                  setDurationMinutes(e.target.value);
                  setErrorText(null);
                }}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                PIN Pengawas
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={supervisorPin}
                onChange={(e) => {
                  setSupervisorPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setErrorText(null);
                }}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Batas Pelanggaran
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxViolations}
                onChange={(e) => {
                  setMaxViolations(e.target.value);
                  setErrorText(null);
                }}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                required
              />
            </div>
          </div>

          {errorText && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {errorText}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isCreating}
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {isCreating ? 'Menyimpan...' : 'Generate Token & Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
