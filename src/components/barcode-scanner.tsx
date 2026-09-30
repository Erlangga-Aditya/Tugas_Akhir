'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, ScanLine, Volume2, VolumeX } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * Scanner resi yang bisa dipakai dengan kamera, alat scan USB, atau ketikan manual.
 * Hasil barcode selalu diteruskan ke onScan; komponen ini tidak pernah mengambil
 * nomor resi dari server dan mengirimkannya seolah-olah hasil scan.
 */
export function playScanFeedback(ok: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      const gain = context.createGain();
      gain.connect(context.destination);
      const oscillator = context.createOscillator();
      oscillator.type = ok ? 'sine' : 'sawtooth';
      oscillator.frequency.setValueAtTime(ok ? 880 : 200, context.currentTime);
      gain.gain.setValueAtTime(ok ? 0.2 : 0.22, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + (ok ? 0.18 : 0.28));
      oscillator.connect(gain);
      oscillator.start();
      oscillator.stop(context.currentTime + (ok ? 0.18 : 0.28));
    }
    navigator.vibrate?.(ok ? [70] : [140, 60, 140]);
  } catch {
    // Audio bisa diblokir sebelum interaksi pertama; hasil scan tetap diproses.
  }
}

type Engine = 'native' | 'zxing';
type CameraState = 'idle' | 'requesting' | 'ready' | 'stopping' | 'error';

export interface BarcodeScannerProps {
  onScan: (code: string) => void | Promise<void>;
  label?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  withSound?: boolean;
  autoStartCamera?: boolean;
  /** When changed, focus the manual input (used when an operator chooses a row's scan action). */
  focusRequest?: number;
}

const FORMATS_NATIVE = ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'itf'];
const FORMATS_ZXING = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];

