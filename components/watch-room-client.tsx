"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { useWatchParty } from "@/hooks/use-watch-party";

const ICON_SIZE = 24;
const MIC_BAR_COUNT = 24;
const MIC_BUTTON_SIZE = 56;
const MIC_BUTTON_RADIUS = MIC_BUTTON_SIZE / 2;
const MIC_VISUALIZER_GAP = 3;

const VIDEO_TIME_STORAGE_KEY = "watch2gether-room-video-times";

function lastRemoteVideoStorageKey(roomId: string) {
  return `watch2gether-room-last-remote-url-${roomId}`;
}

function readStoredVideoTimes(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(VIDEO_TIME_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeStoredVideoTimes(map: Record<string, number>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(VIDEO_TIME_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function getStoredVideoTime(storageKey: string): number | null {
  const value = readStoredVideoTimes()[storageKey];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function persistVideoTime(storageKey: string, seconds: number) {
  const map = readStoredVideoTimes();
  if (!Number.isFinite(seconds) || seconds < 0.25) {
    delete map[storageKey];
  } else {
    map[storageKey] = seconds;
  }
  writeStoredVideoTimes(map);
}

function clearPersistedVideoTime(storageKey: string) {
  const map = readStoredVideoTimes();
  delete map[storageKey];
  writeStoredVideoTimes(map);
}

function fileVideoStorageKey(file: File): string {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

function urlVideoStorageKey(url: string): string {
  try {
    return `url:${new URL(url).href}`;
  } catch {
    return `url:${url}`;
  }
}

const restoredRemoteVideoRooms = new Set<string>();

type IconProps = {
  className: string;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type LegacyNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (err: Error) => void,
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    success: (stream: MediaStream) => void,
    error: (err: Error) => void,
  ) => void;
};

async function requestUserMedia(constraints: MediaStreamConstraints) {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyNavigator = navigator as LegacyNavigator;
  const legacyGetUserMedia =
    legacyNavigator.webkitGetUserMedia ?? legacyNavigator.getUserMedia;

  if (!legacyGetUserMedia) {
    throw new Error("getUserMedia is not supported in this browser");
  }

  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(legacyNavigator, constraints, resolve, reject);
  });
}

async function requestUserMediaWithFallback(constraints: MediaStreamConstraints) {
  try {
    return await requestUserMedia(constraints);
  } catch {
    const fallbackConstraints: MediaStreamConstraints = {
      audio: constraints.audio ? true : false,
      video: constraints.video ? true : false,
    };
    return requestUserMedia(fallbackConstraints);
  }
}

async function withMediaTimeout<T>(promise: Promise<T>, label: string) {
  const timeoutMs = 10000;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function MicOnIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M6.5 10.5a5.5 5.5 0 1 0 11 0" />
      <path d="M12 16v5" />
      <path d="M9 21.5h6" />
    </svg>
  );
}

function MicOffIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M6.5 10.5a5.5 5.5 0 0 0 9.3 4" />
      <path d="M12 16v5" />
      <path d="M9 21.5h6" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

function CameraOnIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="7" width="14" height="10" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
    </svg>
  );
}

function CameraOffIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="7" width="14" height="10" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

type ControlButtonProps = {
  isOn: boolean;
  onPress: () => void;
  ariaLabel: string;
  OnIcon: ({ className }: IconProps) => ReactElement;
  OffIcon: ({ className }: IconProps) => ReactElement;
};

function ControlButton({
  isOn,
  onPress,
  ariaLabel,
  OnIcon,
  OffIcon,
}: ControlButtonProps) {
  const Icon = isOn ? OnIcon : OffIcon;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onPress}
      className={`relative z-20 inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        isOn
          ? "border-emerald-200/80 bg-emerald-300/35"
          : "border-red-200/70 bg-red-300/35"
      }`}
    >
      <Icon className={isOn ? "text-white" : "text-red-600"} />
    </button>
  );
}

function MicVisualizer({ level }: { level: number }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: MIC_BAR_COUNT }).map((_, index) => {
        const angle = (360 / MIC_BAR_COUNT) * index;
        const variance = 0.7 + 0.3 * Math.sin((index / MIC_BAR_COUNT) * Math.PI * 6);
        const barHeight = 1 + Math.min(7, level * 12 * variance);
        const distanceFromCenter =
          MIC_BUTTON_RADIUS + MIC_VISUALIZER_GAP + barHeight / 2;

        return (
          <span
            key={index}
            className="absolute left-1/2 top-1/2 w-[3px] -translate-x-1/2 rounded-full bg-emerald-300/60"
            style={{
              height: `${barHeight}px`,
              transform: `rotate(${angle}deg) translateY(-${distanceFromCenter}px)`,
              transformOrigin: "center center",
            }}
          />
        );
      })}
    </div>
  );
}

