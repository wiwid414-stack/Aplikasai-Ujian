import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileSpreadsheet,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { api, connectExamSocket } from '../lib/api';
import { CreateExamDialog } from './CreateExamDialog';
import {
  STUDENT_STATUS_META,
  type AdminUser,
  type ExamSession,
  type StudentParticipant,
  type StudentStatus,
} from '../types/exam';

interface AdminDashboardProps {
  adminToken: string;
  adminUser: AdminUser;
  onLogout: () => void;
}

type DashboardTab = 'SESSIONS' | 'MONITORING';
type StatusFilter = 'ALL' | StudentStatus;

function formatTimeShort(ts: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminToken,
  adminUser,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('SESSIONS');
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<StudentParticipant[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null,
    [sessions, selectedSessionId]
  );

  // Load admin sessions on mount
  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoadingSessions(true);
      try {
        const res = await api.getAdminSessions(adminToken);
        if (!active) return;
        setSessions(res.sessions);
        if (res.sessions.length > 0) {
          setSelectedSessionId((prev) => prev || res.sessions[0].id);
        }
      } catch (err) {
        if (active) {
          setFeedback(err instanceof Error ? err.message : 'Gagal memuat sesi ujian.');
        }
      } finally {
        if (active) setIsLoadingSessions(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [adminToken]);

  // Connect WebSocket for the currently selected session
  useEffect(() => {
    if (!selectedSession) {
      setParticipants([]);
      setWsConnected(false);
      return;
    }

    let cancelled = false;
    api
      .getParticipants(adminToken, selectedSession.id)
      .then((res) => {
        if (!cancelled) setParticipants(res.participants);
      })
      .catch(() => {});

    const disconnect = connectExamSocket({
      token: adminToken,
      sessionId: selectedSession.id,
      onStatusChange: (connected) => setWsConnected(connected),
      onEvent: (event) => {
        if (event.type === 'participants:snapshot' && event.sessionId === selectedSession.id) {
          setParticipants(event.participants);
        } else if (event.type === 'participant:updated' && event.sessionId === selectedSession.id) {
          setParticipants((prev) => {
            const exists = prev.some((p) => p.studentId === event.participant.studentId);
            const next = exists
              ? prev.map((p) =>
                  p.studentId === event.participant.studentId ? event.participant : p
                )
              : [event.participant, ...prev];
            return [...next].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
          });
        } else if (event.type === 'session:updated') {
          setSessions((prev) =>
            prev.map((s) => (s.id === event.session.id ? event.session : s))
          );
        }
      },
    });

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [adminToken, selectedSession?.id]);

  // Auto-dismiss feedback toast
  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const handleCreateSession = async (payload: {
    subjectName: string;
    formUrl: string;
    durationMinutes: number;
    supervisorPin: string;
    maxViolations: number;
  }) => {
    setIsCreating(true);
    try {
      const res = await api.createExamSession(adminToken, payload);
      setSessions((prev) => [res.session, ...prev]);
      setSelectedSessionId(res.session.id);
      setShowCreateDialog(false);
      setFeedback(`Sesi dibuat. Token Ujian: ${res.session.token}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleSession = async (session: ExamSession) => {
    try {
      const res = await api.toggleSessionActive(adminToken, session.id, !session.isActive);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? res.session : s)));
      setFeedback(
        `Token ${res.session.token} sekarang ${res.session.isActive ? 'AKTIF' : 'NONAKTIF'}.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mengubah status sesi.');
    }
  };

  const handleResetStudent = async (student: StudentParticipant) => {
    try {
      const res = await api.resetStudent(adminToken, student.sessionId, student.studentId);
      setParticipants((prev) =>
        prev.map((p) => (p.studentId === student.studentId ? res.participant : p))
      );
      setFeedback(`Status ${student.fullName} berhasil direset dan layar dibuka kembali.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mereset status siswa.');
    }
  };

  const handleKickStudent = async (student: StudentParticipant) => {
    try {
      const res = await api.kickStudent(adminToken, student.sessionId, student.studentId);
      setParticipants((prev) =>
        prev.map((p) => (p.studentId === student.studentId ? res.participant : p))
      );
      setFeedback(`${student.fullName} telah dikeluarkan dari sesi ujian.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mengeluarkan siswa.');
    }
  };

  const handleCopyToken = (session: ExamSession) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(session.token).catch(() => {});
    }
    setCopiedTokenId(session.id);
    window.setTimeout(() => setCopiedTokenId(null), 1800);
  };

  // Monitoring Stats & Filtering
  const stats = useMemo(() => {
    const working = participants.filter((p) => p.status === 'WORKING').length;
    const warning = participants.filter((p) => p.status === 'WARNING').length;
    const locked = participants.filter((p) => p.status === 'LOCKED').length;
    const done = participants.filter((p) => p.status === 'FINISHED' || p.status === 'KICKED').length;
    return { working, warning, locked, done, total: participants.length };
  }, [participants]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return participants.filter((p) => {
      const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
      const matchesQuery =
        !q || p.fullName.toLowerCase().includes(q) || p.nis.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [participants, searchQuery, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Sidebar Navigation (256px desktop) */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-blue-800 shrink-0" />
          <span className="text-base font-bold tracking-tight text-slate-900">ExamShield</span>
        </div>

        <nav className="p-3 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('SESSIONS')}
            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'SESSIONS'
                ? 'bg-blue-50 text-blue-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            <span>Manajemen Soal &amp; Token</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('MONITORING')}
            className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'MONITORING'
                ? 'bg-blue-50 text-blue-900 font-semibold'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 shrink-0" />
              <span>Live Monitoring</span>
            </span>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {participants.length}
            </span>
          </button>
        </nav>

        {/* Session Quick Switcher */}
        {sessions.length > 0 && (
          <div className="px-3 pt-4 pb-2 border-t border-slate-200 flex-1 overflow-y-auto hidden lg:block">
            <p className="px-2 text-xs font-semibold text-slate-500 mb-2">Sesi Terdaftar</p>
            <div className="space-y-1">
              {sessions.map((s) => {
                const isSelected = selectedSession?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedSessionId(s.id);
                      setActiveTab('MONITORING');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-slate-100 text-slate-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="truncate">{s.subjectName}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                      <span>{s.token}</span>
                      <span aria-hidden="true">·</span>
                      <span className={s.isActive ? 'text-emerald-700' : 'text-red-600'}>
                        {s.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Account Footer */}
        <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">{adminUser.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{adminUser.email}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0"
            title="Keluar"
            aria-label="Keluar dari konsol pengawas"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left + 1 Primary Action on right */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-500 whitespace-nowrap">ExamShield</span>
            <span className="text-slate-300">/</span>
            <span className="font-semibold text-slate-900 truncate">
              {activeTab === 'SESSIONS'
                ? 'Manajemen Soal & Token'
                : selectedSession
                  ? `Live Monitoring · ${selectedSession.subjectName}`
                  : 'Live Monitoring'}
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {activeTab === 'MONITORING' && selectedSession && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600">
                <span
                  className={`w-2 h-2 rounded-full ${
                    wsConnected ? 'bg-emerald-600' : 'bg-amber-500'
                  }`}
                />
                <span>{wsConnected ? 'Terhubung Real-Time' : 'Menghubungkan...'}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Sesi Ujian</span>
            </button>
          </div>
        </header>

        {/* Feedback Toast Banner */}
        {feedback && (
          <div className="bg-blue-900 text-white px-6 py-2.5 text-xs font-medium flex items-center justify-between">
            <span>{feedback}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-blue-200 hover:text-white cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 p-6 max-w-6xl w-full mx-auto space-y-6">
          {activeTab === 'SESSIONS' ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Daftar Sesi Ujian &amp; Token</h1>
                  <p className="text-sm text-slate-600">
                    Bagikan Token 6 digit kepada peserta dan simpan PIN Pengawas untuk membuka kunci layar.
                  </p>
                </div>
              </div>

              {isLoadingSessions ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <div className="h-5 bg-slate-100 rounded w-1/3 animate-pulse" />
                  <div className="h-10 bg-slate-100 rounded w-full animate-pulse" />
                  <div className="h-10 bg-slate-100 rounded w-full animate-pulse" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
                  <p className="text-sm font-semibold text-slate-900">Belum ada sesi ujian</p>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    Tambahkan tautan Google Form untuk menghasilkan Token Ujian 6 digit dan mulai
                    memantau peserta secara real-time.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreateDialog(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Buat Sesi Pertama</span>
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Mata Pelajaran</th>
                          <th className="py-3 px-4">Token Ujian</th>
                          <th className="py-3 px-4">PIN Pengawas</th>
                          <th className="py-3 px-4 text-right">Durasi</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {sessions.map((session) => {
                          const pinVisible = Boolean(revealedPins[session.id]);
                          const isCopied = copiedTokenId === session.id;
                          return (
                            <tr key={session.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="font-semibold text-slate-900">
                                  {session.subjectName}
                                </div>
                                <div className="text-xs text-slate-500 truncate max-w-xs font-mono">
                                  {session.formUrl.startsWith('examshield://')
                                    ? 'Formulir Simulasi ExamShield'
                                    : session.formUrl}
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="inline-flex items-center gap-2">
                                  <span className="font-mono font-bold text-blue-900 tracking-wider">
                                    {session.token}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyToken(session)}
                                    className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer"
                                    title="Salin Token"
                                    aria-label={`Salin token ${session.token}`}
                                  >
                                    {isCopied ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="inline-flex items-center gap-2 font-mono tabular-nums text-slate-700">
                                  <span>{pinVisible ? session.supervisorPin : '••••'}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRevealedPins((prev) => ({
                                        ...prev,
                                        [session.id]: !prev[session.id],
                                      }))
                                    }
                                    className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer"
                                    aria-label="Tampilkan atau sembunyikan PIN"
                                  >
                                    {pinVisible ? (
                                      <EyeOff className="w-3.5 h-3.5" />
                                    ) : (
                                      <Eye className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </td>

                              <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                                {session.durationMinutes} mnt
                              </td>

                              <td className="py-3.5 px-4">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSession(session)}
                                  className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer"
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      session.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                                    }`}
                                  />
                                  <span
                                    className={
                                      session.isActive ? 'text-emerald-700' : 'text-slate-500'
                                    }
                                  >
                                    {session.isActive ? 'Aktif' : 'Nonaktif'}
                                  </span>
                                </button>
                              </td>

                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSession(session)}
                                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                  >
                                    {session.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedSessionId(session.id);
                                      setActiveTab('MONITORING');
                                    }}
                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                  >
                                    Pantau Sesi
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* LIVE MONITORING TAB */
            <div className="space-y-5">
              {selectedSession ? (
                <>
                  {/* Session Summary Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h1 className="text-xl font-bold text-slate-900">
                        {selectedSession.subjectName}
                      </h1>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>
                          Token:{' '}
                          <strong className="font-mono text-slate-900">
                            {selectedSession.token}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          PIN Pengawas:{' '}
                          <strong className="font-mono text-slate-900">
                            {selectedSession.supervisorPin}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Batas Pelanggaran:{' '}
                          <strong className="font-mono tabular-nums text-slate-900">
                            {selectedSession.maxViolations}x
                          </strong>
                        </span>
                      </div>
                    </div>

                    {sessions.length > 1 && (
                      <select
                        value={selectedSession.id}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        className="h-10 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20"
                        aria-label="Pilih sesi yang dipantau"
                      >
                        {sessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.subjectName} ({s.token})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* 4-Column Flat KPI Strip */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                        <span>Sedang Mengerjakan</span>
                      </div>
                      <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                        {stats.working}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Peringatan</span>
                      </div>
                      <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                        {stats.warning}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-red-600" />
                        <span>Terkunci / Diskualifikasi</span>
                      </div>
                      <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                        {stats.locked}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                        <span>Selesai / Keluar</span>
                      </div>
                      <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                        {stats.done}
                      </div>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari nama siswa atau NIS..."
                        className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
                      />
                    </div>

                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                      {(
                        [
                          ['ALL', 'Semua'],
                          ['WORKING', 'Aktif'],
                          ['WARNING', 'Peringatan'],
                          ['LOCKED', 'Terkunci'],
                          ['FINISHED', 'Selesai'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setStatusFilter(value)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            statusFilter === value
                              ? 'bg-white text-slate-900 shadow-xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Live Participants Table */}
                  {filteredParticipants.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {participants.length === 0
                          ? `Belum ada siswa yang masuk dengan token ${selectedSession.token}`
                          : 'Tidak ada peserta yang cocok dengan filter'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        {participants.length === 0
                          ? 'Peserta akan muncul secara otomatis di tabel ini saat mereka memasukkan token ujian.'
                          : 'Ubah kata kunci pencarian atau pilih filter status lainnya.'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                              <th className="py-3 px-4">Peserta &amp; NIS</th>
                              <th className="py-3 px-4">Status</th>
                              <th className="py-3 px-4 text-right">Pelanggaran</th>
                              <th className="py-3 px-4">Keterangan Terakhir</th>
                              <th className="py-3 px-4 text-right">Tindakan Pengawas</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-sm">
                            {filteredParticipants.map((student) => {
                              const meta = STUDENT_STATUS_META[student.status];
                              const canAct =
                                student.status !== 'FINISHED' && student.status !== 'KICKED';

                              return (
                                <tr
                                  key={student.studentId}
                                  className="hover:bg-slate-50/70 transition-colors"
                                >
                                  <td className="py-3 px-4">
                                    <div className="font-semibold text-slate-900">
                                      {student.fullName}
                                    </div>
                                    <div className="text-xs font-mono tabular-nums text-slate-500">
                                      NIS: {student.nis} · {formatTimeShort(student.lastUpdatedAt)}
                                    </div>
                                  </td>

                                  <td className="py-3 px-4">
                                    <div className="inline-flex items-center gap-2 whitespace-nowrap">
                                      <span
                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dotClass}`}
                                      />
                                      <span className={`text-xs font-semibold ${meta.textClass}`}>
                                        {meta.label}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                                    <span
                                      className={
                                        student.violationCount > 0
                                          ? 'font-bold text-red-700'
                                          : 'text-slate-600'
                                      }
                                    >
                                      {student.violationCount} / {selectedSession.maxViolations}
                                    </span>
                                  </td>

                                  <td className="py-3 px-4 max-w-xs">
                                    <span className="text-xs text-slate-600 line-clamp-2">
                                      {student.lastViolationReason || 'Normal — tidak ada pelanggaran'}
                                    </span>
                                  </td>

                                  <td className="py-3 px-4 text-right">
                                    {canAct ? (
                                      <div className="inline-flex items-center gap-2">
                                        {(student.isLocked || student.violationCount > 0) && (
                                          <button
                                            type="button"
                                            onClick={() => handleResetStudent(student)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                          >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            <span>Reset Status</span>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleKickStudent(student)}
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                        >
                                          <UserX className="w-3.5 h-3.5" />
                                          <span>Kick Siswa</span>
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-slate-400">Sesi berakhir</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-900">
                    Belum ada sesi ujian untuk dipantau
                  </p>
                  <p className="text-xs text-slate-500">
                    Buat sesi ujian baru terlebih dahulu di tab Manajemen Soal &amp; Token.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <CreateExamDialog
        isOpen={showCreateDialog}
        isCreating={isCreating}
        onClose={() => setShowCreateDialog(false)}
        onSubmit={handleCreateSession}
      />
    </div>
  );
};
