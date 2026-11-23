import type { AdminUser, ExamSession, StudentParticipant, WsServerEvent } from '../types/exam';

async function request<T>(url: string, options: RequestInit = {}, bearerToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error || `Permintaan gagal (${response.status})`);
  }
  return data;
}

export const api = {
  // Auth
  loginAdmin(email: string, password: string) {
    return request<{ token: string; admin: AdminUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  registerAdmin(name: string, email: string, password: string) {
    return request<{ token: string; admin: AdminUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
  },

  loginDemoSupervisor() {
    return request<{ token: string; admin: AdminUser }>('/api/auth/demo-supervisor', {
      method: 'POST',
    });
  },

  getAdminMe(token: string) {
    return request<{ admin: AdminUser }>('/api/auth/me', {}, token);
  },

  // Admin Sessions
  getAdminSessions(token: string) {
    return request<{ sessions: ExamSession[] }>('/api/admin/sessions', {}, token);
  },

  createExamSession(
    token: string,
    payload: {
      subjectName: string;
      formUrl: string;
      durationMinutes: number;
      supervisorPin: string;
      maxViolations: number;
    }
  ) {
    return request<{ session: ExamSession }>(
      '/api/admin/sessions',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  toggleSessionActive(token: string, sessionId: string, isActive: boolean) {
    return request<{ session: ExamSession }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/toggle`,
      {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      },
      token
    );
  },

  getParticipants(token: string, sessionId: string) {
    return request<{ participants: StudentParticipant[] }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/participants`,
      {},
      token
    );
  },

  resetStudent(token: string, sessionId: string, studentId: string) {
    return request<{ participant: StudentParticipant }>(
      '/api/admin/participants/reset',
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, studentId }),
      },
      token
    );
  },

  kickStudent(token: string, sessionId: string, studentId: string) {
    return request<{ participant: StudentParticipant }>(
      '/api/admin/participants/kick',
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, studentId }),
      },
      token
    );
  },

  // Student
  joinExam(payload: { token: string; fullName: string; nis: string }) {
    return request<{
      studentAuthToken: string;
      session: ExamSession;
      participant: StudentParticipant;
    }>('/api/student/join', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getStudentState(studentToken: string) {
    return request<{ session: ExamSession; participant: StudentParticipant }>(
      '/api/student/state',
      {},
      studentToken
    );
  },

  reportViolation(studentToken: string, reason: string) {
    return request<{ participant: StudentParticipant }>(
      '/api/student/violation',
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
      studentToken
    );
  },

  unlockStudent(studentToken: string, pin: string) {
    return request<{ participant: StudentParticipant }>(
      '/api/student/unlock',
      {
        method: 'POST',
        body: JSON.stringify({ pin }),
      },
      studentToken
    );
  },

  finishExam(studentToken: string, pin: string) {
    return request<{ participant: StudentParticipant }>(
      '/api/student/finish',
      {
        method: 'POST',
        body: JSON.stringify({ pin }),
      },
      studentToken
    );
  },
};

export function connectExamSocket(params: {
  token: string;
  sessionId: string;
  onEvent: (event: WsServerEvent) => void;
  onStatusChange?: (connected: boolean) => void;
}): () => void {
  let ws: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closedByClient) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(
      params.token
    )}&sessionId=${encodeURIComponent(params.sessionId)}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      params.onStatusChange?.(true);
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as WsServerEvent;
        params.onEvent(parsed);
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      params.onStatusChange?.(false);
      if (!closedByClient) {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    ws?.close();
  };
}