function RemotePeerMedia({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const trackKey = stream
    .getTracks()
    .map((t) => `${t.id}:${t.readyState}`)
    .join("|");

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const bind = () => {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    };

    bind();
    stream.addEventListener("addtrack", bind);
    stream.addEventListener("removetrack", bind);

    return () => {
      stream.removeEventListener("addtrack", bind);
      stream.removeEventListener("removetrack", bind);
      el.srcObject = null;
    };
  }, [stream, trackKey]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={false}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

export function WatchRoomClient({ roomId }: { roomId: string }) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [mediaError, setMediaError] = useState("");
  const [isMicLoading, setIsMicLoading] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("Ready");
  const [movieUrl, setMovieUrl] = useState("");
  const [isMovieLoading, setIsMovieLoading] = useState(false);
  const [movieLoadProgress, setMovieLoadProgress] = useState(0);
  const [movieError, setMovieError] = useState("");
  const [showFormatWarning, setShowFormatWarning] = useState(false);
  const [rejectedFileName, setRejectedFileName] = useState("");
  const [movieProgressLabel, setMovieProgressLabel] = useState("");
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [linkModalError, setLinkModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const moviePlayerRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const micFrameRef = useRef<number | null>(null);
  const movieProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoResumeKeyRef = useRef<string | null>(null);
  const resumeSeekAppliedRef = useRef(false);
  const lastPeriodicTimeSaveRef = useRef(0);
  const movieUrlRef = useRef("");
  const applyingRemoteVideoRef = useRef(false);
  const prevPeerCountForVideoRef = useRef(0);
  const [inviteCopied, setInviteCopied] = useState(false);

  useEffect(() => {
    movieUrlRef.current = movieUrl;
  }, [movieUrl]);

  const { sortedPeerIds, remoteStreams, isHost, sendVideoParty, setVideoPartyHandler, myPeerId } =
    useWatchParty({
      roomId,
      isMicOn,
      isCameraOn,
      micStreamRef,
      cameraStreamRef: streamRef,
    });

  const stopMic = () => {
    if (micFrameRef.current !== null) {
      cancelAnimationFrame(micFrameRef.current);
      micFrameRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close();
      micAudioContextRef.current = null;
    }

    micAnalyserRef.current = null;
    micDataRef.current = null;
    setMicLevel(0);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startMic = async () => {
    const stream = await withMediaTimeout(
      requestUserMediaWithFallback({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
      "Microphone",
    );
    const AudioContextCtor =
      window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;

    if (!AudioContextCtor) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("AudioContext is not supported");
    }

    const audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    source.connect(analyser);

    micStreamRef.current = stream;
    micAudioContextRef.current = audioContext;
    micAnalyserRef.current = analyser;
    micDataRef.current = new Uint8Array(analyser.frequencyBinCount);

    const animate = () => {
      if (!micAnalyserRef.current || !micDataRef.current) {
        return;
      }

      micAnalyserRef.current.getByteTimeDomainData(micDataRef.current);

      let sum = 0;
      for (const value of micDataRef.current) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / micDataRef.current.length);
      setMicLevel(Math.min(1, rms * 5));
      micFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
  };

  const startCamera = async () => {
    const stream = await withMediaTimeout(
      requestUserMediaWithFallback({
        video: true,
        audio: false,
      }),
      "Camera",
    );

    streamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }
  };

  const handleMicToggle = async () => {
    setMediaStatus("Mic button pressed");

    if (isMicOn) {
      stopMic();
      setIsMicOn(false);
      setIsMicLoading(false);
      setMediaStatus("Microphone off");
      return;
    }

    try {
      setIsMicLoading(true);
      setMediaError("Requesting microphone access...");
      await startMic();
      setMediaError("");
      setIsMicOn(true);
      setMediaStatus("Microphone on");
    } catch (error) {
      stopMic();
      setIsMicOn(false);
      const message =
        error instanceof Error ? error.message : "Unknown microphone error";
      setMediaError(
        `Microphone access failed: ${message}`,
      );
      setMediaStatus("Microphone failed");
    } finally {
      setIsMicLoading(false);
    }
  };

  const handleCameraToggle = async () => {
    setMediaStatus("Camera button pressed");

    if (isCameraOn) {
      stopCamera();
      setIsCameraOn(false);
      setIsCameraLoading(false);
      setMediaStatus("Camera off");
      return;
    }

    try {
      setIsCameraLoading(true);
      setMediaError("Requesting camera access...");
      await startCamera();
      setMediaError("");
      setIsCameraOn(true);
      setMediaStatus("Camera on");
    } catch (error) {
      stopCamera();
      setIsCameraOn(false);
      const message = error instanceof Error ? error.message : "Unknown camera error";
      setMediaError(`Camera access failed: ${message}`);
      setMediaStatus("Camera failed");
    } finally {
      setIsCameraLoading(false);
    }
  };

  const handleMovieButtonClick = () => {
    fileInputRef.current?.click();
  };

  const clearMovieProgressInterval = () => {
    if (movieProgressIntervalRef.current) {
      clearInterval(movieProgressIntervalRef.current);
      movieProgressIntervalRef.current = null;
    }
  };

  const releaseMovieUrl = (urlToRelease: string) => {
    if (urlToRelease.startsWith("blob:")) {
      URL.revokeObjectURL(urlToRelease);
    }
  };

  const startMovieLoadUI = (progressLabel: string) => {
    setMovieError("");
    setMovieProgressLabel(progressLabel);
    setIsMovieLoading(true);
    setMovieLoadProgress(1);

    clearMovieProgressInterval();

    movieProgressIntervalRef.current = setInterval(() => {
      setMovieLoadProgress((current) => {
        if (current >= 90) {
          return current;
        }
        return current + 3;
      });
    }, 120);
  };

  const loadMovieFile = (selectedFile: File) => {
    if (movieUrl) {
      releaseMovieUrl(movieUrl);
    }

    try {
      localStorage.removeItem(lastRemoteVideoStorageKey(roomId));
    } catch {
      /* ignore */
    }

    videoResumeKeyRef.current = fileVideoStorageKey(selectedFile);
    startMovieLoadUI("Preparing playback…");
    setMovieUrl(URL.createObjectURL(selectedFile));
  };

  const applyVideoUrl = (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false as const, error: "Enter a valid URL (starting with https:// or http://)." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false as const, error: "Only http and https links are supported." };
    }

    if (movieUrl) {
      releaseMovieUrl(movieUrl);
    }

    try {
      localStorage.setItem(lastRemoteVideoStorageKey(roomId), trimmed);
    } catch {
      /* ignore */
    }

    videoResumeKeyRef.current = urlVideoStorageKey(trimmed);
    startMovieLoadUI("Loading video from link…");
    setMovieUrl(trimmed);
    sendVideoParty({ type: "video", action: "load", url: trimmed });
    return { ok: true as const };
  };

  useEffect(() => {
    setVideoPartyHandler((msg) => {
      if (msg.action === "load") {
        if (movieUrlRef.current === msg.url) {
          return;
        }
        const prev = movieUrlRef.current;
        if (prev.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        applyingRemoteVideoRef.current = true;
        videoResumeKeyRef.current = urlVideoStorageKey(msg.url);
        startMovieLoadUI("Syncing shared video…");
        setMovieUrl(msg.url);
        return;
      }

      if (msg.action === "sync") {
        const v = moviePlayerRef.current;
        if (!v) {
          return;
        }
        applyingRemoteVideoRef.current = true;
        v.playbackRate = Number.isFinite(msg.v) && msg.v > 0 ? msg.v : 1;
        const drift = Math.abs(v.currentTime - msg.t);
        if (drift > 1.25) {
          v.currentTime = msg.t;
        }
        if (msg.paused && !v.paused) {
          void v.pause();
        } else if (!msg.paused && v.paused) {
          void v.play().catch(() => undefined);
        }
        queueMicrotask(() => {
          applyingRemoteVideoRef.current = false;
        });
      }
    });
  }, [setVideoPartyHandler]);

  useEffect(() => {
    const n = sortedPeerIds.length;
    if (!isHost) {
      prevPeerCountForVideoRef.current = n;
      return;
    }
    if (n > prevPeerCountForVideoRef.current) {
      prevPeerCountForVideoRef.current = n;
      const v = moviePlayerRef.current;
      const u = movieUrlRef.current;
      if (u.startsWith("http://") || u.startsWith("https://")) {
        sendVideoParty({ type: "video", action: "load", url: u });
      }
      if (v && u) {
        sendVideoParty({
          type: "video",
          action: "sync",
          paused: v.paused,
          t: v.currentTime,
          v: v.playbackRate || 1,
        });
      }
    } else {
      prevPeerCountForVideoRef.current = n;
    }
  }, [sortedPeerIds.length, isHost, sendVideoParty]);

  useEffect(() => {
    if (!isHost) {
      return;
    }
    const v = moviePlayerRef.current;
    if (!v || !movieUrl) {
      return;
    }

    const send = () => {
      if (applyingRemoteVideoRef.current) {
        return;
      }
      sendVideoParty({
        type: "video",
        action: "sync",
        paused: v.paused,
        t: v.currentTime,
        v: v.playbackRate || 1,
      });
    };

    v.addEventListener("play", send);
    v.addEventListener("pause", send);
    v.addEventListener("seeked", send);
    const id = window.setInterval(send, 2500);

    return () => {
      v.removeEventListener("play", send);
      v.removeEventListener("pause", send);
      v.removeEventListener("seeked", send);
      window.clearInterval(id);
    };
  }, [isHost, movieUrl, sendVideoParty]);

  const handlePlayFromLinkSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLinkModalError("");

    const result = applyVideoUrl(linkUrlInput);
    if (!result.ok) {
      setLinkModalError(result.error);
      return;
    }

    setShowLinkModal(false);
    setLinkUrlInput("");
  };

  const handleMovieSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    const isMp4 = selectedFile.type === "video/mp4" || /\.mp4$/i.test(selectedFile.name);

    if (!isMp4) {
      setRejectedFileName(selectedFile.name);
      setShowFormatWarning(true);
      setMovieError("");
      event.target.value = "";
      return;
    }

    loadMovieFile(selectedFile);
    event.target.value = "";
  };

  const saveCurrentVideoTime = (video: HTMLVideoElement) => {
    const key = videoResumeKeyRef.current;
    if (!key) {
      return;
    }
    if (video.ended) {
      clearPersistedVideoTime(key);
      return;
    }
    const t = video.currentTime;
    if (Number.isFinite(t) && t >= 0.25) {
      persistVideoTime(key, t);
    }
  };

  const handleMovieLoaded = () => {
    clearMovieProgressInterval();

    setMovieLoadProgress(100);
    setIsMovieLoading(false);
    setMovieProgressLabel("");

    syncMovieAudioState();

    applyingRemoteVideoRef.current = false;

    const video = moviePlayerRef.current;
    const key = videoResumeKeyRef.current;
    if (video && key && !resumeSeekAppliedRef.current) {
      resumeSeekAppliedRef.current = true;
      const saved = getStoredVideoTime(key);
      if (saved != null && Number.isFinite(saved) && saved >= 0.25) {
        const seekToSaved = () => {
          let end = video.duration;
          if (!Number.isFinite(end) || end <= 0) {
            if (video.seekable && video.seekable.length > 0) {
              end = video.seekable.end(video.seekable.length - 1);
            }
          }
          if (!Number.isFinite(end) || end <= 0) {
            return;
          }
          const target = Math.min(saved, Math.max(0, end - 0.25));
          if (target >= 0.25) {
            video.currentTime = target;
          }
        };

        seekToSaved();
        video.addEventListener("loadedmetadata", seekToSaved, { once: true });
      }
    }
  };

  const syncMovieAudioState = () => {
    if (!moviePlayerRef.current) {
      return;
    }

    moviePlayerRef.current.muted = false;
    moviePlayerRef.current.defaultMuted = false;
    moviePlayerRef.current.volume = 1;
  };

  const handleMovieLoadError = () => {
    clearMovieProgressInterval();

    setMovieError("Could not load this video file.");
    setIsMovieLoading(false);
    setMovieLoadProgress(0);
    setMovieProgressLabel("");

    if (movieUrl.startsWith("http://") || movieUrl.startsWith("https://")) {
      try {
        localStorage.removeItem(lastRemoteVideoStorageKey(roomId));
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    return () => {
      stopMic();
      stopCamera();
      clearMovieProgressInterval();
      if (movieUrl) {
        releaseMovieUrl(movieUrl);
      }
    };
  }, [movieUrl]);

  useEffect(() => {
    resumeSeekAppliedRef.current = false;
    lastPeriodicTimeSaveRef.current = 0;
  }, [movieUrl]);

  useEffect(() => {
    if (restoredRemoteVideoRooms.has(roomId)) {
      return;
    }
    restoredRemoteVideoRooms.add(roomId);

    try {
      const raw = localStorage.getItem(lastRemoteVideoStorageKey(roomId))?.trim();
      if (!raw) {
        return;
      }
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return;
      }
      videoResumeKeyRef.current = urlVideoStorageKey(raw);
      startMovieLoadUI("Restoring last video…");
      setMovieUrl(raw);
    } catch {
      /* ignore invalid stored URL */
    }
  }, [roomId]);

  useEffect(() => {
    const onPageHide = () => {
      const video = moviePlayerRef.current;
      if (video) {
        saveCurrentVideoTime(video);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    if (showLinkModal && linkInputRef.current) {
      linkInputRef.current.focus();
      linkInputRef.current.select();
    }
  }, [showLinkModal]);

  return (
    <div
      className="flex min-h-screen"
      style={{
        backgroundColor: "#2a0f44",
        backgroundImage: "linear-gradient(135deg, #2a0f44 0%, #5c2a72 52%, #f2a42a 100%)",
      }}
    >
      <main className="flex flex-1 flex-col">
        <section className="relative m-4 flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black/30">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.mkv,.avi,.webm,.mov"
            className="hidden"
            onChange={handleMovieSelect}
          />

          {movieUrl ? (
            <video
              ref={moviePlayerRef}
              src={movieUrl}
              controls={isHost}
              onLoadedData={handleMovieLoaded}
              onPlay={() => {
                syncMovieAudioState();
              }}
              onPause={(event) => {
                saveCurrentVideoTime(event.currentTarget);
              }}
              onTimeUpdate={(event) => {
                const now = Date.now();
                if (now - lastPeriodicTimeSaveRef.current < 3000) {
                  return;
                }
                lastPeriodicTimeSaveRef.current = now;
                saveCurrentVideoTime(event.currentTarget);
              }}
              onEnded={(event) => {
                saveCurrentVideoTime(event.currentTarget);
              }}
              onError={handleMovieLoadError}
              className="h-full w-full bg-black object-contain"
            />
          ) : null}

          {isMovieLoading ? (
            <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-white/20 bg-black/35 px-6 py-5">
              <p className="text-center text-sm font-medium leading-snug text-white/90">
                {movieProgressLabel || "Loading video…"}
              </p>
              <p className="text-xs text-white/70">{movieLoadProgress}%</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${movieLoadProgress}%` }}
                />
              </div>
            </div>
          ) : null}

          {!movieUrl && !isMovieLoading ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleMovieButtonClick}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/80 bg-white/10 px-6 py-3 text-lg font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <span className="text-2xl leading-none">+</span>
                <span>Upload a file</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLinkModalError("");
                  setLinkUrlInput("");
                  setShowLinkModal(true);
                }}
                className="inline-flex cursor-pointer items-center rounded-xl border border-white/80 bg-white/10 px-6 py-3 text-lg font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                Play from a link
              </button>
            </div>
          ) : null}

          {movieError ? (
            <p className="absolute bottom-4 text-sm text-red-200">{movieError}</p>
          ) : null}

          {showFormatWarning ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-2xl border border-white/20 bg-[#2c153f] p-6 text-white shadow-2xl">
                <h3 className="text-lg font-semibold">Only MP4 is supported</h3>
                <p className="mt-3 text-sm text-white/85">
                  This room accepts <strong className="text-white">MP4</strong> files only
                  {rejectedFileName ? (
                    <>
                      . The file you chose (<span className="font-mono text-white/95">{rejectedFileName}</span>)
                      is not MP4.
                    </>
                  ) : (
                    "."
                  )}
                </p>
                <p className="mt-2 text-sm text-white/85">
                  {/\.mkv$/i.test(rejectedFileName) || /matroska/i.test(rejectedFileName) ? (
                    <>
                      <strong className="text-white">MKV (Matroska)</strong> is a container format.
                      Browsers play MP4 reliably; MKV often bundles codecs (video/audio) Chrome and
                      others cannot decode in the HTML video player, which leads to no audio, errors,
                      or a black screen.
                    </>
                  ) : (
                    <>
                      Formats like <strong className="text-white">MKV</strong>,{" "}
                      <strong className="text-white">AVI</strong>, and similar containers often use
                      codecs the browser cannot play in this player, so you may get no sound, errors,
                      or a black screen.
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm text-white/85">
                  Please export or convert to <strong className="text-white">MP4</strong> (usually
                  H.264 video and AAC audio), then upload again.
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFormatWarning(false);
                      setRejectedFileName("");
                    }}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-violet-900"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showLinkModal ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
              <div
                className="w-full max-w-lg rounded-2xl border border-white/20 bg-[#2c153f] p-6 text-white shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="link-modal-title"
              >
                <h3 id="link-modal-title" className="text-lg font-semibold">
                  Play from a link
                </h3>
                <p className="mt-2 text-sm text-white/80">
                  Paste a direct link to a video file (for example an .mp4 URL). Some hosts block
                  playback in the browser.
                </p>
                <form onSubmit={handlePlayFromLinkSubmit} className="mt-4">
                  <label htmlFor="video-link-url" className="sr-only">
                    Video URL
                  </label>
                  <input
                    ref={linkInputRef}
                    id="video-link-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://example.com/video.mp4"
                    value={linkUrlInput}
                    onChange={(e) => {
                      setLinkUrlInput(e.target.value);
                      setLinkModalError("");
                    }}
                    className="w-full rounded-lg border border-white/25 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                  {linkModalError ? (
                    <p className="mt-2 text-sm text-red-200">{linkModalError}</p>
                  ) : null}
                  <div className="mt-5 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowLinkModal(false);
                        setLinkUrlInput("");
                        setLinkModalError("");
                      }}
                      className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white/90"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-violet-900"
                    >
                      Play
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </section>

        <section
          className="relative z-20 mx-4 mb-4 rounded-2xl border border-white/20 bg-black/25 p-4 pointer-events-auto"
        >
          <div className="relative z-20 flex items-center justify-center gap-4 pointer-events-auto">
            <div className="relative z-20 flex h-14 w-14 items-center justify-center">
              {isMicOn ? <MicVisualizer level={micLevel} /> : null}
              <ControlButton
                isOn={isMicOn}
                onPress={() => {
                  void handleMicToggle();
                }}
                ariaLabel={isMicOn ? "Turn microphone off" : "Turn microphone on"}
                OnIcon={MicOnIcon}
                OffIcon={MicOffIcon}
              />
            </div>
            <ControlButton
              isOn={isCameraOn}
              onPress={() => {
                void handleCameraToggle();
              }}
              ariaLabel={isCameraOn ? "Turn camera off" : "Turn camera on"}
              OnIcon={CameraOnIcon}
              OffIcon={CameraOffIcon}
            />
          </div>
          {mediaError ? (
            <p className="mt-3 text-center text-sm text-red-200">{mediaError}</p>
          ) : null}
          {isMicLoading || isCameraLoading ? (
            <p className="mt-1 text-center text-xs text-white/75">
              Waiting for Safari media permission...
            </p>
          ) : null}
          <p className="mt-1 text-center text-xs text-white/70">{mediaStatus}</p>
        </section>
      </main>

      <aside className="m-4 ml-0 flex w-64 flex-col rounded-2xl border border-white/20 bg-black/25 p-4">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/85">
          Users
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {sortedPeerIds.length === 0 ? (
            <p className="text-center text-xs text-white/60">Connecting…</p>
          ) : (
            sortedPeerIds.map((peerId, index) => {
              const displayNum = index + 1;
              const isSelf = myPeerId !== null && peerId === myPeerId;
              const remote = remoteStreams.get(peerId);

              return (
                <div
                  key={peerId}
                  className="relative h-36 shrink-0 overflow-hidden rounded-xl border border-white/25 bg-white/10"
                >
                  {isSelf ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                          isCameraOn ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {!isCameraOn ? (
                        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-lg font-semibold text-white">
                          {displayNum}
                        </div>
                      ) : (
                        <div className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
                          {displayNum}
                        </div>
                      )}
                    </>
                  ) : remote ? (
                    <>
                      <RemotePeerMedia stream={remote} />
                      <div className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
                        {displayNum}
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-lg font-semibold text-white">
                      {displayNum}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <button
          type="button"
          onClick={async () => {
            const inviteUrl = `${window.location.origin}/room/${roomId}`;
            try {
              await navigator.clipboard.writeText(inviteUrl);
              setInviteCopied(true);
              window.setTimeout(() => setInviteCopied(false), 2000);
            } catch {
              setInviteCopied(false);
            }
          }}
          className="mt-4 w-full rounded-xl border border-white/80 bg-white/10 px-4 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {inviteCopied ? "Invite link copied" : "Invite users"}
        </button>
      </aside>
    </div>
  );
}
