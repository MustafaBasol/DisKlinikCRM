import React, { useEffect, useId, useRef } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  warnings?: string[];
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation dialog for destructive/irreversible actions.
 * Replaces ad-hoc window.confirm() / one-off inline modals across the app.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  warnings,
  confirmLabel,
  cancelLabel,
  loading = false,
  disabled = false,
  disabledReason,
  variant = 'danger',
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(
      '[data-autofocus]',
    ) ?? dialogRef.current;
    focusTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading]);

  if (!open) return null;

  const confirmButtonClasses = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
    : 'btn-primary disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {variant === 'danger' && <Trash2 size={18} className="text-red-500" />}
            {title}
          </h2>
        </div>
        <div className="p-4 sm:p-6 space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">{body}</div>
          {warnings && warnings.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-800 dark:text-amber-300 space-y-1">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}
          {disabled && disabledReason && (
            <div className="p-3 bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-300">
              {disabledReason}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || disabled}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${confirmButtonClasses}`}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : (variant === 'danger' && <Trash2 size={14} />)}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