export function BarcodeScanner({
  onScan,
  label = 'Scan barcode',
  placeholder = 'Scan atau ketik kode lalu Enter',
  hint,
  submitLabel = 'Proses',
  disabled = false,
  autoFocus = true,
  withSound = true,
  autoStartCamera = false,
  focusRequest = 0,
}: BarcodeScannerProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [engine, setEngine] = useState<Engine>('zxing');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const nativeLastFrameAtRef = useRef(0);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const cameraRequestRef = useRef(0);
  const cameraStartingRef = useRef(false);
  const onScanRef = useRef(onScan);
  const withSoundRef = useRef(withSound && soundOn);

  useEffect(() => {
    onScanRef.current = onScan;
    withSoundRef.current = withSound && soundOn;
  }, [onScan, withSound, soundOn]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
      setCameraSupported(supported);
      if (!supported) {
        setCameraNote(
          typeof window !== 'undefined' && window.isSecureContext === false
            ? 'Kamera hanya bisa dipakai lewat alamat HTTPS. Buka aplikasi memakai alamat https:// Anda, atau pakai alat scan barcode USB / ketik manual.'
            : 'Peramban ini tidak menyediakan akses kamera. Pakai alat scan barcode USB atau ketik manual.',
        );
      } else {
        setCameraNote(null);
      }
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const Detector = (window as unknown as { BarcodeDetector: new (options?: { formats: string[] }) => unknown })
            .BarcodeDetector;
          new Detector({ formats: FORMATS_NATIVE });
          setEngine('native');
        } catch {
          setEngine('zxing');
        }
      } else {
        setEngine('zxing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoFocus && focusRequest === 0) return;
    const timer = setTimeout(() => inputRef.current?.focus(), focusRequest > 0 ? 0 : 150);
    return () => clearTimeout(timer);
  }, [autoFocus, focusRequest]);

  const submit = useCallback(
    async (raw?: string) => {
      const code = (raw ?? value).trim();
      if (!code || busy || disabled) return;
      setBusy(true);
      try {
        await onScanRef.current(code);
        setValue('');
      } finally {
        setBusy(false);
      }
    },
    [value, busy, disabled],
  );
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    cameraStartingRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      zxingControlsRef.current?.stop();
    } catch {
      // Decoder sudah berhenti.
    }
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const waitForMediaReady = useCallback((video: HTMLVideoElement): Promise<void> => {
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onReady = () => {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
      };
      const onError = () => finish(new Error('Kamera tidak dapat menampilkan video.'));
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('canplay', onReady);
      video.addEventListener('error', onError);
    });
  }, []);

  const startCamera = useCallback(async () => {
    if (cameraStartingRef.current || streamRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Peramban ini tidak mendukung kamera. Pakai alat scan laser atau ketik manual.');
      setCameraState('error');
      return;
    }
    cameraStartingRef.current = true;
    const requestId = ++cameraRequestRef.current;
    setCameraState('requesting');
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
        },
        audio: false,
      });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Elemen video kamera tidak tersedia.');
      video.srcObject = stream;
      await video.play();
      await waitForMediaReady(video);
      if (requestId !== cameraRequestRef.current) return;
      setCameraState('ready');
    } catch (error) {
      if (requestId !== cameraRequestRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const name = (error as Error).name;
      setCameraError(
        name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan akses kamera di peramban, atau pakai alat scan laser / input manual.'
          : name === 'NotFoundError'
            ? 'Kamera tidak ditemukan di perangkat ini. Pakai alat scan laser atau ketik manual.'
            : `Gagal mengakses kamera: ${(error as Error).message}`,
      );
      setCameraState('error');
    } finally {
      if (requestId === cameraRequestRef.current) cameraStartingRef.current = false;
    }
  }, [waitForMediaReady]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!autoStartCamera || !cameraSupported || cameraState !== 'idle') return;
    const timer = setTimeout(() => void startCamera(), 300);
    return () => clearTimeout(timer);
  }, [autoStartCamera, cameraSupported, cameraState, startCamera]);

  const handleDetected = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last && last.code === code && now - last.at < 2500) return;
    lastCodeRef.current = { code, at: now };
    if (withSoundRef.current) playScanFeedback(true);
    await submitRef.current(code);
  }, []);

  useEffect(() => {
    if (cameraState !== 'ready' || engine !== 'native' || typeof window === 'undefined') return;
    type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
    let running = true;
    let detector: Detector;
    try {
      const DetectorClass = (window as unknown as { BarcodeDetector: new (options?: { formats: string[] }) => Detector })
        .BarcodeDetector;
      detector = new DetectorClass({ formats: FORMATS_NATIVE });
    } catch {
      return;
    }
    const tick = async (timestamp: number) => {
      if (!running) return;
      if (timestamp - nativeLastFrameAtRef.current >= 120) {
        nativeLastFrameAtRef.current = timestamp;
        const video = videoRef.current;
        if (video?.readyState && video.readyState >= 2) {
          try {
            const results = await detector.detect(video);
            const code = results[0]?.rawValue;
            if (code) await handleDetected(code);
          } catch {
            // Frame berikutnya tetap mencoba membaca; error satu frame bukan kegagalan kamera.
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraState, engine, handleDetected]);

  useEffect(() => {
    if (cameraState !== 'ready' || engine !== 'zxing') return;
    const video = videoRef.current;
    if (!video) return;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS_ZXING);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 200,
      delayBetweenScanSuccess: 1200,
    });
    let stopped = false;
    reader
      .decodeFromVideoElement(video, (result) => {
        if (stopped || !result) return;
        void handleDetected(result.getText());
      })
      .then((controls) => {
        if (stopped) controls.stop();
        else zxingControlsRef.current = controls;
      })
      .catch((error: unknown) => {
        if (stopped) return;
        setCameraError(`Kamera tidak bisa membaca kode: ${(error as Error).message}`);
        setCameraState('error');
      });
    return () => {
      stopped = true;
      try {
        zxingControlsRef.current?.stop();
      } catch {
        // Decoder sudah berhenti.
      }
      zxingControlsRef.current = null;
    };
  }, [cameraState, engine, handleDetected]);

  const cameraBusy = cameraState === 'requesting';
  return (
    <div className="barcode-scanner">
      {label ? <label className="scanner-label">{label}</label> : null}
      <div className="scanner-controls">
        <div className="scanner-input-wrap">
          <Keyboard size={15} aria-hidden className="scanner-input-icon" />
          <input
            ref={inputRef}
            className="input mono scanner-input"
            value={value}
            placeholder={placeholder}
            disabled={disabled || busy}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={disabled || busy || !value.trim()} onClick={() => void submit()}>
          <ScanLine size={15} aria-hidden />
          <span>{busy ? 'Memproses...' : submitLabel}</span>
        </button>
        {cameraSupported ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || cameraBusy}
            onClick={() => {
              if (cameraState === 'ready' || cameraState === 'requesting') {
                stopCamera();
                setCameraState('idle');
              } else {
                void startCamera();
              }
            }}
          >
            {cameraState === 'ready' ? <CameraOff size={15} aria-hidden /> : <Camera size={15} aria-hidden />}
            <span>{cameraState === 'ready' ? 'Matikan Kamera' : cameraBusy ? 'Menyiapkan...' : 'Scan dengan Kamera'}</span>
          </button>
        ) : null}
        {withSound ? (
          <button type="button" className="btn btn-ghost" title={soundOn ? 'Suara aktif' : 'Suara mati'} onClick={() => setSoundOn((current) => !current)}>
            {soundOn ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}
          </button>
        ) : null}
      </div>
      {hint ? <p className="small muted scanner-hint">{hint}</p> : null}
      {!cameraSupported && cameraNote ? <p className="small scanner-warning">{cameraNote}</p> : null}
      {cameraError ? <p className="small scanner-error">{cameraError}</p> : null}
      <div className={`scanner-camera-shell ${cameraState === 'ready' ? 'is-ready' : ''}`} aria-hidden={cameraState !== 'ready'}>
        <video ref={videoRef} className="scanner-video" playsInline muted />
        {cameraState === 'requesting' ? <div className="scanner-camera-status">Menyiapkan kamera...</div> : null}
        {cameraState === 'ready' ? (
          <>
            <div className="scanner-reticle" aria-hidden />
            <div className="scanner-camera-tip">Arahkan barcode resi ke dalam kotak</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
