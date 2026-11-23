import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Lock,
  LogOut,
  Maximize2,
  ShieldAlert,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { api, connectExamSocket } from '../lib/api';
import { alarmHelper } from '../lib/alarm';
import { LockedExamViewport } from './LockedExamViewport';
import type { ExamSession, StudentParticipant } from '../types/exam';

interface StudentExamScreenProps {
  studentToken: string;
  initialSession: ExamSession;
  initialParticipant: StudentParticipant;
  onExitExam: (message?: string) => void;
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export const StudentExamScreen: React.FC<StudentExamScreenProps> = ({
  studentToken,
  initialSession,
  initialParticipant,
  onExitExam,
}) => {
  const [session, setSession] = useState<ExamSession>(initialSession);
  const [participant, setParticipant] = useState<StudentParticipant>(initialParticipant);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    initialSession.durationMinutes * 60
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);
  const [kickedNotice, setKickedNotice] = useState<string | null>(null);

  const lastViolationAtRef = useRef<number>(0);
  const isFinishingLegallyRef = useRef<boolean>(false);
  const wasFullscreenRef = useRef<boolean>(Boolean(document.fullscreenElement));
  const participantRef = useRef<StudentParticipant>(initialParticipant);

  useEffect(() => {
    participantRef.current = participant;
  }, [participant]);

  const isDisqualified =
    participant.status === 'LOCKED' || participant.violationCount >= session.maxViolations;

  // Trigger or stop alarm whenever lock state changes
  useEffect(() => {
    if (participant.isLocked && !participant.isKicked && participant.status !== 'FINISHED') {
      alarmHelper.startAlarm();
    } else {
      alarmHelper.stopAlarm();
    }
    return () => {
      alarmHelper.stopAlarm();
    };
  }, [participant.isLocked, participant.isKicked, participant.status]);

