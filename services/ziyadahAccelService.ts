// services/ziyadahAccelService.ts
// Layanan Komunikasi RPC, Dukungan Akun Bersama + PIN, & Manajemen Draft Lokal Ujian Ziyadah Akselerasi
// SITA — Darul Abror Islamic Boarding School

import {
  User,
  ZiyadahAccelAbsenceReason,
  ZiyadahAccelCoordinatorDelegation,
  ZiyadahAccelEvent,
  ZiyadahAccelFulfillmentStatus,
  ZiyadahAccelRangeItem,
  ZiyadahAccelSession,
  ZiyadahAccelSessionExaminer,
  ZiyadahAccelWorkspaceData
} from '../types';
import { supabase, safeGetLocalStorage, safeSetLocalStorage } from '../api';

const DRAFT_PREFIX = 'sita_za_examiner_draft_v1_';

export interface ExaminerFormLocalDraft {
  sessionId: string;
  participantId: string;
  fulfillmentStatus: ZiyadahAccelFulfillmentStatus;
  absenceReason?: ZiyadahAccelAbsenceReason;
  confirmedPagesInput: string;
  scoreInput: string;
  examinerNotes: string;
  ranges: Array<{
    juzNumber: number;
    surahNumber: number;
    ayahStart: number;
    ayahEnd: number;
  }>;
  savedAt: string;
  lastError?: string | null;
}

function getAuthCredentials(user: User | null | undefined): { username: string; password: string } | null {
  if (!user || !user.username) return null;
  const cred = user.sessionToken || user.password || '';
  if (!cred) return null;
  return { username: user.username, password: cred };
}

