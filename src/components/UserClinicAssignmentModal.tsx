import { useEffect, useState } from 'react';
import { X, Building2, AlertCircle } from 'lucide-react';
import { organizationBranchService, userClinicAssignmentService } from '../services/api';

interface Clinic {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

interface Assignment {
  clinicId: string;
  role: string;
}

interface CurrentAssignment {
  clinicId: string;
  role: string;
  clinic: { id: string; name: string };
}

interface Props {
  userId: string;
  userName: string;
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
}

const BRANCH_ROLES = [
  { value: 'CLINIC_MANAGER', label: 'Klinik Yöneticisi' },
  { value: 'DENTIST', label: 'Diş Hekimi' },
  { value: 'RECEPTIONIST', label: 'Resepsiyonist' },
  { value: 'BILLING', label: 'Muhasebe' },
  { value: 'ASSISTANT', label: 'Asistan' },
];

export default function UserClinicAssignmentModal({ userId, userName, userEmail, onClose, onSaved }: Props) {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [defaultClinicId, setDefaultClinicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [clinicsRes, userClinicsRes] = await Promise.all([
          organizationBranchService.getAll(),
          userClinicAssignmentService.getUserClinics(userId),
        ]);
        const allClinics: Clinic[] = clinicsRes.data?.clinics ?? clinicsRes.data ?? [];
        setClinics(allClinics.filter((c) => c.isActive));

        const current: CurrentAssignment[] = userClinicsRes.data?.clinics ?? [];
        setAssignments(current.map((a) => ({ clinicId: a.clinicId, role: a.role })));

        const defClinic = userClinicsRes.data?.defaultClinicId ?? null;
        setDefaultClinicId(defClinic);
      } catch {
        setError('Klinik verileri yüklenemedi.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  const isChecked = (clinicId: string) => assignments.some((a) => a.clinicId === clinicId);

  const handleToggle = (clinicId: string) => {
    setAssignments((prev) => {
      if (prev.some((a) => a.clinicId === clinicId)) {
        // Uncheck: remove assignment, clear defaultClinicId if it was this one
        if (defaultClinicId === clinicId) setDefaultClinicId(null);
        return prev.filter((a) => a.clinicId !== clinicId);
      } else {
        return [...prev, { clinicId, role: 'RECEPTIONIST' }];
      }
    });
  };

  const handleRoleChange = (clinicId: string, role: string) => {
    setAssignments((prev) => prev.map((a) => (a.clinicId === clinicId ? { ...a, role } : a)));
  };

  const selectedClinicIds = assignments.map((a) => a.clinicId);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await userClinicAssignmentService.updateUserClinics(userId, {
        assignments,
        defaultClinicId: defaultClinicId ?? null,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.response?.data?.message ?? 'Kaydedilemedi.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Building2 size={20} className="text-blue-600" />
            <div>
              <h2 className="font-semibold text-gray-900">Klinik Atamaları</h2>
              <p className="text-xs text-gray-500">{userName} · {userEmail}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-gray-500 text-sm py-8 text-center">Yükleniyor...</p>
          ) : clinics.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">Organizasyonda aktif klinik bulunamadı.</p>
          ) : (
            <div className="space-y-3">
              {clinics.map((clinic) => {
                const checked = isChecked(clinic.id);
                const assignment = assignments.find((a) => a.clinicId === clinic.id);
                return (
                  <div
                    key={clinic.id}
                    className={`rounded-lg border p-3 transition-colors ${checked ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-3 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggle(clinic.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{clinic.name}</p>
                          <p className="text-xs text-gray-400">{clinic.slug}</p>
                        </div>
                      </label>
                      {checked && (
                        <select
                          value={assignment?.role ?? 'RECEPTIONIST'}
                          onChange={(e) => handleRoleChange(clinic.id, e.target.value)}
                          className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {BRANCH_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Default Clinic */}
          {selectedClinicIds.length > 0 && (
            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Varsayılan Klinik
              </label>
              <select
                value={defaultClinicId ?? ''}
                onChange={(e) => setDefaultClinicId(e.target.value || null)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Seçin —</option>
                {clinics
                  .filter((c) => selectedClinicIds.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
