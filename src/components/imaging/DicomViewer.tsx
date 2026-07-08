import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Contrast,
  Download,
  FileWarning,
  Hand,
  Loader2,
  Maximize2,
  MousePointer2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClinicPreferences } from '../../context/ClinicPreferencesContext';
import {
  classifyDicomSupport,
  mapSafeDicomMetadata,
  mapViewerError,
  type SafeDicomMetadata,
  type ViewerErrorKind,
} from './dicomHelpers';

type ActiveTool = 'windowLevel' | 'pan' | 'zoom';
type ViewerState = 'loading' | 'ready' | 'multi-frame-unsupported' | 'unsupported' | 'error';

interface CornerstoneModules {
  cornerstone: typeof import('cornerstone-core');
  dicomParser: typeof import('dicom-parser');
  wadoImageLoader: (typeof import(
    'cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js'
  ))['default'];
}

let cornerstoneModulesPromise: Promise<CornerstoneModules> | null = null;

// Lazy-loaded once per page session; cornerstone's external wiring is idempotent
// (re-assigning the same references is harmless) so a module-level singleton
// promise is safe to share across repeated viewer opens.
function loadCornerstoneModules(): Promise<CornerstoneModules> {
  if (!cornerstoneModulesPromise) {
    cornerstoneModulesPromise = Promise.all([
      import('cornerstone-core'),
      import('dicom-parser'),
      import('cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js'),
    ]).then(([cornerstoneMod, dicomParserMod, wadoLoaderMod]) => {
      const cornerstone = (cornerstoneMod as any).default ?? cornerstoneMod;
      const dicomParser = (dicomParserMod as any).default ?? dicomParserMod;
      const wadoImageLoader = (wadoLoaderMod as any).default ?? wadoLoaderMod;
      wadoImageLoader.external.cornerstone = cornerstone;
      wadoImageLoader.external.dicomParser = dicomParser;
      return { cornerstone, dicomParser, wadoImageLoader };
    });
  }
  return cornerstoneModulesPromise;
}

export interface DicomViewerProps {
  fileName: string;
  /** Modality/date come from the NoraMedi study record, never from DICOM tags. */
  modality?: string | null;
  studyDate?: string | null;
  loadDicomBlob: (signal: AbortSignal) => Promise<Blob>;
  onDownload: () => void;
  onClose: () => void;
}

const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;