async function runRpcWithTimeout<T = any>(
  rpcPromise: PromiseLike<{ data: T | null; error: any }>,
  timeoutMs: number = 15000,
  timeoutMessage: string = 'Waktu koneksi ke server habis (timeout). Periksa jaringan internet Anda lalu coba lagi.'
): Promise<{ data: T | null; error: any }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ data: T | null; error: any }>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        data: null,
        error: { message: timeoutMessage, isTimeout: true }
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(rpcPromise), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function generateIdempotencyKey(prefix: string = 'za_idem'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export type ZaRpcErrorCategory =
  | 'MIGRATION_MISSING'
  | 'RPC_NOT_FOUND'
  | 'RPC_PARAM_MISMATCH'
  | 'DB_DISCONNECTED'
  | 'PROXY_ERROR'
  | 'AUTH_FAILED'
  | 'ACCESS_DENIED'
  | 'EXECUTION_ERROR';

export function classifyZaRpcError(err: any): {
  category: ZaRpcErrorCategory;
  isMigrationMissing: boolean;
  userMessage: string;
} {
  const rawMsg = String(err?.message || err?.details || err || '').trim();
  const msg = rawMsg.toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  const status = Number(err?.status || err?.statusCode || 0);

  // 1. Proxy / endpoint salah (mengembalikan HTML bukan JSON PostgREST)
  if (
    msg.includes('<!doctype') ||
    msg.includes('<html') ||
    msg.includes("unexpected token '<'") ||
    code === 'PROXY_MISCONFIGURED'
  ) {
    return {
      category: 'PROXY_ERROR',
      isMigrationMissing: false,
      userMessage:
        'Endpoint database mengembalikan halaman HTML, bukan respons JSON RPC. Periksa konfigurasi URL Supabase.'
    };
  }

  // 2. Database tidak terhubung / jaringan terputus / timeout
  if (
    err?.isTimeout ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('bad gateway') ||
    msg.includes('waktu koneksi ke server habis')
  ) {
    return {
      category: 'DB_DISCONNECTED',
      isMigrationMissing: false,
      userMessage: `Database tidak terhubung atau jaringan terputus (${rawMsg || 'koneksi gagal'}).`
    };
  }

  // 3. Kesalahan nama atau tipe parameter RPC
  if (
    code === 'RPC_PARAM_MISMATCH' ||
    msg.includes('perhaps you meant to call the function') ||
    (msg.includes('za_') && (msg.includes('parameter') || msg.includes('argument')))
  ) {
    return {
      category: 'RPC_PARAM_MISMATCH',
      isMigrationMissing: false,
      userMessage: `Kesalahan parameter pemanggilan RPC: ${rawMsg}`
    };
  }

  // 4. Autentikasi gagal / sesi login tidak cocok lingkungan
  if (code === 'AUTH_INVALID' || status === 401 || msg.includes('sesi login tidak valid')) {
    return {
      category: 'AUTH_FAILED',
      isMigrationMissing: false,
      userMessage:
        'Autentikasi sesi gagal atau tidak sesuai lingkungan database. Silakan keluar (Logout) lalu masuk kembali.'
    };
  }

  // 5. Hak akses ditolak
  if (
    code === 'ACCESS_DENIED' ||
    code === 'ROLE_DENIED' ||
    code === '42501' ||
    status === 403 ||
    msg.includes('permission denied')
  ) {
    return {
      category: 'ACCESS_DENIED',
      isMigrationMissing: false,
      userMessage: `Hak akses database ditolak: ${rawMsg}`
    };
  }

  // 6. RPC tidak ditemukan vs Migrasi belum tersedia
  const isMissingFn =
    msg.includes('za_') &&
    (code === 'PGRST202' ||
      code === '42883' ||
      msg.includes('could not find the function') ||
      msg.includes('does not exist'));

  if (isMissingFn) {
    return {
      category: 'MIGRATION_MISSING',
      isMigrationMissing: true,
      userMessage: 'Skema database Ziyadah Akselerasi belum diaktifkan pada server Supabase.'
    };
  }

  return {
    category: 'EXECUTION_ERROR',
    isMigrationMissing: false,
    userMessage: rawMsg || 'Terjadi kesalahan saat memanggil RPC database.'
  };
}

export const ziyadahAccelService = {
  // =========================================================================
  // DRAFT LOKAL FORM PENGUJI (HANYA DISIMPAN SAAT DIRTY / GAGAL KIRIM — B-05)
  // =========================================================================
  getDraftKey(actorId: string, sessionId: string, participantId: string): string {
    return `${DRAFT_PREFIX}${actorId}_${sessionId}_${participantId}`;
  },

  saveLocalDraft(actorId: string, draft: ExaminerFormLocalDraft): void {
    if (!actorId || !draft.sessionId || !draft.participantId) return;
    safeSetLocalStorage(
      this.getDraftKey(actorId, draft.sessionId, draft.participantId),
      JSON.stringify(draft)
    );
  },

  loadLocalDraft(
    actorId: string,
    sessionId: string,
    participantId: string
  ): ExaminerFormLocalDraft | null {
    if (!actorId || !sessionId || !participantId) return null;
    const raw = safeGetLocalStorage(this.getDraftKey(actorId, sessionId, participantId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExaminerFormLocalDraft;
    } catch {
      return null;
    }
  },

  clearLocalDraft(actorId: string, sessionId: string, participantId: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(this.getDraftKey(actorId, sessionId, participantId));
    } catch {}
  },

  /**
   * Mengembalikan himpunan participantId pada sesi terpilih yang memiliki draft lokal
   * yang BELUM tersimpan ke server, agar kartu antrean menampilkan peringatan jelas.
   */
  getPendingDraftParticipantIds(actorId: string, sessionId: string): Set<string> {
    const result = new Set<string>();
    if (typeof window === 'undefined' || !actorId || !sessionId) return result;
    const prefix = `${DRAFT_PREFIX}${actorId}_${sessionId}_`;
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const partId = k.slice(prefix.length);
          if (partId) result.add(partId);
        }
      }
    } catch {}
    return result;
  },

  // =========================================================================
  // PEMANGGILAN RPC OTORITATIF SERVER (*_secure)
  // =========================================================================
  async getAccessContext(user: User): Promise<{
    success: boolean;
    migrationPending?: boolean;
    userId?: string;
    actorName?: string;
    isSharedAccount?: boolean;
    pinRequired?: boolean;
    isPinExpired?: boolean;
    verifiedExaminer?: { teacherId: string; teacherName: string } | null;
    isCoordinator?: boolean;
    assignedSessionCount?: number;
    canShowMenu?: boolean;
    coordinators?: ZiyadahAccelCoordinatorDelegation[];
    message?: string;
  }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) {
      return {
        success: true,
        isCoordinator: user?.role === 'admin',
        assignedSessionCount: 0,
        canShowMenu: user?.role === 'admin',
        coordinators: []
      };
    }

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_get_access_context_secure', {
        p_username: creds.username,
        p_password: creds.password
      })
    );

    if (error) {
      const diag = classifyZaRpcError(error);
      if (diag.isMigrationMissing) {
        return {
          success: true,
          migrationPending: true,
          isCoordinator: user.role === 'admin',
          assignedSessionCount: 0,
          canShowMenu: user.role === 'admin',
          coordinators: [],
          message: diag.userMessage
        };
      }
      return {
        success: false,
        migrationPending: false,
        canShowMenu: user.role === 'admin',
        message: `[${diag.category}] ${diag.userMessage}`
      };
    }

    if (data && data.success === false && data.errorCode) {
      return {
        ...data,
        migrationPending: false,
        canShowMenu: user.role === 'admin',
        message: `[${data.errorCode}] ${data.message || 'Gagal memverifikasi konteks akses.'}`
      };
    }

    return data || { success: false, canShowMenu: user.role === 'admin', message: 'Respons server kosong.' };
  },

  async manageCoordinator(
    user: User,
    targetUserId: string,
    isActive: boolean,
    notes?: string
  ): Promise<{ success: boolean; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) {
      return { success: false, message: 'Sesi login atau koneksi Supabase tidak tersedia.' };
    }

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_manage_coordinator_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_target_user_id: targetUserId,
        p_is_active: isActive,
        p_notes: notes || null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal menyimpan hak Koordinator.' };
  },

  async listEvents(user: User): Promise<{
    success: boolean;
    migrationPending?: boolean;
    errorCode?: string;
    pinRequired?: boolean;
    isCoordinator?: boolean;
    actorUserId?: string;
    actorName?: string;
    isSharedAccount?: boolean;
    events?: ZiyadahAccelEvent[];
    message?: string;
  }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) {
      return { success: false, message: 'Sesi login tidak ditemukan. Silakan login ulang.' };
    }

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_list_events_secure', {
        p_username: creds.username,
        p_password: creds.password
      })
    );

    if (error) {
      const diag = classifyZaRpcError(error);
      if (diag.isMigrationMissing) {
        return {
          success: true,
          migrationPending: true,
          isCoordinator: user.role === 'admin',
          events: [],
          message: diag.userMessage
        };
      }
      return { success: false, migrationPending: false, errorCode: diag.category, message: `[${diag.category}] ${diag.userMessage}` };
    }

    return data || { success: false, message: 'Gagal memuat daftar kegiatan.' };
  },

  async upsertEvent(
    user: User,
    eventPayload: Partial<ZiyadahAccelEvent>
  ): Promise<{ success: boolean; eventId?: string; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) {
      return { success: false, message: 'Sesi login tidak valid.' };
    }

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_upsert_event_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_event: eventPayload
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal menyimpan kegiatan.' };
  },

  async enrollParticipants(
    user: User,
    eventId: string,
    items: Array<{
      studentId: string;
      directionHint?: string;
      baselineSurah?: number | null;
      baselineAyah?: number | null;
      baselinePage?: number | null;
      baselineLabel?: string | null;
    }>
  ): Promise<{ success: boolean; addedCount?: number; skippedCount?: number; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) {
      return { success: false, message: 'Sesi login tidak valid.' };
    }

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_enroll_participants_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_event_id: eventId,
        p_items: items
      }),
      20000
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal mendaftarkan peserta.' };
  },

  async updateParticipantStatus(
    user: User,
    participantId: string,
    status: 'active' | 'withdrawn',
    reason?: string
  ): Promise<{ success: boolean; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_update_participant_status_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_participant_id: participantId,
        p_status: status,
        p_reason: reason || null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal memperbarui status peserta.' };
  },

  async upsertSession(
    user: User,
    sessionPayload: Partial<ZiyadahAccelSession> & { eventId: string },
    examiners: ZiyadahAccelSessionExaminer[]
  ): Promise<{ success: boolean; sessionId?: string; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_upsert_session_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_session: sessionPayload,
        p_examiners: examiners
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal menyimpan sesi ujian.' };
  },

  async setSessionStatus(
    user: User,
    sessionId: string,
    status: ZiyadahAccelSession['status'],
    reason?: string
  ): Promise<{ success: boolean; status?: string; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_set_session_status_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_session_id: sessionId,
        p_status: status,
        p_reason: reason || null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal mengubah status sesi.' };
  },

  async reorderQueue(
    user: User,
    sessionId: string,
    orders: Array<{
      participantId: string;
      queueOrder: number;
      assignedExaminerId?: string | null;
      groupLabel?: string | null;
    }>,
    regularQueueOffset?: number,
    examinerOffsets?: Array<{
      examinerUserId: string;
      groupLabel?: string | null;
      regularQueueOffset: number;
      regularFinishConfirmed?: boolean;
    }>
  ): Promise<{ success: boolean; message?: string }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const payload =
      examinerOffsets && examinerOffsets.length > 0
        ? { orders, examinerOffsets }
        : orders;

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_reorder_queue_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_session_id: sessionId,
        p_orders: payload,
        p_regular_offset: regularQueueOffset ?? null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal menyimpan urutan giliran.' };
  },

  async confirmRegularQueueDone(params: {
    user: User;
    sessionId: string;
    examinerUserId: string;
    confirmed: boolean;
    regularQueueOffset?: number;
  }): Promise<{ success: boolean; message?: string }> {
    const creds = getAuthCredentials(params.user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_reorder_queue_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_session_id: params.sessionId,
        p_orders: {
          action: 'confirm_regular_done',
          examinerUserId: params.examinerUserId,
          confirmed: params.confirmed,
          regularQueueOffset: params.regularQueueOffset
        },
        p_regular_offset: null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal memperbarui status antrean majelis.' };
  },

  async getEventWorkspace(
    user: User,
    eventId: string
  ): Promise<{
    success: boolean;
    errorCode?: string;
    pinRequired?: boolean;
    workspace?: ZiyadahAccelWorkspaceData;
    message?: string;
  }> {
    const creds = getAuthCredentials(user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_get_event_workspace_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_event_id: eventId
      }),
      20000
    );

    if (error) return { success: false, message: error.message };
    if (!data || !data.success) {
      return {
        success: false,
        errorCode: data?.errorCode,
        pinRequired: Boolean(data?.pinRequired),
        message: data?.message || 'Gagal memuat data kegiatan.'
      };
    }

    return {
      success: true,
      workspace: {
        isCoordinator: Boolean(data.isCoordinator),
        actorUserId: data.actorUserId,
        actorName: data.actorName,
        isSharedAccount: Boolean(data.isSharedAccount),
        event: data.event,
        participants: data.participants || [],
        sessions: data.sessions || [],
        sessionExaminers: data.sessionExaminers || [],
        submissions: data.submissions || [],
        finalSnapshot: data.finalSnapshot || null,
        auditLogs: data.auditLogs || []
      }
    };
  },

  async submitSetoran(params: {
    user: User;
    sessionId: string;
    participantId: string;
    fulfillmentStatus: ZiyadahAccelFulfillmentStatus;
    confirmedPages?: number | null;
    systemSuggestedPages?: number | null;
    score?: number | null;
    absenceReason?: ZiyadahAccelAbsenceReason | null;
    examinerNotes?: string | null;
    correctionReason?: string | null;
    ranges?: ZiyadahAccelRangeItem[];
    clientFlags?: string[];
    expectedVersion?: number | null;
    idempotencyKey: string;
  }): Promise<{
    success: boolean;
    errorCode?: string;
    pinRequired?: boolean;
    submissionId?: string;
    version?: number;
    verificationStatus?: string;
    verificationFlags?: string[];
    approvedUniquePages?: number | null;
    recordedByName?: string;
    isTimeout?: boolean;
    message?: string;
  }> {
    const creds = getAuthCredentials(params.user);
    if (!creds || !supabase) {
      return { success: false, message: 'Sesi login tidak valid. Silakan login kembali.' };
    }

    const rpcPayload = {
      sessionId: params.sessionId,
      participantId: params.participantId,
      fulfillmentStatus: params.fulfillmentStatus,
      confirmedPages: params.confirmedPages ?? null,
      systemSuggestedPages: params.systemSuggestedPages ?? null,
      score: params.score ?? null,
      absenceReason: params.absenceReason ?? null,
      examinerNotes: params.examinerNotes ?? null,
      correctionReason: params.correctionReason ?? null,
      ranges: params.ranges ?? [],
      clientFlags: params.clientFlags ?? []
    };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_submit_setoran_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_payload: rpcPayload,
        p_expected_version: params.expectedVersion ?? null,
        p_idempotency_key: params.idempotencyKey
      }),
      15000,
      'Jaringan lambat atau terputus saat menyimpan setoran. Draft Anda tetap aman di perangkat — klik Simpan kembali untuk mencoba ulang secara aman (idempotent).'
    );

    if (error) {
      return {
        success: false,
        isTimeout: Boolean(error.isTimeout),
        message: error.message
      };
    }

    return data || { success: false, message: 'Respons server kosong.' };
  },

  async verifySubmission(params: {
    user: User;
    submissionId: string;
    decision: 'approve' | 'reject';
    approvedUniquePages?: number | null;
    correctedScore?: number | null;
    note?: string;
  }): Promise<{ success: boolean; verificationStatus?: string; message?: string }> {
    const creds = getAuthCredentials(params.user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_verify_submission_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_submission_id: params.submissionId,
        p_decision: params.decision,
        p_approved_unique_pages: params.approvedUniquePages ?? null,
        p_corrected_score: params.correctedScore ?? null,
        p_note: params.note || null
      })
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal memverifikasi setoran.' };
  },

  async finalizeOrReopenEvent(params: {
    user: User;
    eventId: string;
    action: 'finalize' | 'reopen';
    reason?: string;
    snapshot?: {
      summary: any;
      studentRows: any[];
      sessionMatrix: any[];
    };
  }): Promise<{ success: boolean; status?: string; message?: string }> {
    const creds = getAuthCredentials(params.user);
    if (!creds || !supabase) return { success: false, message: 'Sesi login tidak valid.' };

    const { data, error } = await runRpcWithTimeout(
      supabase.rpc('za_finalize_or_reopen_event_secure', {
        p_username: creds.username,
        p_password: creds.password,
        p_event_id: params.eventId,
        p_action: params.action,
        p_reason: params.reason || null,
        p_snapshot: params.snapshot || null
      }),
      20000
    );

    if (error) return { success: false, message: error.message };
    return data || { success: false, message: 'Gagal memproses finalisasi kegiatan.' };
  }
};
