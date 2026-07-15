import axios from 'axios';

export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const CSRF_COOKIE_NAME = 'csrf_token';
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.substring(name.length + 1)) : null;
}

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const method = config.method?.toLowerCase();
  if (method && UNSAFE_METHODS.has(method)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRF-Token'] = csrfToken;
    }
  }

  // Tüm isteklere seçili klinik filtresi ekle (GET listesi + mutation'lar)
  // Backend bu değeri doğrular; "all" gönderilmez — backend varsayılanı kullanır
  const selectedClinicId = localStorage.getItem('hcrm_clinic_id');
  if (selectedClinicId && selectedClinicId !== 'all' && !config.params?.clinicId) {
    config.params = { ...config.params, clinicId: selectedClinicId };
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error.config?.url ?? '');
    const isAuthProbe = url === '/auth/me' || url === '/auth/login' || url === '/auth/logout' || url === '/auth/csrf';
    if (error.response && error.response.status === 401 && !isAuthProbe) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export const authService = {
  login: (credentials: any) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
  csrf: () => api.get('/auth/csrf'),
  logout: () => api.post('/auth/logout'),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data),
  forgotPassword: (data: { email: string }) =>
    api.post('/auth/forgot-password', data),
  resetPassword: (data: { token: string; newPassword: string }) =>
    api.post('/auth/reset-password', data),
  verifyEmail: (data: { token: string }) =>
    api.post('/auth/verify-email', data),
  resendVerification: (data: { email: string }) =>
    api.post('/auth/resend-verification', data),
};

