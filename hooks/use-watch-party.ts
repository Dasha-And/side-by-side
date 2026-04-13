"use client";

import { getPartyKitHost } from "@/lib/party-host";
import PartySocket from "partysocket";
import Peer from "simple-peer";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

type PeerCtor = typeof Peer;
type PeerInstance = InstanceType<PeerCtor>;
type PeerSignal = Parameters<PeerInstance["signal"]>[0];
type PeerOptions = NonNullable<ConstructorParameters<PeerCtor>[0]>;

export type PartyVideoMessage =
  | { type: "video"; action: "load"; url: string }
  | { type: "video"; action: "sync"; paused: boolean; t: number; v: number };

type RtcMessage = {
  type: "rtc";
  to: string;
  from: string;
  signal: PeerSignal;
};

function isRtcMessage(x: unknown): x is RtcMessage {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as RtcMessage).type === "rtc" &&
    typeof (x as RtcMessage).to === "string" &&
    typeof (x as RtcMessage).from === "string"
  );
}

/** Public STUN helps peers find each other across NAT; required for most non-localhost use. */
const DEFAULT_PEER_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const MEDIA_SYNC_DEBOUNCE_MS = 120;

function isPartyVideoMessage(x: unknown): x is PartyVideoMessage {
  if (typeof x !== "object" || x === null || (x as { type?: string }).type !== "video") {
    return false;
  }
  const m = x as PartyVideoMessage;
  if (m.action === "load") {
    return typeof (m as { url?: string }).url === "string";
  }
  if (m.action === "sync") {
    return (
      typeof m.paused === "boolean" &&
      typeof m.t === "number" &&
      typeof m.v === "number"
    );
  }
  return false;
}

