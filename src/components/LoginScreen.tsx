import React, { useState } from 'react';
import {
  ShieldCheck,
  UserCheck,
  Lock,
  ArrowRight,
  KeyRound,
  MonitorCheck,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '../lib/api';
import { alarmHelper } from '../lib/alarm';
import type { AdminUser, ExamSession, StudentParticipant } from '../types/exam';

interface LoginScreenProps {
  onAdminAuthenticated: (token: string, admin: AdminUser) => void;
  onStudentJoined: (params: {
    studentToken: string;
    session: ExamSession;
    participant: StudentParticipant;
  }) => void;
}

type RoleMode = 'STUDENT' | 'ADMIN';
type AdminAuthMode = 'LOGIN' | 'REGISTER';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onAdminAuthenticated,
  onStudentJoined,
}) => {
  const [role, setRole] = useState<RoleMode>('STUDENT');
  const [adminMode, setAdminMode] = useState<AdminAuthMode>('LOGIN');

  // Student form state
  const [fullName, setFullName] = useState('');
  const [nis, setNis] = useState('');
  const [examToken, setExamToken] = useState('');

  // Admin form state
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanName = fullName.trim();
    const cleanNis = nis.trim();
    const cleanToken = examToken.trim().toUpperCase();

    if (cleanName.length < 2 || cleanNis.length < 2 || cleanToken.length !== 6) {
      setErrorMessage('Lengkapi Nama Lengkap, NIS, dan Token Ujian 6 digit.');
      return;
    }

    // Unlock Web Audio API on user gesture so alarm siren can play reliably on violation
    alarmHelper.unlockAudio();

    setIsLoading(true);
    try {
      const res = await api.joinExam({
        token: cleanToken,
        fullName: cleanName,
        nis: cleanNis,
      });

      // Attempt fullscreen inside user click gesture
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          // StudentExamScreen also provides a one-click fullscreen lock control
        });
      }

      onStudentJoined({
        studentToken: res.studentAuthToken,
        session: res.session,
        participant: res.participant,
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memvalidasi token ujian.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res =
        adminMode === 'LOGIN'
          ? await api.loginAdmin(adminEmail, adminPassword)
          : await api.registerAdmin(adminName, adminEmail, adminPassword);
      onAdminAuthenticated(res.token, res.admin);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Autentikasi Admin gagal.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoSupervisor = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const res = await api.loginDemoSupervisor();
      onAdminAuthenticated(res.token, res.admin);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal masuk mode demo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 1-line wordmark + concise nav links + primary action */}
      <header className="w-full border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <ShieldCheck className="w-6 h-6 text-blue-800" />
            <span className="text-lg font-bold tracking-tight text-slate-900 font-[var(--font-display)]">
              ExamShield
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#keamanan" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Protokol Ujian
            </a>
            <a href="#monitoring" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Live Monitoring
            </a>
            <a href="#alur" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Panduan Akses
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setRole('ADMIN');
                setErrorMessage(null);
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-800 rounded-lg hover:bg-blue-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Konsol Pengawas
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left: Editorial Overview & Security Architecture */}
        <section className="lg:col-span-7 space-y-8 pt-2">
          <div className="space-y-4 max-w-2xl">
            <p className="text-xs font-semibold tracking-wide text-blue-800">
              Platform Ujian Terisolasi &amp; Pengawasan Real-Time
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight text-balance">
              Integritas ujian digital dengan isolasi layar penuh dan pemantauan seketika.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed">
              ExamShield mengunci sesi pengerjaan soal Google Form tanpa bilah URL atau salin-tempel,
              mendeteksi perpindahan tab maupun jendela secara otomatis, serta menyinkronkan status
              seluruh peserta langsung ke meja pengawas.
            </p>
          </div>

          <div id="keamanan" className="border-t border-slate-200 pt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <Lock className="w-4 h-4 text-blue-800 shrink-0" />
                <span>Isolasi Layar &amp; Blokir Salin-Tempel</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Menonaktifkan menu klik kanan, seleksi teks soal, tangkapan layar pintasan, dan
                menyembunyikan alamat tautan soal dari peserta.
              </p>
            </div>

            <div id="monitoring" className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Kunci Pelanggaran &amp; Alarm Sirene</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Berpindah tab, kehilangan fokus jendela, atau keluar dari layar penuh langsung
                mengunci layar siswa dengan alarm keras hingga pengawas memasukkan PIN.
              </p>
            </div>

            <div id="alur" className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <MonitorCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Kendali Pengawas Real-Time</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Guru dapat memantau status aktif, peringatan, atau diskualifikasi secara langsung
                serta melakukan Reset Status maupun Kick peserta jarak jauh.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <KeyRound className="w-4 h-4 text-blue-800 shrink-0" />
                <span>Validasi Token O(1) Tanpa Akun Siswa</span>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Siswa cukup memasukkan Nama Lengkap, NIS, dan Token 6 digit yang dibagikan
                pengawas tanpa perlu mendaftar akun terlebih dahulu.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span>Token Simulasi Aktif: <strong className="font-mono text-slate-800">X7K9P2</strong></span>
            <span aria-hidden="true">·</span>
            <span>PIN Pengawas Simulasi: <strong className="font-mono text-slate-800">4829</strong></span>
            <span aria-hidden="true">·</span>
            <span>Batas Pelanggaran Default: <strong className="font-mono text-slate-800">3x</strong></span>
          </div>
        </section>

        {/* Right: Single-Elevation Auth Card */}
        <section className="lg:col-span-5">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
            {/* Role Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setRole('STUDENT');
                  setErrorMessage(null);
                }}
                className={`py-2 px-3 text-sm font-semibold rounded-md transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer ${
                  role === 'STUDENT'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Siswa</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole('ADMIN');
                  setErrorMessage(null);
                }}
                className={`py-2 px-3 text-sm font-semibold rounded-md transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer ${
                  role === 'ADMIN'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Lock className="w-4 h-4" />
                <span>Admin / Guru</span>
              </button>
            </div>

            {role === 'STUDENT' ? (
              <form onSubmit={handleStudentSubmit} className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Masuk Ruang Ujian</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Masukkan identitas sesuai daftar hadir dan token dari pengawas.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setErrorMessage(null);
                    }}
                    placeholder="Contoh: Budi Santoso"
                    className="w-full h-11 px-3.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Nomor Induk / NIS
                  </label>
                  <input
                    type="text"
                    value={nis}
                    onChange={(e) => {
                      setNis(e.target.value);
                      setErrorMessage(null);
                    }}
                    placeholder="Contoh: 202410045"
                    className="w-full h-11 px-3.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Token Ujian (6 Digit)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setExamToken('X7K9P2');
                        if (!fullName) setFullName('Budi Santoso');
                        if (!nis) setNis('202410045');
                        setErrorMessage(null);
                      }}
                      className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
                    >
                      Isi contoh simulasi
                    </button>
                  </div>
                  <input
                    type="text"
                    value={examToken}
                    onChange={(e) => {
                      setExamToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                      setErrorMessage(null);
                    }}
                    placeholder="X7K9P2"
                    maxLength={6}
                    className="w-full h-11 px-3.5 text-base font-mono tracking-widest uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                    required
                  />
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                    {errorMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 px-4 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{isLoading ? 'Memvalidasi Token...' : 'Mulai Ujian'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {adminMode === 'LOGIN' ? 'Masuk Pengawas / Admin' : 'Daftar Akun Pengawas'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Kelola tautan Google Form, token ujian, dan pantau siswa real-time.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleAdminSubmit} className="space-y-4">
                  {adminMode === 'REGISTER' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Nama Lengkap Pengawas
                      </label>
                      <input
                        type="text"
                        value={adminName}
                        onChange={(e) => {
                          setAdminName(e.target.value);
                          setErrorMessage(null);
                        }}
                        placeholder="Contoh: Ibu Ratna Dewi"
                        className="w-full h-11 px-3.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Email Sekolah / Pengawas
                    </label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => {
                        setAdminEmail(e.target.value);
                        setErrorMessage(null);
                      }}
                      placeholder="guru@sekolah.sch.id"
                      className="w-full h-11 px-3.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={adminPassword}
                        onChange={(e) => {
                          setAdminPassword(e.target.value);
                          setErrorMessage(null);
                        }}
                        placeholder="Minimal 6 karakter"
                        className="w-full h-11 pl-3.5 pr-10 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                        aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                      {errorMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 px-4 bg-blue-800 hover:bg-blue-900 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>
                      {isLoading
                        ? 'Memproses...'
                        : adminMode === 'LOGIN'
                          ? 'Masuk Dashboard Admin'
                          : 'Buat Akun & Masuk'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handleDemoSupervisor}
                    className="w-full h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Masuk Cepat sebagai Pengawas Utama (Sesi Simulasi)
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAdminMode((m) => (m === 'LOGIN' ? 'REGISTER' : 'LOGIN'));
                        setErrorMessage(null);
                      }}
                      className="text-xs font-medium text-blue-800 hover:underline cursor-pointer"
                    >
                      {adminMode === 'LOGIN'
                        ? 'Belum punya akun pengawas? Daftar di sini'
                        : 'Sudah memiliki akun? Masuk di sini'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
