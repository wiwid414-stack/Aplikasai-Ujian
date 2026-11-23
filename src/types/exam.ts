export type StudentStatus =
  | 'WORKING'
  | 'WARNING'
  | 'LOCKED'
  | 'FINISHED'
  | 'KICKED';

export const STUDENT_STATUS_META: Record<
  StudentStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  WORKING: {
    label: 'Sedang Mengerjakan',
    dotClass: 'bg-emerald-600',
    textClass: 'text-emerald-700',
  },
  WARNING: {
    label: 'Peringatan / Pelanggaran',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700',
  },
  LOCKED: {
    label: 'Terkunci / Diskualifikasi',
    dotClass: 'bg-red-600',
    textClass: 'text-red-700',
  },
  FINISHED: {
    label: 'Selesai',
    dotClass: 'bg-blue-600',
    textClass: 'text-blue-700',
  },
  KICKED: {
    label: 'Dikeluarkan',
    dotClass: 'bg-slate-500',
    textClass: 'text-slate-600',
  },
};

export interface ExamSession {
  id: string;
  subjectName: string;
  formUrl: string;
  durationMinutes: number;
  token: string;
  supervisorPin: string;
  isActive: boolean;
  maxViolations: number;
  createdBy: string;
  createdAt: number;
}

export interface StudentParticipant {
  studentId: string;
  sessionId: string;
  fullName: string;
  nis: string;
  status: StudentStatus;
  violationCount: number;
  lastViolationReason: string;
  isLocked: boolean;
  isKicked: boolean;
  joinedAt: number;
  lastUpdatedAt: number;
}

export interface AdminUser {
  uid: string;
  email: string;
  name: string;
}

export type WsServerEvent =
  | { type: 'connected'; role: 'admin' | 'student' }
  | { type: 'participants:snapshot'; sessionId: string; participants: StudentParticipant[] }
  | { type: 'participant:updated'; sessionId: string; participant: StudentParticipant }
  | { type: 'session:updated'; session: ExamSession }
  | { type: 'error'; message: string };
