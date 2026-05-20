import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hcrm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Tüm isteklere seçili klinik filtresi ekle (GET listesi + mutation'lar)
  // Backend bu değeri doğrular; "all" gönderilmez — backend varsayılanı kullanır
  const selectedClinicId = localStorage.getItem('hcrm_clinic_id');
  if (selectedClinicId && selectedClinicId !== 'all') {
    config.params = { ...config.params, clinicId: selectedClinicId };
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(error);
  }
);

export const authService = {
  login: (credentials: any) => api.post('/auth/login', credentials),
  me: () => api.get('/auth/me'),
};

export const patientService = {
  getAll: (params?: any) => api.get('/patients', { params }),
  getById: (id: string) => api.get(`/patients/${id}`),
  create: (data: any) => api.post('/patients', data),
  update: (id: string, data: any) => api.put(`/patients/${id}`, data),
  archive: (id: string) => api.delete(`/patients/${id}`),
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
};

export const appointmentService = {
  getAll: (params?: any) => api.get('/appointments', { params }),
  getById: (id: string) => api.get(`/appointments/${id}`),
  create: (data: any) => api.post('/appointments', data),
  update: (id: string, data: any) => api.put(`/appointments/${id}`, data),
  updateStatus: (id: string, status: string) => api.put(`/appointments/${id}`, { status }),
  linkTreatmentCase: (id: string, treatmentCaseId: string | null) =>
    api.patch(`/appointments/${id}/treatment-case`, { treatmentCaseId }),
};

export const appointmentRequestService = {
  getAll: (params?: any) => api.get('/appointment-requests', { params }),
  updateStatus: (id: string, data: any) => api.put(`/appointment-requests/${id}/status`, data),
  convert: (id: string, data?: any) => api.post(`/appointment-requests/${id}/convert`, data || {}),
};

export const taskService = {
  getAll: (params?: any) => api.get('/tasks', { params }),
  getById: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  complete: (id: string) => api.patch(`/tasks/${id}/complete`),
  cancel: (id: string) => api.put(`/tasks/${id}`, { status: 'cancelled' }),
};

export const treatmentCaseService = {
  getAll: (params?: any) => api.get('/treatment-cases', { params }),
  getById: (id: string) => api.get(`/treatment-cases/${id}`),
  create: (data: any) => api.post('/treatment-cases', data),
  update: (id: string, data: any) => api.put(`/treatment-cases/${id}`, data),
  updateStage: (id: string, stage: string, lostReason?: string) => api.put(`/treatment-cases/${id}`, { stage, lostReason }),
  getMaterials: (id: string) => api.get(`/treatment-cases/${id}/materials`),
  addMaterial: (id: string, data: { itemId: string; quantity: number; notes?: string }) => api.post(`/treatment-cases/${id}/materials`, data),
  removeMaterial: (id: string, txId: string) => api.delete(`/treatment-cases/${id}/materials/${txId}`),
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
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
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
  getClinicInfo: (clinicId: string) => axios.get(`/api/public/booking/${clinicId}`),
  submit: (clinicId: string, data: any) => axios.post(`/api/public/booking/${clinicId}`, data),
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
  updateWorkingHours: (clinicId: string, hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>) =>
    api.put(`/clinics/${clinicId}/working-hours`, { hours }),
  getClinicDoctors: (clinicId: string) => api.get(`/clinics/${clinicId}/doctors`),
  getAvailability: (params: { clinicId: string; doctorId: string; date: string; duration?: number }) =>
    api.get('/availability', { params }),
};

export default api;