const DicomViewer: React.FC<DicomViewerProps> = ({ fileName, modality, studyDate, loadDicomBlob, onDownload, onClose }) => {
  const { t } = useTranslation(['imaging', 'common']);
  const { formatDate } = useClinicPreferences();
  const titleId = useId();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [state, setState] = useState<ViewerState>('loading');
  const [errorKind, setErrorKind] = useState<ViewerErrorKind | null>(null);
  const [metadata, setMetadata] = useState<SafeDicomMetadata | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('windowLevel');
  const [invert, setInvert] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Guards against a resource created by a superseded load being cleaned up,
  // and against stale async results rendering after unmount/retry.
  const requestIdRef = useRef(0);
  const cornerstoneEnabledRef = useRef(false);
  const dicomImageIdRef = useRef<string | null>(null);
  const cornerstoneRef = useRef<CornerstoneModules['cornerstone'] | null>(null);
  const wadoLoaderRef = useRef<CornerstoneModules['wadoImageLoader'] | null>(null);

  // Idempotent: safe to call more than once (e.g. Escape + unmount racing,
  // or a remount cleanup firing after a failed/aborted load). Each external
  // call is isolated so one throwing library call can't skip the rest.
  const cleanupCornerstone = useCallback(() => {
    const element = elementRef.current;
    const cornerstone = cornerstoneRef.current;
    const wadoImageLoader = wadoLoaderRef.current;

    // Capture-then-null first so a re-entrant/second call can't act on the
    // same imageId again, even if one of the calls below throws.
    const imageId = dicomImageIdRef.current;
    dicomImageIdRef.current = null;

    if (imageId) {
      try {
        wadoImageLoader?.wadouri.fileManager.remove(imageId);
      } catch {
        // already removed / never registered — nothing to clean up
      }
      try {
        // Only release from imageCache if it's actually still cached —
        // removeImageLoadObject throws when the id isn't present.
        const stillCached = cornerstone?.imageCache.getImageLoadObject(imageId);
        if (stillCached) {
          cornerstone?.imageCache.removeImageLoadObject(imageId);
        }
      } catch {
        // already released — nothing to clean up
      }
    }

    if (cornerstoneEnabledRef.current) {
      cornerstoneEnabledRef.current = false;
      try {
        if (element && cornerstone) cornerstone.disable(element);
      } catch {
        // element may already be disabled/unmounted — nothing to clean up
      }
    }
  }, []);

  useEffect(() => {
    const myRequestId = ++requestIdRef.current;
    const controller = new AbortController();
    setState('loading');
    setErrorKind(null);
    setMetadata(null);

    (async () => {
      let blob: Blob;
      try {
        blob = await loadDicomBlob(controller.signal);
      } catch (err) {
        if (requestIdRef.current !== myRequestId) return;
        setErrorKind(mapViewerError(err));
        setState('error');
        return;
      }
      if (requestIdRef.current !== myRequestId) return;

      const { cornerstone, dicomParser, wadoImageLoader } = await loadCornerstoneModules();
      if (requestIdRef.current !== myRequestId) return;
      cornerstoneRef.current = cornerstone;
      wadoLoaderRef.current = wadoImageLoader;

      let dataSet;
      try {
        const buffer = new Uint8Array(await blob.arrayBuffer());
        dataSet = dicomParser.parseDicom(buffer);
      } catch {
        if (requestIdRef.current !== myRequestId) return;
        setState('unsupported');
        return;
      }
      if (requestIdRef.current !== myRequestId) return;

      const safeMetadata = mapSafeDicomMetadata(dataSet);
      setMetadata(safeMetadata);

      if (classifyDicomSupport(dataSet) === 'multi-frame') {
        setState('multi-frame-unsupported');
        return;
      }
      if (!safeMetadata.transferSyntaxSupported) {
        setState('unsupported');
        return;
      }

      const element = elementRef.current;
      if (!element) return;

      try {
        cornerstone.enable(element);
        cornerstoneEnabledRef.current = true;
        const imageId = wadoImageLoader.wadouri.fileManager.add(blob);
        dicomImageIdRef.current = imageId;
        const image = await cornerstone.loadImage(imageId);
        if (requestIdRef.current !== myRequestId) return;
        cornerstone.displayImage(element, image);
        setInvert(!!image.invert);
        setState('ready');
      } catch {
        if (requestIdRef.current !== myRequestId) return;
        setState('unsupported');
      }
    })();

    return () => {
      requestIdRef.current++;
      controller.abort();
      cleanupCornerstone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  // ── Accessibility: focus trap, initial focus, focus restore, Escape ──
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [onClose]);

  const getViewport = useCallback(() => {
    const element = elementRef.current;
    const cornerstone = cornerstoneRef.current;
    if (!element || !cornerstone) return null;
    return cornerstone.getViewport(element) ?? null;
  }, []);

  const applyViewport = useCallback((patch: Partial<ReturnType<typeof getViewport> & object>) => {
    const element = elementRef.current;
    const cornerstone = cornerstoneRef.current;
    const current = getViewport();
    if (!element || !cornerstone || !current) return;
    cornerstone.setViewport(element, { ...current, ...patch } as any);
  }, [getViewport]);

  const zoomBy = useCallback((factor: number) => {
    const current = getViewport();
    if (!current) return;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
    applyViewport({ scale: nextScale });
  }, [applyViewport, getViewport]);

  const handleFitToView = useCallback(() => {
    const element = elementRef.current;
    const cornerstone = cornerstoneRef.current;
    if (!element || !cornerstone) return;
    const image = cornerstone.getImage(element);
    if (!image) return;
    const defaultViewport = cornerstone.getDefaultViewportForImage(element, image);
    applyViewport({ scale: defaultViewport.scale, translation: defaultViewport.translation });
  }, [applyViewport]);

  const handleReset = useCallback(() => {
    const element = elementRef.current;
    const cornerstone = cornerstoneRef.current;
    if (!element || !cornerstone) return;
    cornerstone.reset(element);
    const viewport = cornerstone.getViewport(element);
    if (viewport) setInvert(!!viewport.invert);
  }, []);

  const handleInvert = useCallback(() => {
    const current = getViewport();
    if (!current) return;
    const nextInvert = !current.invert;
    applyViewport({ invert: nextInvert });
    setInvert(nextInvert);
  }, [applyViewport, getViewport]);

  // ── Pointer-driven pan / window-level / zoom ──
  const dragStateRef = useRef<{ pointerId: number; lastX: number; lastY: number; startViewport: any } | null>(null);
  const pinchStateRef = useRef<{ pointers: Map<number, { x: number; y: number }>; startDistance: number; startScale: number } | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (state !== 'ready') return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    if (pinchStateRef.current) {
      pinchStateRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    } else if (dragStateRef.current) {
      // A second pointer arrived mid-drag — switch to pinch-zoom.
      const current = getViewport();
      pinchStateRef.current = {
        pointers: new Map([
          [dragStateRef.current.pointerId, { x: dragStateRef.current.lastX, y: dragStateRef.current.lastY }],
          [event.pointerId, { x: event.clientX, y: event.clientY }],
        ]),
        startDistance: 0,
        startScale: current?.scale ?? 1,
      };
      dragStateRef.current = null;
    } else {
      dragStateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        startViewport: getViewport(),
      };
    }
  }, [getViewport, state]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (state !== 'ready') return;

    if (pinchStateRef.current && pinchStateRef.current.pointers.has(event.pointerId)) {
      pinchStateRef.current.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = Array.from(pinchStateRef.current.pointers.values());
      if (points.length === 2) {
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        const distance = Math.hypot(dx, dy);
        if (pinchStateRef.current.startDistance === 0) {
          pinchStateRef.current.startDistance = distance;
        } else {
          const ratio = distance / pinchStateRef.current.startDistance;
          const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStateRef.current.startScale * ratio));
          applyViewport({ scale: nextScale });
        }
      }
      return;
    }

    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const current = getViewport();
    if (!current) return;

    if (activeTool === 'pan') {
      applyViewport({
        translation: {
          x: current.translation.x + dx / current.scale,
          y: current.translation.y + dy / current.scale,
        },
      });
    } else if (activeTool === 'zoom') {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * (1 - dy / 200)));
      applyViewport({ scale: nextScale });
    } else {
      applyViewport({
        voi: {
          windowWidth: Math.max(1, current.voi.windowWidth + dx * 2),
          windowCenter: current.voi.windowCenter + dy * 2,
        },
      });
    }
  }, [activeTool, applyViewport, getViewport, state]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) dragStateRef.current = null;
    if (pinchStateRef.current) {
      pinchStateRef.current.pointers.delete(event.pointerId);
      if (pinchStateRef.current.pointers.size < 2) pinchStateRef.current = null;
    }
  }, []);

  // React's onWheel is attached as a passive listener by the DOM (React 17+
  // delegates wheel to the root as passive), so preventDefault() there logs a
  // console warning and doesn't actually stop page scroll. A native listener
  // registered with { passive: false } is required to zoom without scrolling
  // the page underneath the modal.
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (stateRef.current !== 'ready') return;
      event.preventDefault();
      zoomByRef.current(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handleRetry = useCallback(() => setRetryToken(v => v + 1), []);

  const toolButtons: Array<{ id: ActiveTool; icon: React.ReactNode; labelKey: string }> = [
    { id: 'windowLevel', icon: <Contrast size={16} />, labelKey: 'imaging:viewer.windowLevel' },
    { id: 'pan', icon: <Hand size={16} />, labelKey: 'imaging:viewer.pan' },
    { id: 'zoom', icon: <MousePointer2 size={16} />, labelKey: 'imaging:viewer.zoom' },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-0 sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:h-[92vh] sm:max-w-5xl sm:rounded-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <p id={titleId} className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
            {fileName}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {state === 'ready' && toolButtons.map(tool => (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                aria-pressed={activeTool === tool.id}
                className={`rounded-lg p-2 ${activeTool === tool.id ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                aria-label={t(tool.labelKey) as string}
                title={t(tool.labelKey) as string}
              >
                {tool.icon}
              </button>
            ))}
            {state === 'ready' && (
              <>
                <button type="button" onClick={() => zoomBy(ZOOM_STEP)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label={t('imaging:viewer.zoomIn') as string} title={t('imaging:viewer.zoomIn') as string}>
                  <ZoomIn size={16} />
                </button>
                <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label={t('imaging:viewer.zoomOut') as string} title={t('imaging:viewer.zoomOut') as string}>
                  <ZoomOut size={16} />
                </button>
                <button type="button" onClick={handleFitToView} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label={t('imaging:viewer.fitToView') as string} title={t('imaging:viewer.fitToView') as string}>
                  <Maximize2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={handleInvert}
                  aria-pressed={invert}
                  className={`rounded-lg p-2 ${invert ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                  aria-label={t('imaging:viewer.invert') as string}
                  title={t('imaging:viewer.invert') as string}
                >
                  {t('imaging:viewer.invert') as string}
                </button>
                <button type="button" onClick={handleReset} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800" aria-label={t('imaging:viewer.reset') as string} title={t('imaging:viewer.reset') as string}>
                  <RotateCcw size={16} />
                </button>
              </>
            )}
            <button type="button" onClick={onDownload} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800" aria-label={t('imaging:viewer.secureDownload') as string} title={t('imaging:viewer.secureDownload') as string}>
              <Download size={16} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label={t('common:close') as string}
              title={t('common:close') as string}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-black"
        >
          <div
            ref={elementRef}
            className="h-full w-full"
            style={{ touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />

          {state === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300">
              <Loader2 className="animate-spin" size={32} />
              <p className="text-sm">{t('imaging:viewer.loading')}</p>
            </div>
          )}

          {state === 'multi-frame-unsupported' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-gray-300">
              <AlertTriangle size={40} className="opacity-70" />
              <p className="max-w-sm text-sm">{t('imaging:viewer.multiFrameUnsupported')}</p>
              <button type="button" onClick={onDownload} className="btn-primary mt-1 flex items-center gap-2 text-sm">
                <Download size={16} /> {t('imaging:viewer.secureDownload')}
              </button>
            </div>
          )}

          {state === 'unsupported' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-gray-300">
              <FileWarning size={40} className="opacity-70" />
              <p className="max-w-sm text-sm">{t('imaging:viewer.unsupportedTransferSyntax')}</p>
              <button type="button" onClick={onDownload} className="btn-primary mt-1 flex items-center gap-2 text-sm">
                <Download size={16} /> {t('imaging:viewer.secureDownload')}
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-gray-300">
              <AlertTriangle size={40} className="opacity-70" />
              <p className="max-w-sm text-sm">{t(errorMessageKey(errorKind))}</p>
              <div className="flex gap-2">
                <button type="button" onClick={handleRetry} className="btn-secondary text-sm">
                  {t('imaging:viewer.retry')}
                </button>
                {errorKind !== 'unauthorized' && (
                  <button type="button" onClick={onDownload} className="btn-primary flex items-center gap-2 text-sm">
                    <Download size={16} /> {t('imaging:viewer.secureDownload')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {state === 'ready' && metadata && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {modality && <span>{t('imaging:study.modality')}: {modality}</span>}
            {studyDate && <span>{t('imaging:study.date')}: {formatDate(studyDate)}</span>}
            {metadata.rows && metadata.columns && (
              <span>{t('imaging:viewer.dimensions')}: {metadata.columns}×{metadata.rows}</span>
            )}
            {metadata.bitsAllocated && (
              <span>{t('imaging:viewer.bitDepth')}: {metadata.bitsAllocated}/{metadata.bitsStored ?? metadata.bitsAllocated}</span>
            )}
            {metadata.photometricInterpretation && (
              <span>{t('imaging:viewer.photometricInterpretation')}: {metadata.photometricInterpretation}</span>
            )}
            <span>{t('imaging:viewer.numberOfFrames')}: {metadata.numberOfFrames}</span>
          </div>
        )}
      </div>
    </div>
  );
};

function errorMessageKey(kind: ViewerErrorKind | null): string {
  switch (kind) {
    case 'unauthorized':
      return 'imaging:viewer.accessDenied';
    case 'not-found':
      return 'imaging:viewer.fileNotFound';
    case 'network':
      return 'imaging:viewer.loadFailed';
    default:
      return 'imaging:viewer.initFailed';
  }
}

export default DicomViewer;
