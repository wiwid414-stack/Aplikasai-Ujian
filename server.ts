import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

type StudentStatus = 'WORKING' | 'WARNING' | 'LOCKED' | 'FINISHED' | 'KICKED';

interface AdminRecord {
  uid: string;
  email: string;
  name: string;
  salt: string;
  passwordHash: string;
  createdAt: number;
}

interface ExamSession {
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

interface StudentParticipant {
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

interface PersistedStore {
  admins: Record<string, AdminRecord>;
  sessions: Record<string, ExamSession>;
  tokenIndex: Record<string, string>;
  participants: Record<string, Record<string, StudentParticipant>>;
}

interface AdminTokenPayload {
  role: 'admin';
  uid: string;
  email: string;
  name: string;
  exp: number;
}

interface StudentTokenPayload {
  role: 'student';
  studentId: string;
  sessionId: string;
  exp: number;
}

type AuthTokenPayload = AdminTokenPayload | StudentTokenPayload;

interface AuthenticatedAdminRequest extends Request {
  admin?: AdminTokenPayload;
}

interface AuthenticatedStudentRequest extends Request {
  student?: StudentTokenPayload;
}

interface ClientSubscription {
  ws: WebSocket;
  role: 'admin' | 'student';
  sessionId: string;
  studentId?: string;
}

const PORT = Number(process.env.PORT || 3000);
const STORE_PATH = path.resolve(process.cwd(), '.examshield-store.json');
const RUNTIME_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signToken(payload: AuthTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', RUNTIME_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', RUNTIME_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function createInitialStore(): PersistedStore {
  const demoUid = 'admin_demo_supervisor';
  const demoSessionId = 'session_demo_matematika_xii';
  const demoToken = 'X7K9P2';
  const demoPass = hashPassword(crypto.randomBytes(24).toString('hex'));

  return {
    admins: {
      [demoUid]: {
        uid: demoUid,
        email: 'pengawas@examshield.sch.id',
        name: 'Pengawas Utama',
        salt: demoPass.salt,
        passwordHash: demoPass.hash,
        createdAt: Date.now(),
      },
    },
    sessions: {
      [demoSessionId]: {
        id: demoSessionId,
        subjectName: 'Matematika Wajib - Kelas XII',
        formUrl: 'examshield://sample-math-xii',
        durationMinutes: 90,
        token: demoToken,
        supervisorPin: '4829',
        isActive: true,
        maxViolations: 3,
        createdBy: demoUid,
        createdAt: Date.now(),
      },
    },
    tokenIndex: {
      [demoToken]: demoSessionId,
    },
    participants: {
      [demoSessionId]: {},
    },
  };
}

function loadStore(): PersistedStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedStore;
      if (parsed && parsed.admins && parsed.sessions && parsed.tokenIndex && parsed.participants) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read store, initializing fresh state:', err);
  }
  const initial = createInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(store: PersistedStore): void {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist store:', err);
  }
}

function generateUniqueToken(store: PersistedStore): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let candidate = '';
    for (let i = 0; i < 6; i++) {
      candidate += TOKEN_CHARS[crypto.randomInt(0, TOKEN_CHARS.length)];
    }
    if (!store.tokenIndex[candidate]) {
      return candidate;
    }
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function sanitizeFormUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === 'examshield://sample-math-xii') return trimmed;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