  // Countdown Timer
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // WebSocket Real-Time Sync (listens for Admin Reset Status or Kick Siswa)
  useEffect(() => {
    const disconnect = connectExamSocket({
      token: studentToken,
      sessionId: session.id,
      onEvent: (event) => {
        if (event.type === 'participant:updated') {
          setParticipant(event.participant);
          if (event.participant.isKicked || event.participant.status === 'KICKED') {
            isFinishingLegallyRef.current = true;
            alarmHelper.stopAlarm();
            if (document.fullscreenElement && document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
            }
            setKickedNotice('Anda telah dikeluarkan secara paksa oleh Pengawas.');
          } else if (!event.participant.isLocked) {
            setPinInput('');
            setPinError(null);
          }
        } else if (event.type === 'session:updated') {
          setSession((prev) => ({ ...event.session, supervisorPin: prev.supervisorPin }));
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [studentToken, session.id]);

  // Report Security Violation (with 2-second debounce)
  const triggerViolation = useCallback(
    async (reason: string) => {
      const current = participantRef.current;
      if (isFinishingLegallyRef.current || current.isKicked || current.status === 'FINISHED') {
        return;
      }

      const now = Date.now();
      if (now - lastViolationAtRef.current < 2000) {
        return;
      }
      lastViolationAtRef.current = now;

      if (current.isLocked) {
        alarmHelper.startAlarm();
        return;
      }

      // Optimistically lock immediately so student cannot read/copy while network request is in flight
      alarmHelper.startAlarm();
      setParticipant((prev) => ({
        ...prev,
        isLocked: true,
        lastViolationReason: reason,
        status: prev.violationCount + 1 >= session.maxViolations ? 'LOCKED' : 'WARNING',
      }));
      setPinInput('');
      setPinError(null);

      try {
        const res = await api.reportViolation(studentToken, reason);
        setParticipant(res.participant);
      } catch {
        // Keep local lock active even on transient network error
      }
    },
    [studentToken, session.maxViolations]
  );

  // Security Event Listeners (Visibility, Focus, Fullscreen Exit, Split-Screen, Copy/Paste/Shortcut)
  useEffect(() => {
    const initialScreenW = window.screen.availWidth || window.innerWidth;
    const initialScreenH = window.screen.availHeight || window.innerHeight;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        void triggerViolation('Meninggalkan halaman ujian (berpindah tab / minimize browser)');
      }
    };

    const handleWindowBlur = () => {
      window.setTimeout(() => {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'IFRAME') {
          return;
        }
        if (!document.hasFocus()) {
          void triggerViolation('Membuka jendela lain / panel notifikasi / berpindah fokus layar');
        }
      }, 60);
    };

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) {
        wasFullscreenRef.current = true;
      } else if (wasFullscreenRef.current && !isFinishingLegallyRef.current) {
        void triggerViolation('Keluar dari mode layar penuh (Fullscreen Lock)');
      }
    };

    const handleResize = () => {
      if (isFinishingLegallyRef.current) return;
      // Detect split-screen / multi-window on desktop/tablet viewports
      const widthRatio = window.innerWidth / initialScreenW;
      const heightRatio = window.innerHeight / initialScreenH;
      if (initialScreenW >= 768 && (widthRatio < 0.62 || heightRatio < 0.55)) {
        void triggerViolation('Mengaktifkan mode Split-Screen / mengecilkan jendela ujian');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleClipboardBlock = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (!isTextInput || e.type === 'copy' || e.type === 'cut') {
        e.preventDefault();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const hasModifier = e.ctrlKey || e.metaKey;

      if (
        e.key === 'F12' ||
        e.key === 'PrintScreen' ||
        (hasModifier && ['c', 'v', 'x', 'u', 'p', 's'].includes(key)) ||
        (hasModifier && e.shiftKey && ['i', 'j', 'c'].includes(key))
      ) {
        e.preventDefault();
        if (e.key === 'PrintScreen') {
          void triggerViolation('Mencoba mengambil tangkapan layar (PrintScreen)');
        }
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isFinishingLegallyRef.current) {
        e.preventDefault();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleResize);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleClipboardBlock);
    document.addEventListener('cut', handleClipboardBlock);
    document.addEventListener('paste', handleClipboardBlock);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleClipboardBlock);
      document.removeEventListener('cut', handleClipboardBlock);
      document.removeEventListener('paste', handleClipboardBlock);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [triggerViolation]);

  const requestEnterFullscreen = () => {
    alarmHelper.unlockAudio();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisqualified) return;
    setPinError(null);
    setIsSubmittingPin(true);
    try {
      const res = await api.unlockStudent(studentToken, pinInput);
      setParticipant(res.participant);
      setPinInput('');
      alarmHelper.stopAlarm();
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'PIN Pengawas salah.');
    } finally {
      setIsSubmittingPin(false);
    }
  };