function syncPeerOutboundMedia(peer: PeerInstance, outbound: MediaStream | null) {
  const want =
    outbound && outbound.getTracks().length > 0 ? new Set(outbound.getTracks()) : new Set<MediaStreamTrack>();

  for (const stream of [...peer.streams]) {
    for (const t of [...stream.getTracks()]) {
      if (!want.has(t)) {
        try {
          peer.removeTrack(t, stream);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!outbound || want.size === 0) {
    return;
  }

  const current = new Set(peer.streams.flatMap((s) => s.getTracks()));
  for (const t of outbound.getTracks()) {
    if (!current.has(t)) {
      try {
        peer.addTrack(t, outbound);
      } catch {
        /* ignore */
      }
    }
  }
}

export function useWatchParty(options: {
  roomId: string;
  isMicOn: boolean;
  isCameraOn: boolean;
  micStreamRef: RefObject<MediaStream | null>;
  cameraStreamRef: RefObject<MediaStream | null>;
}) {
  const { roomId, isMicOn, isCameraOn, micStreamRef, cameraStreamRef } = options;

  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [hostPeerId, setHostPeerId] = useState<string | null>(null);
  const [sortedPeerIds, setSortedPeerIds] = useState<string[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const socketRef = useRef<PartySocket | null>(null);
  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const myPeerIdRef = useRef<string | null>(null);
  const hostPeerIdRef = useRef<string | null>(null);
  const sortedPeerIdsRef = useRef<string[]>([]);
  /** Single outbound stream object so addTrack/removeTrack stays consistent across the mesh. */
  const outboundStreamRef = useRef<MediaStream | null>(null);
  const mediaSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onVideoPartyMessageRef = useRef<(msg: PartyVideoMessage) => void>(() => {});

  const setVideoHandler = useCallback((fn: (msg: PartyVideoMessage) => void) => {
    onVideoPartyMessageRef.current = fn;
  }, []);

  useEffect(() => {
    myPeerIdRef.current = myPeerId;
  }, [myPeerId]);

  useEffect(() => {
    hostPeerIdRef.current = hostPeerId;
  }, [hostPeerId]);

  useEffect(() => {
    sortedPeerIdsRef.current = sortedPeerIds;
  }, [sortedPeerIds]);

  const ensureOutboundStream = useCallback((): MediaStream | null => {
    const tracks: MediaStreamTrack[] = [];
    if (isMicOn && micStreamRef.current) {
      tracks.push(...micStreamRef.current.getAudioTracks());
    }
    if (isCameraOn && cameraStreamRef.current) {
      tracks.push(...cameraStreamRef.current.getVideoTracks());
    }

    if (tracks.length === 0) {
      const s = outboundStreamRef.current;
      if (s) {
        for (const t of [...s.getTracks()]) {
          s.removeTrack(t);
        }
      }
      outboundStreamRef.current = null;
      return null;
    }

    let s = outboundStreamRef.current;
    if (!s) {
      s = new MediaStream();
      outboundStreamRef.current = s;
    }

    for (const t of [...s.getTracks()]) {
      if (!tracks.includes(t)) {
        s.removeTrack(t);
      }
    }
    for (const t of tracks) {
      if (!s.getTracks().includes(t)) {
        s.addTrack(t);
      }
    }

    return s;
  }, [isMicOn, isCameraOn, micStreamRef, cameraStreamRef]);

  const ensureOutboundStreamRef = useRef(ensureOutboundStream);
  ensureOutboundStreamRef.current = ensureOutboundStream;

  useEffect(() => {
    const socket = new PartySocket({
      host: getPartyKitHost(),
      room: roomId,
      party: "main",
    });
    socketRef.current = socket;

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as unknown;
        if (typeof data === "object" && data !== null && (data as { type?: string }).type === "welcome") {
          const id = (data as { peerId?: string }).peerId;
          if (typeof id === "string") {
            myPeerIdRef.current = id;
            setMyPeerId(id);
          }
          return;
        }
        if (typeof data === "object" && data !== null && (data as { type?: string }).type === "roster") {
          const r = data as { hostId?: string | null; peerIds?: string[] };
          setHostPeerId(typeof r.hostId === "string" ? r.hostId : null);
          setSortedPeerIds(Array.isArray(r.peerIds) ? [...r.peerIds].sort() : []);
          return;
        }
        if (isPartyVideoMessage(data)) {
          onVideoPartyMessageRef.current(data);
          return;
        }
        if (isRtcMessage(data)) {
          const target = myPeerIdRef.current;
          if (target && data.to === target) {
            const peer = peersRef.current.get(data.from);
            peer?.signal(data.signal);
          }
        }
      } catch {
        /* ignore */
      }
    };

    socket.addEventListener("message", onMessage);

    return () => {
      socket.removeEventListener("message", onMessage);
      for (const p of peersRef.current.values()) {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }
      peersRef.current.clear();
      myPeerIdRef.current = null;
      outboundStreamRef.current = null;
      socket.close();
      socketRef.current = null;
      setMyPeerId(null);
      setHostPeerId(null);
      setSortedPeerIds([]);
      setRemoteStreams(new Map());
      if (mediaSyncTimerRef.current !== null) {
        clearTimeout(mediaSyncTimerRef.current);
        mediaSyncTimerRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    const run = () => {
      const myId = myPeerIdRef.current;
      if (!myId || !socketRef.current) {
        for (const p of peersRef.current.values()) {
          try {
            p.destroy();
          } catch {
            /* ignore */
          }
        }
        peersRef.current.clear();
        setRemoteStreams(new Map());
        return;
      }

      const socket = socketRef.current;
      const remotes = sortedPeerIdsRef.current.filter((id) => id !== myId);
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        for (const id of prev.keys()) {
          if (!remotes.includes(id)) {
            next.delete(id);
          }
        }
        return next;
      });

      for (const p of peersRef.current.values()) {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }
      peersRef.current.clear();

      const outbound = ensureOutboundStreamRef.current();

      const attachRemoteStream = (remotePeerId: string, stream: MediaStream) => {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remotePeerId, stream);
          return next;
        });
      };

      for (const remoteId of remotes) {
        const opts: PeerOptions = {
          initiator: myId < remoteId,
          trickle: true,
          config: DEFAULT_PEER_RTC_CONFIG,
        };
        if (outbound && outbound.getTracks().length > 0) {
          opts.stream = outbound;
        }
        const peer = new Peer(opts);

        peer.on("signal", (signal: PeerSignal) => {
          socket.send(
            JSON.stringify({
              type: "rtc",
              to: remoteId,
              from: myId,
              signal,
            } satisfies RtcMessage),
          );
        });

        peer.on("stream", (stream: MediaStream) => {
          attachRemoteStream(remoteId, stream);
        });

        peer.on("track", (_track: MediaStreamTrack, stream: MediaStream) => {
          attachRemoteStream(remoteId, stream);
        });

        peer.on("close", () => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(remoteId);
            return next;
          });
        });

        peer.on("error", () => {
          /* ignore */
        });

        peersRef.current.set(remoteId, peer);
      }
    };

    run();

    return () => {
      for (const p of peersRef.current.values()) {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }
      peersRef.current.clear();
    };
  }, [sortedPeerIds.join(","), myPeerId]);

  useEffect(() => {
    if (myPeerId === null || peersRef.current.size === 0) {
      return;
    }

    if (mediaSyncTimerRef.current !== null) {
      clearTimeout(mediaSyncTimerRef.current);
    }

    mediaSyncTimerRef.current = setTimeout(() => {
      mediaSyncTimerRef.current = null;
      const outbound = ensureOutboundStreamRef.current();
      for (const peer of peersRef.current.values()) {
        syncPeerOutboundMedia(peer, outbound);
      }
    }, MEDIA_SYNC_DEBOUNCE_MS);

    return () => {
      if (mediaSyncTimerRef.current !== null) {
        clearTimeout(mediaSyncTimerRef.current);
        mediaSyncTimerRef.current = null;
      }
    };
  }, [isMicOn, isCameraOn, myPeerId, sortedPeerIds.join(",")]);

  const sendVideoParty = useCallback((msg: PartyVideoMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  const isHost = myPeerId !== null && hostPeerId !== null && myPeerId === hostPeerId;

  return {
    myPeerId,
    hostPeerId,
    sortedPeerIds,
    remoteStreams,
    isHost,
    sendVideoParty,
    setVideoPartyHandler: setVideoHandler,
  };
}
