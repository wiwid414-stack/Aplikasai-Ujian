/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { AdminDashboard } from './components/AdminDashboard';
import { StudentExamScreen } from './components/StudentExamScreen';
import { api } from './lib/api';
import type { AdminUser, ExamSession, StudentParticipant } from './types/exam';

const ADMIN_TOKEN_KEY = 'examshield_admin_token';
const STUDENT_TOKEN_KEY = 'examshield_student_token';

type ActiveRoute =
  | { view: 'LOGIN'; notice?: string }
  | { view: 'ADMIN'; adminToken: string; adminUser: AdminUser }
  | {
      view: 'STUDENT';
      studentToken: string;
      session: ExamSession;
      participant: StudentParticipant;
    };

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>({ view: 'LOGIN' });
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const savedStudentToken = sessionStorage.getItem(STUDENT_TOKEN_KEY);
      if (savedStudentToken) {
        try {
          const res = await api.getStudentState(savedStudentToken);
          if (
            active &&
            !res.participant.isKicked &&
            res.participant.status !== 'KICKED' &&
            res.participant.status !== 'FINISHED'
          ) {
            setRoute({
              view: 'STUDENT',
              studentToken: savedStudentToken,
              session: res.session,
              participant: res.participant,
            });
            setIsRestoring(false);
            return;
          }
        } catch {
          sessionStorage.removeItem(STUDENT_TOKEN_KEY);
        }
      }

      const savedAdminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
      if (savedAdminToken) {
        try {
          const res = await api.getAdminMe(savedAdminToken);
          if (active) {
            setRoute({
              view: 'ADMIN',
              adminToken: savedAdminToken,
              adminUser: res.admin,
            });
            setIsRestoring(false);
            return;
          }
        } catch {
          sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        }
      }

      if (active) {
        setIsRestoring(false);
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  if (isRestoring) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-blue-800 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (route.view === 'ADMIN') {
    return (
      <AdminDashboard
        adminToken={route.adminToken}
        adminUser={route.adminUser}
        onLogout={() => {
          sessionStorage.removeItem(ADMIN_TOKEN_KEY);
          setRoute({ view: 'LOGIN' });
        }}
      />
    );
  }

  if (route.view === 'STUDENT') {
    return (
      <StudentExamScreen
        studentToken={route.studentToken}
        initialSession={route.session}
        initialParticipant={route.participant}
        onExitExam={(message) => {
          sessionStorage.removeItem(STUDENT_TOKEN_KEY);
          setRoute({ view: 'LOGIN', notice: message });
        }}
      />
    );
  }

  return (
    <div className="relative">
      {route.notice && (
        <div className="bg-emerald-800 text-white px-6 py-2.5 text-xs font-medium text-center">
          {route.notice}
        </div>
      )}
      <LoginScreen
        onAdminAuthenticated={(token, admin) => {
          sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
          setRoute({ view: 'ADMIN', adminToken: token, adminUser: admin });
        }}
        onStudentJoined={({ studentToken, session, participant }) => {
          sessionStorage.setItem(STUDENT_TOKEN_KEY, studentToken);
          setRoute({
            view: 'STUDENT',
            studentToken,
            session,
            participant,
          });
        }}
      />
    </div>
  );
}
