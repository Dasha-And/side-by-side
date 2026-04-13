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
  /** Bumped when a remote peer toggles media so we tear down and re-negotiate WebRTC. */
  const [rtcRefreshEpoch, setRtcRefreshEpoch] = useState(0);

  const socketRef = useRef<PartySocket | null>(null);
  const peersRef = useRef<Map<string, PeerInstance>>(new Map());
  const myPeerIdRef = useRef<string | null>(null);
  const hostPeerIdRef = useRef<string | null>(null);
  const sortedPeerIdsRef = useRef<string[]>([]);

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

  useEffect(() => {
    // PartyKit maps `partykit.json` `main` to the party name "main" (not the file path).
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
        if (
          typeof data === "object" &&
          data !== null &&
          (data as { type?: string }).type === "media-renegotiate"
        ) {
          setRtcRefreshEpoch((e) => e + 1);
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
      socket.close();
      socketRef.current = null;
      setMyPeerId(null);
      setHostPeerId(null);
      setSortedPeerIds([]);
      setRemoteStreams(new Map());
      setRtcRefreshEpoch(0);
    };
  }, [roomId]);

  const buildLocalRtcStream = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (isMicOn && micStreamRef.current) {
      tracks.push(...micStreamRef.current.getAudioTracks());
    }
    if (isCameraOn && cameraStreamRef.current) {
      tracks.push(...cameraStreamRef.current.getVideoTracks());
    }
    if (tracks.length === 0) {
      return null;
    }
    return new MediaStream(tracks);
  }, [isMicOn, isCameraOn, micStreamRef, cameraStreamRef]);

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
      const localStream = buildLocalRtcStream();
      const remotes = sortedPeerIdsRef.current.filter((id) => id !== myId);

      for (const p of peersRef.current.values()) {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }
      peersRef.current.clear();
      setRemoteStreams(new Map());

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
        if (localStream) {
          opts.stream = localStream;
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
  }, [sortedPeerIds.join(","), myPeerId, buildLocalRtcStream, rtcRefreshEpoch]);

  /** When our media or roster changes, tell others to re-create RTCPeerConnections (they won't see new tracks otherwise). */
  useEffect(() => {
    if (myPeerId === null || sortedPeerIds.length <= 1) {
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: "media-renegotiate" }));
  }, [isMicOn, isCameraOn, myPeerId, sortedPeerIds.length]);

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