export const patientService = {
  getAll: (params?: any) => api.get('/patients', { params }),
  getById: (id: string) => api.get(`/patients/${id}`),
  create: (data: any) => api.post('/patients', data),
  update: (id: string, data: any) => api.put(`/patients/${id}`, data),
  archive: (id: string) => api.delete(`/patients/${id}`),
  unarchive: (id: string) => api.post(`/patients/${id}/unarchive`),
  checkPhoneDuplicate: (params: { phone: string; clinicId?: string; excludePatientId?: string }) =>
    api.get('/patients/check-phone-duplicate', { params }),
  downloadImportTemplate: (clinicId?: string) =>
    api.get('/patients/import-template', {
      responseType: 'blob',
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
    }),
  importPreview: (file: File, clinicId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/patients/import-preview', fd, {
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importConfirm: (file: File, clinicId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/patients/import-confirm', fd, {
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const patientPrivacyService = {
  exportData: (patientId: string) =>
    api.post(`/patients/${patientId}/privacy/export`),
  anonymize: (patientId: string, reason: string) =>
    api.post(`/patients/${patientId}/privacy/anonymize`, { confirm: true, reason }),
  listRequests: (patientId: string) =>
    api.get(`/patients/${patientId}/privacy/requests`),
  createRequest: (patientId: string, data: { requestType: string; requestNote?: string }) =>
    api.post(`/patients/${patientId}/privacy/requests`, data),
  updateRequestStatus: (requestId: string, status: string, decisionNote?: string) =>
    api.patch(`/privacy-requests/${requestId}/status`, { status, decisionNote }),
  // KVKK lifecycle (docs/compliance/53): downloadable ZIP export package.
  createExportPackage: (patientId: string) =>
    api.post(`/patients/${patientId}/privacy/export-package`),
  downloadExportPackage: (patientId: string, exportId: string, token: string) =>
    api.get(`/patients/${patientId}/privacy/export-package/${exportId}/download`, {
      params: { token },
      responseType: 'blob',
    }),
  getDeletionReview: (patientId: string) =>
    api.get(`/patients/${patientId}/privacy/deletion-review`),
  executeDeletionReview: (patientId: string, reason: string) =>
    api.post(`/patients/${patientId}/privacy/deletion-review/execute`, { confirm: true, reason }),
  getOrphanCheck: (patientId: string) =>
    api.get(`/patients/${patientId}/privacy/orphan-check`),
};

export const appointmentTypeService = {
  getAll: (onlyActive = false) => api.get('/appointment-types', { params: { onlyActive } }),
  create: (data: any) => api.post('/appointment-types', data),
  update: (id: string, data: any) => api.put(`/appointment-types/${id}`, data),
};

export const serviceService = {
  getAll: (params?: { onlyActive?: boolean, includeInactive?: boolean }) => api.get('/services', { params }),
  create: (data: any) => api.post('/services', data),
  update: (id: string, data: any) => api.put(`/services/${id}`, data),
  getMaterials: (id: string) => api.get(`/services/${id}/materials`),
  replaceMaterials: (id: string, materials: any[]) => api.put(`/services/${id}/materials`, { materials }),
  addMaterial: (id: string, data: any) => api.post(`/services/${id}/materials`, data),
  updateMaterial: (id: string, materialId: string, data: any) => api.put(`/services/${id}/materials/${materialId}`, data),
  removeMaterial: (id: string, materialId: string) => api.delete(`/services/${id}/materials/${materialId}`),
};

export const treatmentPackageService = {
  getAll: (params?: { includeInactive?: boolean; onlyActive?: boolean; search?: string }) => api.get('/treatment-packages', { params }),
  getById: (id: string) => api.get(`/treatment-packages/${id}`),
  create: (data: any) => api.post('/treatment-packages', data),
  update: (id: string, data: any) => api.put(`/treatment-packages/${id}`, data),
  deactivate: (id: string) => api.delete(`/treatment-packages/${id}`),
};

export const appointmentService = {
  getAll: (params?: any) => api.get('/appointments', { params }),
  getAvailableSlots: (params: { doctorId: string; serviceId: string; date: string; clinicId?: string; excludeAppointmentId?: string }) =>
    api.get('/appointments/available-slots', { params }),
  getById: (id: string) => api.get(`/appointments/${id}`),
  create: (data: any) => api.post('/appointments', data),
  update: (id: string, data: any) => api.put(`/appointments/${id}`, data),
  updateStatus: (id: string, status: string) => api.put(`/appointments/${id}`, { status }),
  linkTreatmentCase: (id: string, treatmentCaseId: string | null) =>
    api.patch(`/appointments/${id}/treatment-case`, { treatmentCaseId }),
};

export const appointmentRequestService = {
  getAll: (params?: any) => api.get('/appointment-requests', { params }),
  getCounts: (params?: { clinicId?: string }) => api.get('/appointment-requests/counts', { params }),
  update: (id: string, data: any) => api.put(`/appointment-requests/${id}`, data),
  updateStatus: (id: string, data: any) => api.put(`/appointment-requests/${id}/status`, data),
  convert: (id: string, data?: any) => api.post(`/appointment-requests/${id}/convert`, data || {}),
};

export const contactRequestService = {
  getAll: (params?: any) => api.get('/contact-requests', { params }),
  getById: (id: string) => api.get(`/contact-requests/${id}`),
  getCounts: () => api.get('/contact-requests/counts'),
  updateStatus: (id: string, status: string) => api.patch(`/contact-requests/${id}/status`, { status }),
  assign: (id: string, assignedToId: string | null) => api.patch(`/contact-requests/${id}/assign`, { assignedToId }),
};

export const taskService = {
  getAll: (params?: any) => api.get('/tasks', { params }),
  getById: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  complete: (id: string) => api.patch(`/tasks/${id}/complete`),
  reopen: (id: string) => api.put(`/tasks/${id}`, { status: 'open' }),
  cancel: (id: string) => api.put(`/tasks/${id}`, { status: 'cancelled' }),
};

export const treatmentCaseService = {
  getAll: (params?: any) => api.get('/treatment-cases', { params }),
  getById: (id: string) => api.get(`/treatment-cases/${id}`),
  getFinancialSelect: (params: { patientId: string; clinicId?: string }) => api.get('/treatment-cases/financial-select', { params }),
  create: (data: any) => api.post('/treatment-cases', data),
  update: (id: string, data: any) => api.put(`/treatment-cases/${id}`, data),
  updateStage: (id: string, stage: string, lostReason?: string) => api.put(`/treatment-cases/${id}`, { stage, lostReason }),
  getMaterials: (id: string) => api.get(`/treatment-cases/${id}/materials`),
  addMaterial: (id: string, data: { itemId: string; quantity: number; notes?: string }) => api.post(`/treatment-cases/${id}/materials`, data),
  removeMaterial: (id: string, txId: string) => api.delete(`/treatment-cases/${id}/materials/${txId}`),
  applyPackage: (id: string, data: { packageId: string; allowDuplicate?: boolean }) => api.post(`/treatment-cases/${id}/package-applications`, data),
};

export const insuranceProvisionService = {
  getAll: (params?: any) => api.get('/insurance-provisions', { params }),
  getById: (id: string) => api.get(`/insurance-provisions/${id}`),
  create: (data: any) => api.post('/insurance-provisions', data),
  update: (id: string, data: any) => api.put(`/insurance-provisions/${id}`, data),
  updateStatus: (id: string, data: any) => api.patch(`/insurance-provisions/${id}/status`, data),
  cancel: (id: string) => api.patch(`/insurance-provisions/${id}/cancel`),
};

export const paymentService = {
  getAll: (params?: any) => api.get('/payments', { params }),
  getById: (id: string) => api.get(`/payments/${id}`),
  create: (data: any) => api.post('/payments', data),
  update: (id: string, data: any) => api.put(`/payments/${id}`, data),
  cancel: (id: string) => api.patch(`/payments/${id}/cancel`),
  getReceipt: (id: string) => api.get(`/payments/${id}/receipt`),
};

export const messageTemplateService = {
  getAll: (params?: any) => api.get('/message-templates', { params }),
  getById: (id: string) => api.get(`/message-templates/${id}`),
  create: (data: any) => api.post('/message-templates', data),
  update: (id: string, data: any) => api.put(`/message-templates/${id}`, data),
  seed: () => api.post('/message-templates/seed'),
  metaSubmit: (id: string, data?: { metaTemplateName?: string; metaTemplateLanguage?: string; metaTemplateCategory?: string }) =>
    api.post(`/message-templates/${id}/meta/submit`, data ?? {}),
  metaSync: (id: string) => api.post(`/message-templates/${id}/meta/sync`),
  metaStatus: (id: string) => api.get(`/message-templates/${id}/meta/status`),
};

export const messageService = {
  getAll: (params?: any) => api.get('/messages', { params }),
  getById: (id: string) => api.get(`/messages/${id}`),
  prepare: (data: any) => api.post('/messages/prepare', data),
  send: (id: string) => api.post(`/messages/${id}/send`),
};

export const userService = {
  getDoctors: () => api.get('/users', { params: { role: 'doctor' } }),
  getAll: () => api.get('/users'),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  downloadImportTemplate: (clinicId?: string) =>
    api.get('/users/import-template', {
      responseType: 'blob',
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
    }),
  importPreview: (file: File, clinicId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/users/import-preview', fd, {
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importConfirm: (file: File, clinicId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/users/import-confirm', fd, {
      params: clinicId && clinicId !== 'all' ? { clinicId } : {},
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const doctorAvailabilityService = {
  getAll: (params?: { practitionerId?: string; clinicId?: string }) => api.get('/doctor-availabilities', { params }),
  updateForPractitioner: (practitionerId: string, slots: any[]) => api.put(`/doctor-availabilities/${practitionerId}`, { slots }),
};

export const doctorOffDayService = {
  getAll: (params?: { practitionerId?: string }) => api.get('/doctor-off-days', { params }),
  create: (data: { practitionerId: string; date: string; reason?: string }) => api.post('/doctor-off-days', data),
  delete: (id: string) => api.delete(`/doctor-off-days/${id}`),
};

export const dentalChartService = {
  getAll: (patientId: string) => api.get(`/patients/${patientId}/dental-chart`),
  upsert: (patientId: string, toothFdi: number, data: { status: string; note?: string }) =>
    api.put(`/patients/${patientId}/dental-chart/${toothFdi}`, data),
  delete: (patientId: string, toothFdi: number) =>
    api.delete(`/patients/${patientId}/dental-chart/${toothFdi}`),
};

export const attachmentService = {
  getAll: (patientId: string) => api.get(`/patients/${patientId}/attachments`),
  upload: (patientId: string, formData: FormData) =>
    // Content-Type must be undefined so Axios auto-sets multipart/form-data with boundary
    // (the default 'application/json' header would break multer otherwise)
    api.post(`/patients/${patientId}/attachments`, formData, {
      headers: { 'Content-Type': undefined },
    }),
  delete: (patientId: string, attachmentId: string) =>
    api.delete(`/patients/${patientId}/attachments/${attachmentId}`),
  download: async (patientId: string, attachmentId: string, fileName: string) => {
    const response = await api.get(
      `/patients/${patientId}/attachments/${attachmentId}/download`,
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  // Object URL for in-app preview (img/iframe src) — caller must URL.revokeObjectURL when done.
  loadPreviewObjectUrl: async (patientId: string, attachmentId: string) => {
    const response = await api.get(
      `/patients/${patientId}/attachments/${attachmentId}/preview`,
      { responseType: 'blob' },
    );
    return URL.createObjectURL(response.data);
  },
  // Object URL from the download endpoint (used as "open in new tab" fallback for
  // non-previewable mime types, since the preview endpoint 415s on those).
  loadDownloadObjectUrl: async (patientId: string, attachmentId: string) => {
    const response = await api.get(
      `/patients/${patientId}/attachments/${attachmentId}/download`,
      { responseType: 'blob' },
    );
    return URL.createObjectURL(response.data);
  },
};

export const imagingService = {
  // ── Cihazlar ──
  // clinicId açıkça geçilir — yalnızca global localStorage interceptor'ına
  // güvenmek, React state ile localStorage'ın anlık senkron olmadığı klinik
  // değişimi anında yanlış/eski klinik için istek atılmasına yol açabilir.
  getDevices: (params?: { onlyActive?: boolean; clinicId?: string }, config?: { signal?: AbortSignal }) =>
    api.get('/imaging/devices', {
      params: {
        ...(params?.onlyActive ? { onlyActive: 'true' } : undefined),
        ...(params?.clinicId ? { clinicId: params.clinicId } : undefined),
      },
      signal: config?.signal,
    }),
  createDevice: (data: any) => api.post('/imaging/devices', data),
  updateDevice: (id: string, data: any) => api.put(`/imaging/devices/${id}`, data),
  setDeviceActive: (id: string, isActive: boolean) => api.put(`/imaging/devices/${id}`, { isActive }),
  // Kalıcı silme — kullanım varsa backend 409 IMAGING_DEVICE_IN_USE döner.
  deleteDevice: (id: string) => api.delete(`/imaging/devices/${id}`),

  // ── Çekim istemleri ──
  getRequests: (params?: { status?: string; patientId?: string }) =>
    api.get('/imaging/requests', { params }),
  createRequest: (data: any) => api.post('/imaging/requests', data),
  updateRequest: (id: string, data: any) => api.patch(`/imaging/requests/${id}`, data),
  cancelRequest: (id: string) => api.patch(`/imaging/requests/${id}/cancel`),

  // ── Çalışmalar ──
  getPatientStudies: (patientId: string, includeArchived = false) =>
    api.get(`/patients/${patientId}/imaging`, {
      params: includeArchived ? { includeArchived: 'true' } : undefined,
    }),
  getStudy: (id: string) => api.get(`/imaging/studies/${id}`),
  getUnlinked: () => api.get('/imaging/unlinked'),
  uploadStudy: (formData: FormData) =>
    // Content-Type must be undefined so Axios auto-sets multipart/form-data with boundary
    api.post('/imaging/studies', formData, { headers: { 'Content-Type': undefined } }),
  linkStudy: (id: string, data: { patientId: string; appointmentId?: string; treatmentCaseId?: string }) =>
    api.patch(`/imaging/studies/${id}/link`, data),
  unlinkStudy: (id: string) => api.patch(`/imaging/studies/${id}/unlink`),
  archiveStudy: (id: string) => api.patch(`/imaging/studies/${id}/archive`),
  unarchiveStudy: (id: string) => api.patch(`/imaging/studies/${id}/unarchive`),

  // ── Görüntü stream'leri (kimlik doğrulamalı blob; public URL asla yok) ──
  downloadImage: async (studyId: string, imageId: string, fileName: string) => {
    const response = await api.get(
      `/imaging/studies/${studyId}/images/${imageId}/download`,
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  // Object URL for in-app preview (img/iframe src) — caller must URL.revokeObjectURL when done.
  loadPreviewObjectUrl: async (studyId: string, imageId: string) => {
    const response = await api.get(
      `/imaging/studies/${studyId}/images/${imageId}/preview`,
      { responseType: 'blob' },
    );
    return URL.createObjectURL(response.data);
  },
  // Object URL from the download endpoint (used as "open in new tab" fallback for
  // non-previewable mime types, since the preview endpoint 415s on those).
  loadDownloadObjectUrl: async (studyId: string, imageId: string) => {
    const response = await api.get(
      `/imaging/studies/${studyId}/images/${imageId}/download`,
      { responseType: 'blob' },
    );
    return URL.createObjectURL(response.data);
  },
  // Raw DICOM bytes for DicomViewer — kept in memory only, never a public URL,
  // supports cancellation when the viewer closes/switches image mid-load.
  loadDicomBlob: async (studyId: string, imageId: string, signal?: AbortSignal): Promise<Blob> => {
    const response = await api.get(
      `/imaging/studies/${studyId}/images/${imageId}/preview`,
      { responseType: 'blob', signal },
    );
    return response.data;
  },

  // ── Köprü ajanları (yanıt tokenHash içermez; düz metin token yalnızca
  //    createBridge yanıtında bir kez döner) ──
  getBridges: (params?: { clinicId?: string }, config?: { signal?: AbortSignal }) =>
    api.get('/imaging/bridges', {
      params: params?.clinicId ? { clinicId: params.clinicId } : undefined,
      signal: config?.signal,
    }),
  createBridge: (data: { name: string; clinicId?: string }) => api.post('/imaging/bridges', data),
  revokeBridge: (id: string) => api.post(`/imaging/bridges/${id}/revoke`),
  // Kalıcı silme — kullanım varsa backend 409 IMAGING_BRIDGE_IN_USE döner.
  deleteBridge: (id: string) => api.delete(`/imaging/bridges/${id}`),

  // ── Self-servis kurulum (Web Onboarding, PR 5/7) ──
  // Düz metin eşleştirme kodu YALNIZCA createPairing yanıtında bir kez döner;
  // çağıran kodu hiçbir yerde saklamamalı (yalnızca bileşen belleğinde).
  getBridgeOnboardingConfig: () => api.get('/imaging/bridge-onboarding/config'),
  createPairing: (data: { bridgeName: string; deviceIds: string[]; clinicId?: string }) =>
    api.post('/imaging/bridge-pairings', data),
  getPairing: (id: string) => api.get(`/imaging/bridge-pairings/${id}`),
  cancelPairing: (id: string) => api.delete(`/imaging/bridge-pairings/${id}`),
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
};

export const notificationPreferencesService = {
  get: (clinicId?: string) =>
    api.get('/settings/notification-preferences', {
      params: clinicId ? { clinicId } : undefined,
    }),
  update: (preferences: any, clinicId?: string) =>
    api.put(
      '/settings/notification-preferences',
      { preferences },
      { params: clinicId ? { clinicId } : undefined },
    ),
};

export const clinicOperatingPreferencesService = {
  get: (clinicId?: string) =>
    api.get('/settings/clinic-operating-preferences', {
      params: clinicId ? { clinicId } : undefined,
    }),
  update: (preferences: any, clinicId?: string) =>
    api.put(
      '/settings/clinic-operating-preferences',
      { preferences },
      { params: clinicId ? { clinicId } : undefined },
    ),
};

export const recallService = {
  getSettings: (clinicId?: string) =>
    api.get('/recall/settings', {
      params: clinicId ? { clinicId } : undefined,
    }),
  updateSettings: (settings: any, clinicId?: string) =>
    api.put(
      '/recall/settings',
      { settings },
      { params: clinicId ? { clinicId } : undefined },
    ),
  generate: (clinicId?: string) =>
    api.post('/recall/generate', {}, {
      params: clinicId ? { clinicId } : undefined,
    }),
  getCandidates: (params?: any) => api.get('/recall/candidates', { params }),
  getCandidate: (id: string) => api.get(`/recall/candidates/${id}`),
  updateStatus: (id: string, data: { status: string; note?: string }) =>
    api.patch(`/recall/candidates/${id}/status`, data),
  snooze: (id: string, data: { nextActionAt: string; note?: string }) =>
    api.post(`/recall/candidates/${id}/snooze`, data),
  createTask: (id: string, data?: { note?: string }) =>
    api.post(`/recall/candidates/${id}/create-task`, data ?? {}),
  prepareMessage: (id: string) =>
    api.post(`/recall/candidates/${id}/prepare-message`),
  logContact: (id: string, data?: { note?: string }) =>
    api.post(`/recall/candidates/${id}/log-contact`, data ?? {}),
};

export const reportService = {
  getRevenue: (params?: any) => api.get('/reports/revenue', { params }),
  getDoctorPerformance: (params?: any) => api.get('/reports/doctor-performance', { params }),
  getPatientSources: (params?: any) => api.get('/reports/patient-sources', { params }),
  getNoShowAnalysis: (params?: any) => api.get('/reports/no-show-analysis', { params }),
};

export const inventoryService = {
  getAll: (params?: any) => api.get('/inventory', { params }),
  getById: (id: string) => api.get(`/inventory/${id}`),
  create: (data: any) => api.post('/inventory', data),
  update: (id: string, data: any) => api.put(`/inventory/${id}`, data),
  remove: (id: string) => api.delete(`/inventory/${id}`),
  getAlerts: () => api.get('/inventory/alerts'),
  getTransactions: (id: string, params?: any) => api.get(`/inventory/${id}/transactions`, { params }),
  addTransaction: (id: string, data: any) => api.post(`/inventory/${id}/transactions`, data),
};

export const paymentPlanService = {
  getAll: (params?: any) => api.get('/payment-plans', { params }),
  getById: (id: string) => api.get(`/payment-plans/${id}`),
  create: (data: any) => api.post('/payment-plans', data),
  cancel: (id: string) => api.patch(`/payment-plans/${id}/cancel`),
  payInstallment: (planId: string, installmentId: string, data: any) =>
    api.post(`/payment-plans/${planId}/installments/${installmentId}/pay`, data),
  getOverdueCollections: (params?: any) => api.get('/payment-plans/overdue-collections', { params }),
};

export const compensationRuleService = {
  getAll: (params?: any) => api.get('/compensation-rules', { params }),
  create: (data: any) => api.post('/compensation-rules', data),
  update: (id: string, data: any) => api.put(`/compensation-rules/${id}`, data),
  remove: (id: string) => api.delete(`/compensation-rules/${id}`),
  getServiceRules: (params?: any) => api.get('/service-compensation-rules', { params }),
  upsertServiceRule: (data: any) => api.post('/service-compensation-rules', data),
  removeServiceRule: (id: string) => api.delete(`/service-compensation-rules/${id}`),
};

export const practitionerEarningService = {
  getAll: (params?: any) => api.get('/practitioner-earnings', { params }),
  getSummary: (params?: any) => api.get('/practitioner-earnings/summary', { params }),
  getById: (id: string) => api.get(`/practitioner-earnings/${id}`),
  approve: (id: string) => api.patch(`/practitioner-earnings/${id}/approve`),
  adjust: (id: string, data: any) => api.patch(`/practitioner-earnings/${id}/adjust`, data),
  cancel: (id: string) => api.patch(`/practitioner-earnings/${id}/cancel`),
  markPaid: (id: string) => api.patch(`/practitioner-earnings/${id}/mark-paid`),
};

export const treatmentPlanProceduresService = {
  getByCaseId: (caseId: string) => api.get(`/treatment-cases/${caseId}/procedures`),
  getPatientProcedures: (patientId: string) => api.get(`/patients/${patientId}/treatment-procedures`),
  create: (caseId: string, data: any) => api.post(`/treatment-cases/${caseId}/procedures`, data),
  update: (caseId: string, id: string, data: any) => api.put(`/treatment-cases/${caseId}/procedures/${id}`, data),
  remove: (caseId: string, id: string) => api.delete(`/treatment-cases/${caseId}/procedures/${id}`),
};

export const publicBookingService = {
  getClinicInfo: (clinicId: string) => axios.get(`${API_URL}/public/booking/${encodeURIComponent(clinicId)}`),
  getSlots: (clinicId: string, params: { date: string; serviceId?: string; practitionerId?: string }) =>
    axios.get(`${API_URL}/public/booking/${encodeURIComponent(clinicId)}/slots`, { params }),
  getNoticeEvidence: (clinicId: string, data: { sessionId: string; language: string }) =>
    axios.post(`${API_URL}/public/booking/${encodeURIComponent(clinicId)}/notice-evidence`, data),
  submit: (clinicId: string, data: any) => axios.post(`${API_URL}/public/booking/${encodeURIComponent(clinicId)}`, data),
};

export const practitionerPayoutService = {
  getAll: (params?: any) => api.get('/practitioner-payouts', { params }),
  getById: (id: string) => api.get(`/practitioner-payouts/${id}`),
  create: (data: any) => api.post('/practitioner-payouts', data),
  remove: (id: string) => api.delete(`/practitioner-payouts/${id}`),
};

export const organizationBranchService = {
  getAll: () => api.get('/organization/clinics'),
  getById: (id: string) => api.get(`/organization/clinics/${id}`),
  create: (data: any) => api.post('/organization/clinics', data),
  update: (id: string, data: any) => api.put(`/organization/clinics/${id}`, data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/organization/clinics/${id}/status`, { status }),
};

export const userClinicAssignmentService = {
  getUserClinics: (userId: string) => api.get(`/organization/users/${userId}/clinics`),
  updateUserClinics: (
    userId: string,
    data: { assignments: { clinicId: string; role: string }[]; defaultClinicId?: string | null }
  ) => api.put(`/organization/users/${userId}/clinics`, data),
};

export const scheduleService = {
  getWorkingHours: (clinicId: string) => api.get(`/clinics/${clinicId}/working-hours`),
  updateWorkingHours: (clinicId: string, hours: Array<{ dayOfWeek: number; isClosed: boolean }>) =>
    api.put(`/clinics/${clinicId}/working-hours`, { hours }),
  getClinicDoctors: (clinicId: string) => api.get(`/clinics/${clinicId}/doctors`),
  getAvailability: (params: { clinicId: string; doctorId: string; date: string; duration?: number }) =>
    api.get('/availability', { params }),
};

// ─── WhatsApp Connection Services ─────────────────────────────────────────────

export const whatsappConnectionService = {
  list: () => api.get('/organization/whatsapp-connections'),
  get: (id: string) => api.get(`/organization/whatsapp-connections/${id}`),
  create: (data: Record<string, unknown>) => api.post('/organization/whatsapp-connections', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/organization/whatsapp-connections/${id}`, data),
  test: (id: string) => api.post(`/organization/whatsapp-connections/${id}/test`),
  getReadiness: (id: string) => api.get(`/organization/whatsapp-connections/${id}/readiness`),
  getQr: (id: string) => api.get(`/organization/whatsapp-connections/${id}/qr`),
  disconnect: (id: string) => api.post(`/organization/whatsapp-connections/${id}/disconnect`),
  setStatus: (id: string, data: { isActive: boolean; status?: string }) =>
    api.patch(`/organization/whatsapp-connections/${id}/status`, data),
  deleteConnection: (id: string) => api.delete(`/organization/whatsapp-connections/${id}`),
  importLegacy: () => api.post('/organization/whatsapp-connections/import-legacy'),
  metaCallback: (data: Record<string, unknown>) =>
    api.post('/organization/whatsapp-connections/meta/callback', data),
};

export const clinicWhatsAppService = {
  getAssignments: (clinicId: string) => api.get(`/clinics/${clinicId}/whatsapp`),
  assign: (clinicId: string, whatsappConnectionId: string) =>
    api.put(`/clinics/${clinicId}/whatsapp`, { whatsappConnectionId }),
  unassign: (clinicId: string, connectionId: string) =>
    api.delete(`/clinics/${clinicId}/whatsapp/${connectionId}`),
};

export const whatsappInboxService = {
  getUnassigned: () => api.get('/whatsapp/inbox/unassigned'),
  getConversations: (params?: { status?: string; clinicId?: string }) =>
    api.get('/whatsapp/inbox/conversations', { params }),
  resolve: (id: string, data: { clinicId: string; patientId?: string }) =>
    api.post(`/whatsapp/inbox/${id}/resolve`, data),
  linkPatient: (id: string, patientId: string) =>
    api.post(`/whatsapp/inbox/${id}/link-patient`, { patientId }),
  getMessages: (id: string) => api.get(`/whatsapp/inbox/${id}/messages`),
  reply: (id: string, message: string) =>
    api.post(`/whatsapp/inbox/${id}/reply`, { message }),
  createAppointmentRequest: (id: string) =>
    api.post(`/whatsapp/inbox/${id}/create-appointment-request`),
  createAppointment: (id: string, data: {
    patientId: string;
    clinicId: string;
    practitionerId: string;
    appointmentTypeId: string;
    date: string;
    time: string;
    endTime?: string;
    notes?: string;
  }) => api.post(`/whatsapp/inbox/${id}/create-appointment`, data),
};

export const financeDashboardService = {
  get: (params?: { clinicId?: string; range?: string; from?: string; to?: string }) =>
    api.get('/finance/dashboard', { params }),
};

export const operationalMonitoringService = {
  getHealth: () => api.get('/ops/health'),
  getAuditLogs: (params?: {
    clinicId?: string;
    action?: string;
    entityType?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) => api.get('/ops/audit-logs', { params }),
  getEvents: (params?: {
    clinicId?: string;
    severity?: string;
    source?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) => api.get('/ops/events', { params }),
  resolveEvent: (id: string) => api.patch(`/ops/events/${id}/resolve`),
};

export const noShowService = {
  markNoShow: (appointmentId: string) =>
    api.patch(`/appointments/${appointmentId}/no-show`),
  updateRecoveryStatus: (appointmentId: string, data: { status: string; note?: string }) =>
    api.patch(`/appointments/${appointmentId}/recovery-status`, data),
  getDashboard: (params?: {
    clinicId?: string;
    range?: string;
    from?: string;
    to?: string;
    doctorId?: string;
    recoveryStatus?: string;
  }) => api.get('/no-shows/dashboard', { params }),
  sendRecoveryMessage: (appointmentId: string, data?: { message?: string }) =>
    api.post(`/appointments/${appointmentId}/no-show/send-message`, data ?? {}),
  createFollowUpTask: (appointmentId: string, data?: { dueDate?: string; assignedToId?: string }) =>
    api.post(`/appointments/${appointmentId}/no-show/create-task`, data ?? {}),
};

// ── Dental Laboratory Tracking ──────────────────────────────────────────────────

export const laboratoryService = {
  getAll: (params?: { isActive?: boolean; clinicId?: string }) => api.get('/laboratories', { params }),
  create: (data: any) => api.post('/laboratories', data),
  update: (id: string, data: any) => api.put(`/laboratories/${id}`, data),
  delete: (id: string) => api.delete(`/laboratories/${id}`),
};

export const labOrderService = {
  getAll: (params?: { status?: string; laboratoryId?: string; patientId?: string; overdue?: boolean; clinicId?: string }) =>
    api.get('/lab-orders', { params }),
  getDashboard: (params?: { clinicId?: string }) => api.get('/lab-orders/dashboard', { params }),
  getById: (id: string) => api.get(`/lab-orders/${id}`),
  create: (data: any, clinicId?: string) => api.post('/lab-orders', data, { params: clinicId ? { clinicId } : {} }),
  update: (id: string, data: any) => api.put(`/lab-orders/${id}`, data),
  updateStatus: (id: string, data: { status: string; note?: string; newExpectedReturnDate?: string | null; cancelReason?: string }) =>
    api.patch(`/lab-orders/${id}/status`, data),
  delete: (id: string) => api.delete(`/lab-orders/${id}`),
  getAttachments: (id: string) => api.get(`/lab-orders/${id}/attachments`),
  uploadAttachment: (id: string, formData: FormData) =>
    api.post(`/lab-orders/${id}/attachments`, formData, { headers: { 'Content-Type': undefined } }),
  deleteAttachment: (id: string, attId: string) => api.delete(`/lab-orders/${id}/attachments/${attId}`),
  downloadAttachment: (id: string, attId: string) =>
    api.get(`/lab-orders/${id}/attachments/${attId}/download`, { responseType: 'blob' }),
  // Object URL for in-app preview (img/iframe src) — caller must URL.revokeObjectURL when done.
  loadPreviewObjectUrl: async (id: string, attId: string) => {
    const response = await api.get(`/lab-orders/${id}/attachments/${attId}/preview`, { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  // Object URL from the download endpoint (used as "open in new tab" fallback for
  // non-previewable mime types, since the preview endpoint 415s on those).
  loadDownloadObjectUrl: async (id: string, attId: string) => {
    const response = await api.get(`/lab-orders/${id}/attachments/${attId}/download`, { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
};

// ── Instagram Connection Services ──────────────────────────────────────────────

export const instagramConnectionService = {
  list: () => api.get('/organization/instagram-connections'),
  get: (id: string) => api.get(`/organization/instagram-connections/${id}`),
  create: (data: Record<string, unknown>) => api.post('/organization/instagram-connections', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/organization/instagram-connections/${id}`, data),
  test: (id: string) => api.post(`/organization/instagram-connections/${id}/test`),
  disconnect: (id: string) => api.post(`/organization/instagram-connections/${id}/disconnect`),
  setStatus: (id: string, data: { isActive: boolean }) =>
    api.patch(`/organization/instagram-connections/${id}/status`, data),
  deleteConnection: (id: string) => api.delete(`/organization/instagram-connections/${id}`),
};

export const clinicInstagramService = {
  getAssignments: (clinicId: string) => api.get(`/clinics/${clinicId}/instagram`),
  assign: (clinicId: string, instagramConnectionId: string) =>
    api.put(`/clinics/${clinicId}/instagram`, { instagramConnectionId }),
  unassign: (clinicId: string, connectionId: string) =>
    api.delete(`/clinics/${clinicId}/instagram/${connectionId}`),
};

export const instagramInboxService = {
  getClinics: () => api.get('/instagram/inbox/clinics'),
  getUnassigned: () => api.get('/instagram/inbox/unassigned'),
  getConversations: (params?: { status?: string; clinicId?: string }) =>
    api.get('/instagram/inbox/conversations', { params }),
  resolve: (id: string, data: { clinicId: string; patientId?: string }) =>
    api.post(`/instagram/inbox/${id}/resolve`, data),
  linkPatient: (id: string, patientId: string) =>
    api.post(`/instagram/inbox/${id}/link-patient`, { patientId }),
  assignClinic: (id: string, clinicId: string) =>
    api.post(`/instagram/inbox/${id}/assign-clinic`, { clinicId }),
  reply: (id: string, message: string) =>
    api.post(`/instagram/conversations/${id}/reply`, { message }),
  getMessages: (id: string) => api.get(`/instagram/inbox/${id}/messages`),
  createAppointmentRequest: (id: string) =>
    api.post(`/instagram/inbox/${id}/create-appointment-request`),
  createAppointment: (id: string, data: {
    patientId: string;
    clinicId: string;
    practitionerId: string;
    appointmentTypeId: string;
    date: string;
    time: string;
    endTime?: string;
    notes?: string;
  }) => api.post(`/instagram/inbox/${id}/create-appointment`, data),
  markConverted: (id: string) =>
    api.patch(`/instagram/inbox/${id}/status`, { status: 'converted' }),
};

export const clinicLegalProfileService = {
  get: (clinicId: string) => api.get(`/clinics/${clinicId}/legal-profile`),
  save: (clinicId: string, data: Record<string, unknown>) =>
    api.put(`/clinics/${clinicId}/legal-profile`, data),
  publish: (clinicId: string, data?: Record<string, unknown>) =>
    api.post(`/clinics/${clinicId}/legal-profile/publish`, data ?? {}),
};

export const publicClinicKvkkService = {
  get: (clinicSlug: string) =>
    api.get(`/public/clinics/${clinicSlug}/kvkk`),
};

export const smsService = {
  getSettings: (clinicId?: string) =>
    api.get('/sms/settings', { params: clinicId ? { clinicId } : undefined }),
  getUsage: (clinicId?: string) =>
    api.get('/sms/usage', { params: clinicId ? { clinicId } : undefined }),
  getHistory: (params?: Record<string, unknown>) =>
    api.get('/sms/history', { params }),
  send: (data: Record<string, unknown>) => api.post('/sms/send', data),
};

export default api;