async function startServer() {
  const store = loadStore();
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientSubscription>();

  function sendJson(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function broadcastParticipantUpdate(sessionId: string, participant: StudentParticipant): void {
    for (const client of clients) {
      if (client.sessionId !== sessionId) continue;
      if (client.role === 'admin') {
        sendJson(client.ws, {
          type: 'participant:updated',
          sessionId,
          participant,
        });
      } else if (client.role === 'student' && client.studentId === participant.studentId) {
        sendJson(client.ws, {
          type: 'participant:updated',
          sessionId,
          participant,
        });
      }
    }
  }

  function broadcastSessionUpdate(session: ExamSession): void {
    for (const client of clients) {
      if (client.sessionId === session.id) {
        sendJson(client.ws, {
          type: 'session:updated',
          session,
        });
      }
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      return;
    }

    const token = url.searchParams.get('token') || '';
    const sessionId = url.searchParams.get('sessionId') || '';
    const payload = verifyToken(token);

    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      if (payload.role === 'admin') {
        const session = store.sessions[sessionId];
        if (!session || session.createdBy !== payload.uid) {
          sendJson(ws, { type: 'error', message: 'Akses sesi tidak diizinkan.' });
          ws.close();
          return;
        }
        const sub: ClientSubscription = { ws, role: 'admin', sessionId };
        clients.add(sub);
        sendJson(ws, { type: 'connected', role: 'admin' });
        const list = Object.values(store.participants[sessionId] || {}).sort(
          (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
        );
        sendJson(ws, { type: 'participants:snapshot', sessionId, participants: list });
        ws.on('close', () => clients.delete(sub));
      } else {
        if (payload.sessionId !== sessionId) {
          sendJson(ws, { type: 'error', message: 'Sesi siswa tidak cocok.' });
          ws.close();
          return;
        }
        const sub: ClientSubscription = {
          ws,
          role: 'student',
          sessionId: payload.sessionId,
          studentId: payload.studentId,
        };
        clients.add(sub);
        sendJson(ws, { type: 'connected', role: 'student' });
        const currentParticipant = store.participants[payload.sessionId]?.[payload.studentId];
        if (currentParticipant) {
          sendJson(ws, {
            type: 'participant:updated',
            sessionId: payload.sessionId,
            participant: currentParticipant,
          });
        }
        ws.on('close', () => clients.delete(sub));
      }
    });
  });

  function requireAdmin(req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void {
    const rawToken = extractBearerToken(req);
    if (!rawToken) {
      res.status(401).json({ error: 'Autentikasi Admin diperlukan.' });
      return;
    }
    const payload = verifyToken(rawToken);
    if (!payload || payload.role !== 'admin') {
      res.status(401).json({ error: 'Token Admin tidak valid atau kedaluwarsa.' });
      return;
    }
    req.admin = payload;
    next();
  }

  function requireStudent(req: AuthenticatedStudentRequest, res: Response, next: NextFunction): void {
    const rawToken = extractBearerToken(req);
    if (!rawToken) {
      res.status(401).json({ error: 'Sesi siswa tidak ditemukan.' });
      return;
    }
    const payload = verifyToken(rawToken);
    if (!payload || payload.role !== 'student') {
      res.status(401).json({ error: 'Token sesi siswa tidak valid.' });
      return;
    }
    req.student = payload;
    next();
  }

  // --- AUTH ROUTES ---
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };

    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPassword = password || '';

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Nama lengkap minimal 2 karakter.' });
      return;
    }
    if (!cleanEmail.includes('@') || cleanEmail.length < 5) {
      res.status(400).json({ error: 'Format email tidak valid.' });
      return;
    }
    if (rawPassword.length < 6) {
      res.status(400).json({ error: 'Password minimal 6 karakter.' });
      return;
    }

    const exists = Object.values(store.admins).some((a) => a.email === cleanEmail);
    if (exists) {
      res.status(409).json({ error: 'Email sudah terdaftar sebagai Admin / Pengawas.' });
      return;
    }

    const uid = `admin_${crypto.randomUUID()}`;
    const { salt, hash } = hashPassword(rawPassword);
    const adminRecord: AdminRecord = {
      uid,
      email: cleanEmail,
      name: cleanName,
      salt,
      passwordHash: hash,
      createdAt: Date.now(),
    };
    store.admins[uid] = adminRecord;
    saveStore(store);

    const token = signToken({
      role: 'admin',
      uid,
      email: cleanEmail,
      name: cleanName,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      admin: { uid, email: cleanEmail, name: cleanName },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPassword = password || '';

    if (!cleanEmail || !rawPassword) {
      res.status(400).json({ error: 'Email dan password wajib diisi.' });
      return;
    }

    const admin = Object.values(store.admins).find((a) => a.email === cleanEmail);
    if (!admin || !verifyPassword(rawPassword, admin.salt, admin.passwordHash)) {
      res.status(401).json({ error: 'Email atau password pengawas salah.' });
      return;
    }

    const token = signToken({
      role: 'admin',
      uid: admin.uid,
      email: admin.email,
      name: admin.name,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      admin: { uid: admin.uid, email: admin.email, name: admin.name },
    });
  });

  app.post('/api/auth/demo-supervisor', (_req, res) => {
    const demoAdmin = store.admins['admin_demo_supervisor'];
    if (!demoAdmin) {
      res.status(404).json({ error: 'Akun demo tidak tersedia.' });
      return;
    }

    const token = signToken({
      role: 'admin',
      uid: demoAdmin.uid,
      email: demoAdmin.email,
      name: demoAdmin.name,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      admin: { uid: demoAdmin.uid, email: demoAdmin.email, name: demoAdmin.name },
    });
  });

  app.get('/api/auth/me', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    res.json({ admin: { uid: admin.uid, email: admin.email, name: admin.name } });
  });

  // --- ADMIN ROUTES ---
  app.get('/api/admin/sessions', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const list = Object.values(store.sessions)
      .filter((s) => s.createdBy === admin.uid)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ sessions: list });
  });

  app.post('/api/admin/sessions', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const { subjectName, formUrl, durationMinutes, supervisorPin, maxViolations } = req.body as {
      subjectName?: string;
      formUrl?: string;
      durationMinutes?: number;
      supervisorPin?: string;
      maxViolations?: number;
    };

    const cleanSubject = (subjectName || '').trim();
    const cleanUrl = sanitizeFormUrl(formUrl || '');
    const duration = Number(durationMinutes || 0);
    const pin = (supervisorPin || '').trim();
    const maxV = Math.min(Math.max(Number(maxViolations || 3), 1), 10);

    if (cleanSubject.length < 2) {
      res.status(400).json({ error: 'Nama mata pelajaran wajib diisi.' });
      return;
    }
    if (
      cleanUrl !== 'examshield://sample-math-xii' &&
      !cleanUrl.includes('docs.google.com/forms') &&
      !cleanUrl.includes('forms.gle')
    ) {
      res.status(400).json({
        error: 'Masukkan link Google Form yang valid atau gunakan Soal Simulasi ExamShield.',
      });
      return;
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) {
      res.status(400).json({ error: 'Durasi ujian harus antara 1 sampai 600 menit.' });
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      res.status(400).json({ error: 'PIN Pengawas harus 4 sampai 6 digit angka.' });
      return;
    }

    const token = generateUniqueToken(store);
    const sessionId = `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const session: ExamSession = {
      id: sessionId,
      subjectName: cleanSubject,
      formUrl: cleanUrl,
      durationMinutes: duration,
      token,
      supervisorPin: pin,
      isActive: true,
      maxViolations: maxV,
      createdBy: admin.uid,
      createdAt: Date.now(),
    };

    store.sessions[sessionId] = session;
    store.tokenIndex[token] = sessionId;
    store.participants[sessionId] = {};
    saveStore(store);

    res.status(201).json({ session });
  });

  app.patch('/api/admin/sessions/:sessionId/toggle', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const { sessionId } = req.params;
    const { isActive } = req.body as { isActive?: boolean };
    const session = store.sessions[sessionId];

    if (!session || session.createdBy !== admin.uid) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    session.isActive = Boolean(isActive);
    saveStore(store);
    broadcastSessionUpdate(session);
    res.json({ session });
  });

  app.get('/api/admin/sessions/:sessionId/participants', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const { sessionId } = req.params;
    const session = store.sessions[sessionId];

    if (!session || session.createdBy !== admin.uid) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    const participants = Object.values(store.participants[sessionId] || {}).sort(
      (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
    );
    res.json({ participants });
  });

  app.post('/api/admin/participants/reset', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const { sessionId, studentId } = req.body as { sessionId?: string; studentId?: string };

    if (!sessionId || !studentId) {
      res.status(400).json({ error: 'sessionId dan studentId wajib diisi.' });
      return;
    }

    const session = store.sessions[sessionId];
    if (!session || session.createdBy !== admin.uid) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    const participant = store.participants[sessionId]?.[studentId];
    if (!participant) {
      res.status(404).json({ error: 'Peserta tidak ditemukan.' });
      return;
    }

    participant.isLocked = false;
    participant.isKicked = false;
    participant.violationCount = 0;
    participant.lastViolationReason = '';
    participant.status = 'WORKING';
    participant.lastUpdatedAt = Date.now();

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);
    res.json({ participant });
  });

  app.post('/api/admin/participants/kick', requireAdmin, (req: AuthenticatedAdminRequest, res) => {
    const admin = req.admin!;
    const { sessionId, studentId } = req.body as { sessionId?: string; studentId?: string };

    if (!sessionId || !studentId) {
      res.status(400).json({ error: 'sessionId dan studentId wajib diisi.' });
      return;
    }

    const session = store.sessions[sessionId];
    if (!session || session.createdBy !== admin.uid) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    const participant = store.participants[sessionId]?.[studentId];
    if (!participant) {
      res.status(404).json({ error: 'Peserta tidak ditemukan.' });
      return;
    }

    participant.isKicked = true;
    participant.isLocked = false;
    participant.status = 'KICKED';
    participant.lastUpdatedAt = Date.now();

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);
    res.json({ participant });
  });

  // --- STUDENT ROUTES ---
  app.post('/api/student/join', (req, res) => {
    const { token, fullName, nis } = req.body as {
      token?: string;
      fullName?: string;
      nis?: string;
    };

    const normalizedToken = (token || '').trim().toUpperCase();
    const cleanName = (fullName || '').trim();
    const cleanNis = (nis || '').trim();

    if (cleanName.length < 2 || cleanNis.length < 2 || normalizedToken.length !== 6) {
      res.status(400).json({ error: 'Lengkapi Nama Lengkap, NIS, dan Token 6 digit.' });
      return;
    }

    const sessionId = store.tokenIndex[normalizedToken];
    if (!sessionId) {
      res.status(404).json({ error: `Token ujian '${normalizedToken}' tidak ditemukan.` });
      return;
    }

    const session = store.sessions[sessionId];
    if (!session) {
      res.status(404).json({ error: 'Data sesi ujian tidak ditemukan.' });
      return;
    }

    if (!session.isActive) {
      res.status(403).json({ error: 'Token ujian sedang NONAKTIF. Hubungi pengawas.' });
      return;
    }

    if (!store.participants[sessionId]) {
      store.participants[sessionId] = {};
    }

    const studentId = `student_${cleanNis.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const existing = store.participants[sessionId][studentId];
    const now = Date.now();

    let participant: StudentParticipant;
    if (existing) {
      if (existing.isKicked || existing.status === 'KICKED') {
        res.status(403).json({ error: 'Anda telah dikeluarkan oleh pengawas dari sesi ujian ini.' });
        return;
      }
      if (existing.status === 'FINISHED') {
        res.status(403).json({ error: 'Anda telah menyelesaikan ujian pada sesi ini.' });
        return;
      }
      participant = {
        ...existing,
        fullName: cleanName,
        nis: cleanNis,
        lastUpdatedAt: now,
      };
      store.participants[sessionId][studentId] = participant;
    } else {
      participant = {
        studentId,
        sessionId,
        fullName: cleanName,
        nis: cleanNis,
        status: 'WORKING',
        violationCount: 0,
        lastViolationReason: '',
        isLocked: false,
        isKicked: false,
        joinedAt: now,
        lastUpdatedAt: now,
      };
      store.participants[sessionId][studentId] = participant;
    }

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);

    const studentAuthToken = signToken({
      role: 'student',
      studentId,
      sessionId,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    const safeSession = {
      id: session.id,
      subjectName: session.subjectName,
      formUrl: session.formUrl,
      durationMinutes: session.durationMinutes,
      token: session.token,
      isActive: session.isActive,
      maxViolations: session.maxViolations,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      supervisorPin: '',
    };

    res.json({
      studentAuthToken,
      session: safeSession,
      participant,
    });
  });

  app.get('/api/student/state', requireStudent, (req: AuthenticatedStudentRequest, res) => {
    const { sessionId, studentId } = req.student!;
    const session = store.sessions[sessionId];
    const participant = store.participants[sessionId]?.[studentId];

    if (!session || !participant) {
      res.status(404).json({ error: 'Data sesi ujian tidak ditemukan.' });
      return;
    }

    res.json({
      session: {
        ...session,
        supervisorPin: '',
      },
      participant,
    });
  });

  app.post('/api/student/violation', requireStudent, (req: AuthenticatedStudentRequest, res) => {
    const { sessionId, studentId } = req.student!;
    const { reason } = req.body as { reason?: string };

    const session = store.sessions[sessionId];
    const participant = store.participants[sessionId]?.[studentId];
    if (!session || !participant) {
      res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
      return;
    }

    if (participant.status === 'FINISHED' || participant.isKicked) {
      res.json({ participant });
      return;
    }

    const now = Date.now();
    // Server-side debounce safeguard (1.5s) in addition to client 2s debounce
    if (participant.isLocked && now - participant.lastUpdatedAt < 1500) {
      res.json({ participant });
      return;
    }

    const newCount = participant.violationCount + 1;
    const newStatus: StudentStatus = newCount >= session.maxViolations ? 'LOCKED' : 'WARNING';

    participant.violationCount = newCount;
    participant.status = newStatus;
    participant.lastViolationReason = (reason || 'Meninggalkan layar ujian').slice(0, 200);
    participant.isLocked = true;
    participant.lastUpdatedAt = now;

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);
    res.json({ participant });
  });

  app.post('/api/student/unlock', requireStudent, (req: AuthenticatedStudentRequest, res) => {
    const { sessionId, studentId } = req.student!;
    const { pin } = req.body as { pin?: string };

    const session = store.sessions[sessionId];
    const participant = store.participants[sessionId]?.[studentId];
    if (!session || !participant) {
      res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
      return;
    }

    if (participant.violationCount >= session.maxViolations || participant.status === 'LOCKED') {
      res.status(403).json({
        error: 'Batas pelanggaran terlampaui. Hanya Admin yang dapat mereset status Anda.',
      });
      return;
    }

    if ((pin || '').trim() !== session.supervisorPin) {
      res.status(403).json({ error: 'PIN Pengawas salah!' });
      return;
    }

    participant.isLocked = false;
    participant.status = 'WORKING';
    participant.lastUpdatedAt = Date.now();

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);
    res.json({ participant });
  });

  app.post('/api/student/finish', requireStudent, (req: AuthenticatedStudentRequest, res) => {
    const { sessionId, studentId } = req.student!;
    const { pin } = req.body as { pin?: string };

    const session = store.sessions[sessionId];
    const participant = store.participants[sessionId]?.[studentId];
    if (!session || !participant) {
      res.status(404).json({ error: 'Data peserta tidak ditemukan.' });
      return;
    }

    if ((pin || '').trim() !== session.supervisorPin) {
      res.status(403).json({ error: 'PIN Keluar salah! Minta PIN dari pengawas.' });
      return;
    }

    participant.isLocked = false;
    participant.status = 'FINISHED';
    participant.lastUpdatedAt = Date.now();

    saveStore(store);
    broadcastParticipantUpdate(sessionId, participant);
    res.json({ participant });
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ExamShield server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ExamShield server:', err);
  process.exit(1);
});