  const handleExitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setIsSubmittingPin(true);
    isFinishingLegallyRef.current = true;
    try {
      await api.finishExam(studentToken, pinInput);
      alarmHelper.stopAlarm();
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      }
      onExitExam('Ujian selesai. Terima kasih telah mengikuti ujian dengan jujur.');
    } catch (err) {
      isFinishingLegallyRef.current = false;
      setPinError(err instanceof Error ? err.message : 'PIN Keluar salah.');
    } finally {
      setIsSubmittingPin(false);
    }
  };

  if (kickedNotice) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="bg-white text-slate-900 border border-slate-200 rounded-xl max-w-md w-full p-8 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-600 mx-auto" />
          <h2 className="text-xl font-bold">Sesi Ujian Dihentikan</h2>
          <p className="text-sm text-slate-600">{kickedNotice}</p>
          <button
            type="button"
            onClick={() => onExitExam()}
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Kembali ke Halaman Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-100 exam-locked-surface">
      {/* Locked Exam Top Bar */}
      <header className="h-16 bg-blue-900 text-white px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <ShieldCheck className="w-5 h-5 text-blue-200 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold truncate">{session.subjectName}</h1>
            <p className="text-xs text-blue-100 truncate">
              {participant.fullName} · <span className="font-mono tabular-nums">{participant.nis}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Live Countdown Timer */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-950/60 border border-blue-700/60 rounded-lg">
            <Clock className="w-4 h-4 text-blue-200 shrink-0" />
            <span className="font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
              {formatCountdown(remainingSeconds)}
            </span>
          </div>

          {!isFullscreen && (
            <button
              type="button"
              onClick={requestEnterFullscreen}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 bg-blue-800 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Layar Penuh</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setPinInput('');
              setPinError(null);
              setShowExitDialog(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Selesai Ujian</span>
          </button>
        </div>
      </header>

      {/* Violation Status Banner (when > 0 violations) */}
      {participant.violationCount > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Peringatan Pelanggaran:{' '}
              <span className="font-mono tabular-nums">
                {participant.violationCount} / {session.maxViolations}
              </span>
            </span>
          </div>
          <span className="text-xs text-amber-800 truncate hidden sm:inline">
            Terakhir: {participant.lastViolationReason}
          </span>
        </div>
      )}

      {/* Isolated Exam Viewport (No URL Bar, No Browser Navigation) */}
      <LockedExamViewport
        formUrl={session.formUrl}
        subjectName={session.subjectName}
        studentName={participant.fullName}
        nis={participant.nis}
        onRequestFinish={() => {
          setPinInput('');
          setPinError(null);
          setShowExitDialog(true);
        }}
      />

      {/* Crimson Violation Lockdown Overlay */}
      {participant.isLocked && (
        <div className="fixed inset-0 z-50 bg-red-950/95 flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white text-slate-900 border border-red-200 rounded-xl w-full max-w-md p-6 sm:p-8 shadow-2xl space-y-5">
            <div className="text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-red-100 flex items-center justify-center">
                {isDisqualified ? (
                  <Lock className="w-7 h-7 text-red-700" />
                ) : (
                  <Volume2 className="w-7 h-7 text-red-700 animate-pulse" />
                )}
              </div>

              <h2 className="text-xl font-bold text-red-900 text-balance">
                {isDisqualified
                  ? 'UJIAN TERKUNCI / DISKUALIFIKASI'
                  : 'Anda Terdeteksi Meninggalkan Halaman Ujian'}
              </h2>

              <p className="text-xs font-semibold font-mono tabular-nums text-red-700">
                Pelanggaran Tercatat: {participant.violationCount} / {session.maxViolations}
              </p>

              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                {participant.lastViolationReason || 'Aktivitas mencurigakan terdeteksi'}
              </div>
            </div>

            {isDisqualified ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-slate-600 leading-relaxed">
                  Anda telah melewati batas maksimal pelanggaran. Layar akan terbuka otomatis hanya
                  jika Pengawas melakukan <strong>Reset Status</strong> dari Dashboard Monitoring.
                </p>
                <div className="pt-2 text-xs text-slate-500">
                  Menunggu tindakan jarak jauh dari pengawas...
                </div>
              </div>
            ) : (
              <form onSubmit={handleUnlockSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Masukkan PIN Pengawas untuk Buka Kunci
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      setPinError(null);
                    }}
                    placeholder="Masukkan PIN Pengawas"
                    className="w-full h-11 px-3.5 text-center font-mono text-base tracking-widest bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700"
                    required
                  />
                </div>

                {pinError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 text-center">
                    {pinError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmittingPin}
                  className="w-full h-11 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {isSubmittingPin ? 'Memverifikasi PIN...' : 'Buka Kunci Layar'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Exit Exam Confirmation Overlay (Non-window overlay so focus stays intact) */}
      {showExitDialog && !participant.isLocked && (
        <div className="fixed inset-0 z-40 bg-slate-900/75 flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-slate-900">Konfirmasi Selesai Ujian</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Pastikan Anda telah menekan tombol <strong>Kirim / Submit</strong> pada formulir soal.
                Masukkan PIN Keluar dari pengawas untuk mengakhiri sesi ujian.
              </p>
            </div>

            <form onSubmit={handleExitSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  PIN Keluar Pengawas
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(null);
                  }}
                  placeholder="Masukkan PIN Keluar"
                  className="w-full h-11 px-3.5 text-center font-mono text-base tracking-widest bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                  required
                />
              </div>

              {pinError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {pinError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSubmittingPin}
                  onClick={() => {
                    setShowExitDialog(false);
                    setPinInput('');
                    setPinError(null);
                  }}
                  className="h-10 px-4 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPin}
                  className="h-10 px-4 text-sm font-semibold text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  {isSubmittingPin ? 'Memproses...' : 'Keluar Ujian'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
