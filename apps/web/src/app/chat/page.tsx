'use client';

import {
  acceptFriendRequest,
  declineFriendRequest,
  FriendItem,
  getFriends,
  getIncomingRequests,
  sendFriendRequest,
} from '@/entities/friend/api/friends';
import {
  ConversationItem,
  ConversationMessage,
  createDirectConversation,
  getConversationMessages,
  getConversations,
  markConversationRead,
  MessagesPage,
} from '@/entities/conversation/api/conversations';
import { sendMessage } from '@/entities/message/api/messages';
import { logout } from '@/entities/session/api/auth';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
} from '@/entities/session/model/storage';
import { AuthUser } from '@/entities/session/model/types';
import {
  getMe,
  searchUsers,
  updateMyAvatar,
  updateMyDisplayName,
} from '@/entities/user/api/users';
import {
  CallAnswerEvent,
  CallCameraStateEvent,
  CallEndEvent,
  CallIceEvent,
  CallMediaType,
  CallOfferEvent,
  CallUnavailableEvent,
  createChatSocket,
  MessageNewEvent,
  PresenceEvent,
} from '@/shared/socket/chat-socket';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import styles from './page.module.css';

const queryKeys = {
  me: ['me'] as const,
  friends: ['friends'] as const,
  friendRequests: ['friendRequests'] as const,
  conversations: ['conversations'] as const,
  messages: (conversationId: string | null) => ['messages', conversationId] as const,
  userSearch: (term: string) => ['userSearch', term] as const,
};

const AVATAR_OPTIONS = [
  { key: 'none', emoji: '🙂', label: 'Default' },
  { key: 'cool-cat', emoji: '😼', label: 'Cool Cat' },
  { key: 'doge', emoji: '🐶', label: 'Doge' },
  { key: 'froggy', emoji: '🐸', label: 'Froggy' },
  { key: 'capy', emoji: '🦫', label: 'Capy' },
  { key: 'shiba', emoji: '🐕', label: 'Shiba' },
  { key: 'alien', emoji: '👽', label: 'Alien' },
  { key: 'robot', emoji: '🤖', label: 'Robot' },
  { key: 'banana', emoji: '🍌', label: 'Banana' },
  { key: 'penguin', emoji: '🐧', label: 'Penguin' },
  { key: 'panda', emoji: '🐼', label: 'Panda' },
] as const;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

type IncomingCall = {
  fromUserId: string;
  conversationId: string;
  offer: RTCSessionDescriptionInit;
  media: CallMediaType;
};

type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'in_call';
type PendingIceCandidate = {
  conversationId: string;
  candidate: RTCIceCandidateInit;
};

export default function ChatPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedConversationRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callConversationRef = useRef<string | null>(null);
  const callPeerUserRef = useRef<string | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingIceCandidatesRef = useRef<PendingIceCandidate[]>([]);
  const localMeterCleanupRef = useRef<(() => void) | null>(null);
  const remoteMeterCleanupRef = useRef<(() => void) | null>(null);
  const callStateRef = useRef<CallState>('idle');

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [messageText, setMessageText] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callPeerUserId, setCallPeerUserId] = useState<string | null>(null);
  const [callConversationId, setCallConversationId] = useState<string | null>(null);
  const [callMediaType, setCallMediaType] = useState<CallMediaType>('audio');
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isRemoteCameraEnabled, setIsRemoteCameraEnabled] = useState(false);
  const [localVoiceLevel, setLocalVoiceLevel] = useState(0);
  const [remoteVoiceLevel, setRemoteVoiceLevel] = useState(0);
  const [peerConnectionState, setPeerConnectionState] = useState<RTCPeerConnectionState>('new');
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
  const [socketConnected, setSocketConnected] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    setMounted(true);
    setCurrentUser(getStoredUser());

    const token = getAccessToken();
    const authorized = Boolean(token);
    setHasToken(authorized);
    if (!authorized) {
      router.replace('/');
    }
  }, [router]);

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends,
    queryFn: getFriends,
    enabled: mounted && hasToken === true,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const requestsQuery = useQuery({
    queryKey: queryKeys.friendRequests,
    queryFn: getIncomingRequests,
    enabled: mounted && hasToken === true,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const conversationsQuery = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: getConversations,
    enabled: mounted && hasToken === true,
  });

  const messagesQuery = useQuery({
    queryKey: queryKeys.messages(selectedConversationId),
    queryFn: () => getConversationMessages(selectedConversationId as string, undefined, 40),
    enabled: mounted && hasToken === true && Boolean(selectedConversationId),
  });

  const searchQuery = useQuery({
    queryKey: queryKeys.userSearch(searchTerm),
    queryFn: () => searchUsers(searchTerm),
    enabled: mounted && hasToken === true && searchTerm.trim().length >= 2,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    enabled: mounted && hasToken === true,
    retry: false,
  });

  useEffect(() => {
    if (meQuery.data) {
      setCurrentUser(meQuery.data);
      setDisplayNameDraft(meQuery.data.displayName || '');
    }
  }, [meQuery.data]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (meQuery.isError && hasToken === true) {
      clearSession();
      router.replace('/');
    }
  }, [meQuery.isError, hasToken, router]);

  useEffect(() => {
    if (!mounted || hasToken !== true) {
      return;
    }

    const accessToken = getAccessToken();
    if (!accessToken) {
      return;
    }

    const socket = createChatSocket(accessToken);
    socketRef.current = socket;

    const onSocketConnect = () => {
      setSocketConnected(true);
      setChatError(null);
    };

    const onSocketDisconnect = () => {
      setSocketConnected(false);
    };

    const onSocketConnectError = () => {
      setSocketConnected(false);
      setChatError('Realtime connection failed. Refresh page or relogin.');
    };

    const onMessageNew = (payload: MessageNewEvent) => {
      const incomingMessage: ConversationMessage = {
        id: payload.message.id,
        conversationId: payload.message.conversationId,
        senderId: payload.message.senderId,
        text: payload.message.text,
        createdAt: payload.message.createdAt,
      };

      queryClient.setQueryData<MessagesPage>(
        queryKeys.messages(payload.conversationId),
        (oldData) => {
          if (!oldData) {
            return oldData;
          }

          const alreadyExists = oldData.items.some((item) => item.id === incomingMessage.id);
          if (alreadyExists) {
            return oldData;
          }

          return {
            ...oldData,
            items: [...oldData.items, incomingMessage],
          };
        },
      );

      queryClient.setQueryData<ConversationItem[]>(queryKeys.conversations, (oldData) => {
        if (!oldData) {
          return oldData;
        }

        const updated = oldData.map((conversation) => {
          if (conversation.id !== payload.conversationId) {
            return conversation;
          }

          const isActiveConversation = selectedConversationRef.current === payload.conversationId;
          const nextUnreadCount = isActiveConversation
            ? 0
            : Math.max((conversation.unreadCount || 0) + 1, 1);

          return {
            ...conversation,
            updatedAt: payload.message.createdAt,
            lastMessage: incomingMessage,
            unreadCount: nextUnreadCount,
          };
        });

        return updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      });

      if (selectedConversationRef.current !== payload.conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      } else {
        markReadMutation.mutate(payload.conversationId);
      }
    };

    const onPresenceOnline = ({ userId }: PresenceEvent) => {
      queryClient.setQueryData<FriendItem[]>(queryKeys.friends, (oldData) => {
        if (!oldData) return oldData;
        return oldData.map((item) =>
          item.friend.id === userId ? { ...item, isOnline: true } : item,
        );
      });
    };

    const onPresenceOffline = ({ userId }: PresenceEvent) => {
      queryClient.setQueryData<FriendItem[]>(queryKeys.friends, (oldData) => {
        if (!oldData) return oldData;
        return oldData.map((item) =>
          item.friend.id === userId ? { ...item, isOnline: false } : item,
        );
      });
    };

    const onCallOffer = ({ fromUserId, conversationId, offer, media }: CallOfferEvent) => {
      if (callStateRef.current !== 'idle') {
        socket.emit('call:reject', {
          toUserId: fromUserId,
          conversationId,
        });
        return;
      }
      setIncomingCall({ fromUserId, conversationId, offer, media: media === 'video' ? 'video' : 'audio' });
      setCallState('ringing');
    };

    const onCallAnswer = async ({ fromUserId, conversationId, answer }: CallAnswerEvent) => {
      if (
        !peerConnectionRef.current ||
        !callConversationRef.current ||
        conversationId !== callConversationRef.current
      ) {
        return;
      }

      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
      await flushPendingIceCandidates(conversationId);
      setCallPeerUserId(fromUserId);
      setCallState('in_call');
    };

    const onCallIce = async ({ conversationId, candidate }: CallIceEvent) => {
      const isCurrentConversation =
        callConversationRef.current && conversationId === callConversationRef.current;

      // Candidate may arrive before accept()/before peer is created.
      if (!peerConnectionRef.current || !isCurrentConversation) {
        pendingIceCandidatesRef.current.push({ conversationId, candidate });
        return;
      }

      if (!peerConnectionRef.current.remoteDescription) {
        pendingIceCandidatesRef.current.push({ conversationId, candidate });
        return;
      }

      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    };

    const onCallEnd = ({ conversationId }: CallEndEvent) => {
      if (callConversationRef.current && conversationId !== callConversationRef.current) {
        return;
      }
      cleanupCallState();
    };

    const onCallUnavailable = ({ conversationId }: CallUnavailableEvent) => {
      if (callConversationRef.current && conversationId !== callConversationRef.current) {
        return;
      }

      setChatError('Peer is offline or not connected to realtime.');
      cleanupCallState();
    };

    const onCallCameraState = ({ conversationId, enabled }: CallCameraStateEvent) => {
      if (callConversationRef.current && conversationId !== callConversationRef.current) {
        return;
      }

      setIsRemoteCameraEnabled(enabled);
      if (enabled) {
        setCallMediaType('video');
        return;
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.pause();
        remoteVideoRef.current.srcObject = null;
        remoteVideoRef.current.load();
      }
    };

    socket.on('connect', onSocketConnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.on('connect_error', onSocketConnectError);
    socket.on('message:new', onMessageNew);
    socket.on('presence:online', onPresenceOnline);
    socket.on('presence:offline', onPresenceOffline);
    socket.on('call:offer', onCallOffer);
    socket.on('call:answer', onCallAnswer);
    socket.on('call:ice', onCallIce);
    socket.on('call:end', onCallEnd);
    socket.on('call:reject', onCallEnd);
    socket.on('call:unavailable', onCallUnavailable);
    socket.on('call:camera-state', onCallCameraState);

    return () => {
      socket.off('connect', onSocketConnect);
      socket.off('disconnect', onSocketDisconnect);
      socket.off('connect_error', onSocketConnectError);
      socket.off('message:new', onMessageNew);
      socket.off('presence:online', onPresenceOnline);
      socket.off('presence:offline', onPresenceOffline);
      socket.off('call:offer', onCallOffer);
      socket.off('call:answer', onCallAnswer);
      socket.off('call:ice', onCallIce);
      socket.off('call:end', onCallEnd);
      socket.off('call:reject', onCallEnd);
      socket.off('call:unavailable', onCallUnavailable);
      socket.off('call:camera-state', onCallCameraState);
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [mounted, hasToken, queryClient]);

  const createDirectMutation = useMutation({
    mutationFn: createDirectConversation,
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setSelectedConversationId(conversation.id);
      setChatError(null);
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 0);
    },
    onError: handleError,
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ conversationId, text }: { conversationId: string; text: string }) =>
      sendMessage(conversationId, text),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages(variables.conversationId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setMessageText('');
      setChatError(null);
    },
    onError: handleError,
  });

  const sendRequestMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      setChatError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.friendRequests });
      queryClient.invalidateQueries({ queryKey: queryKeys.userSearch(searchTerm) });
    },
    onError: handleError,
  });

  const acceptMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      setChatError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.friendRequests });
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: handleError,
  });

  const declineMutation = useMutation({
    mutationFn: declineFriendRequest,
    onSuccess: () => {
      setChatError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.friendRequests });
    },
    onError: handleError,
  });

  const updateAvatarMutation = useMutation({
    mutationFn: (avatarKey: string | null) => updateMyAvatar(avatarKey),
    onSuccess: (user) => {
      setCurrentUser(user);
      queryClient.setQueryData(queryKeys.me, user);
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setAvatarPickerOpen(false);
    },
    onError: handleError,
  });

  const updateDisplayNameMutation = useMutation({
    mutationFn: (displayName: string) => updateMyDisplayName(displayName),
    onSuccess: (user) => {
      setCurrentUser(user);
      queryClient.setQueryData(queryKeys.me, user);
      queryClient.invalidateQueries({ queryKey: queryKeys.friends });
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      setEditingDisplayName(false);
    },
    onError: handleError,
  });

  const markReadMutation = useMutation({
    mutationFn: markConversationRead,
    onSuccess: ({ conversationId }) => {
      queryClient.setQueryData<ConversationItem[]>(queryKeys.conversations, (oldData) => {
        if (!oldData) {
          return oldData;
        }

        return oldData.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, unreadCount: 0 }
            : conversation,
        );
      });
    },
  });

  const activeConversation = useMemo(
    () => conversationsQuery.data?.find((item) => item.id === selectedConversationId) || null,
    [conversationsQuery.data, selectedConversationId],
  );

  const activePeer = useMemo(() => {
    if (!activeConversation || !currentUser) {
      return null;
    }

    return activeConversation.members.find((member) => member.id !== currentUser.id) || null;
  }, [activeConversation, currentUser]);

  useEffect(() => {
    if (!selectedConversationId || hasToken !== true) {
      return;
    }

    markReadMutation.mutate(selectedConversationId);
  }, [selectedConversationId, hasToken]);

  useEffect(() => {
    return () => {
      cleanupCallState();
    };
  }, []);

  useEffect(() => {
    if (!remoteAudioRef.current || !remoteStreamRef.current) {
      return;
    }

    remoteAudioRef.current.srcObject = remoteStreamRef.current;
  }, [callState]);

  useEffect(() => {
    if (callState === 'idle' || callMediaType !== 'video') {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.load();
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
        remoteVideoRef.current.load();
      }
      return;
    }

    if (isCameraEnabled && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => undefined);
    }

    if (isRemoteCameraEnabled && remoteVideoRef.current) {
      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.play().catch(() => undefined);
    }
  }, [callState, callMediaType, isCameraEnabled, isRemoteCameraEnabled]);

  useEffect(() => {
    if (callState === 'idle') {
      return;
    }

    const nextMediaType: CallMediaType =
      isCameraEnabled || isRemoteCameraEnabled ? 'video' : 'audio';
    setCallMediaType((prev) => (prev === nextMediaType ? prev : nextMediaType));
  }, [callState, isCameraEnabled, isRemoteCameraEnabled]);

  if (!mounted || hasToken === null || meQuery.isLoading) {
    return (
      <div className={styles.center}>
        <p>Loading chat...</p>
      </div>
    );
  }

  if (hasToken === false) {
    return null;
  }

  function cleanupCallState() {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    videoSenderRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localMeterCleanupRef.current) {
      localMeterCleanupRef.current();
      localMeterCleanupRef.current = null;
    }

    if (remoteMeterCleanupRef.current) {
      remoteMeterCleanupRef.current();
      remoteMeterCleanupRef.current = null;
    }

    remoteStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setIncomingCall(null);
    setCallPeerUserId(null);
    setCallConversationId(null);
    callPeerUserRef.current = null;
    callConversationRef.current = null;
    pendingIceCandidatesRef.current = [];
    setCallState('idle');
    setIsMuted(false);
    setIsCameraEnabled(false);
    setIsRemoteCameraEnabled(false);
    setCallMediaType('audio');
    setLocalVoiceLevel(0);
    setRemoteVoiceLevel(0);
    setPeerConnectionState('new');
    setIceConnectionState('new');
  }

  function startVoiceMeter(stream: MediaStream, onLevel: (value: number) => void) {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let rafId = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / data.length);
      onLevel(Math.min(100, Math.round(rms * 250)));
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
      onLevel(0);
    };
  }

  async function flushPendingIceCandidates(conversationId: string) {
    if (!peerConnectionRef.current) {
      return;
    }

    const pendingForConversation = pendingIceCandidatesRef.current.filter(
      (item) => item.conversationId === conversationId,
    );
    pendingIceCandidatesRef.current = pendingIceCandidatesRef.current.filter(
      (item) => item.conversationId !== conversationId,
    );

    for (const item of pendingForConversation) {
      const candidate = item.candidate;
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function ensureLocalStream(mediaType: CallMediaType) {
    const currentStream = localStreamRef.current;
    const shouldHaveVideo = mediaType === 'video';

    if (!currentStream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      if (localMeterCleanupRef.current) {
        localMeterCleanupRef.current();
        localMeterCleanupRef.current = null;
      }
      localMeterCleanupRef.current = startVoiceMeter(stream, setLocalVoiceLevel);
    }

    const stream = localStreamRef.current as MediaStream;
    const hasVideoTrack = stream.getVideoTracks().length > 0;
    if (shouldHaveVideo && !hasVideoTrack) {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      const [videoTrack] = videoStream.getVideoTracks();
      if (videoTrack) {
        stream.addTrack(videoTrack);
      }
    }

    stream.getVideoTracks().forEach((track) => {
      track.enabled = shouldHaveVideo;
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = shouldHaveVideo ? stream : null;
      if (shouldHaveVideo) {
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => undefined);
      }
    }
    return stream;
  }

  function resolveVideoTransceiver(pc: RTCPeerConnection) {
    const existing = pc.getTransceivers().find((transceiver) => {
      const senderTrackKind = transceiver.sender.track?.kind;
      const receiverTrackKind = transceiver.receiver.track?.kind;
      return senderTrackKind === 'video' || receiverTrackKind === 'video';
    });

    if (existing) {
      return existing;
    }

    return pc.addTransceiver('video', { direction: 'sendrecv' });
  }

  function resolveVideoSender(pc: RTCPeerConnection) {
    if (videoSenderRef.current) {
      return videoSenderRef.current;
    }

    const transceiver = resolveVideoTransceiver(pc);
    videoSenderRef.current = transceiver.sender;
    return transceiver.sender;
  }

  async function createPeerConnection(
    peerUserId: string,
    conversationId: string,
    mediaType: CallMediaType,
    role: 'offerer' | 'answerer' = 'offerer',
  ) {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      throw new Error('Socket is not connected');
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionRef.current = pc;

    const localStream = await ensureLocalStream(mediaType);
    localStream.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));

    if (role === 'offerer') {
      const videoTransceiver = resolveVideoTransceiver(pc);
      videoTransceiver.direction = 'sendrecv';
      videoSenderRef.current = videoTransceiver.sender;
    }

    if (mediaType === 'video' && role === 'offerer') {
      const [videoTrack] = localStream.getVideoTracks();
      if (videoTrack) {
        await resolveVideoSender(pc).replaceTrack(videoTrack);
      }
      setIsCameraEnabled(true);
    } else {
      setIsCameraEnabled(false);
    }

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }

    const attachRemoteVideo = () => {
      if (!remoteVideoRef.current) {
        return;
      }

      remoteVideoRef.current.muted = true;
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current
        .play()
        .catch(() => undefined);
    };

    pc.ontrack = (event) => {
      const alreadyAdded = remoteStream
        .getTracks()
        .some((track) => track.id === event.track.id);
      if (!alreadyAdded) {
        remoteStream.addTrack(event.track);
      }

      if (event.track.kind === 'video') {
        // Some browser pairs dispatch ontrack before the video track un-mutes.
        event.track.onunmute = () => {
          attachRemoteVideo();
        };
        event.track.onmute = () => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.pause();
            remoteVideoRef.current.srcObject = null;
            remoteVideoRef.current.load();
          }
        };
        event.track.onended = () => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.pause();
            remoteVideoRef.current.srcObject = null;
            remoteVideoRef.current.load();
          }
        };
        if (!event.track.muted && event.track.readyState === 'live') {
          attachRemoteVideo();
        }
      }

      if (!remoteMeterCleanupRef.current) {
        remoteMeterCleanupRef.current = startVoiceMeter(remoteStream, setRemoteVoiceLevel);
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current
          .play()
          .catch(() => undefined);
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      socket.emit('call:ice', {
        toUserId: peerUserId,
        conversationId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.onconnectionstatechange = () => {
      setPeerConnectionState(pc.connectionState);
      if (pc.connectionState === 'connected') {
        setCallState('in_call');
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setChatError('Call connection failed');
        cleanupCallState();
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceConnectionState(pc.iceConnectionState);
    };

    setCallPeerUserId(peerUserId);
    setCallConversationId(conversationId);
    setCallMediaType(mediaType);
    callPeerUserRef.current = peerUserId;
    callConversationRef.current = conversationId;
    pendingIceCandidatesRef.current = [];
    return pc;
  }

  function emitCameraState(enabled: boolean) {
    if (!callPeerUserRef.current || !callConversationRef.current) {
      return;
    }

    socketRef.current?.emit('call:camera-state', {
      toUserId: callPeerUserRef.current,
      conversationId: callConversationRef.current,
      enabled,
    });
  }

  async function onStartCall(mediaType: CallMediaType) {
    if (!activeConversation || !activePeer) {
      setChatError('Open a direct conversation first');
      return;
    }

    if (callState !== 'idle') {
      return;
    }

    if (!socketRef.current?.connected) {
      setChatError('Realtime socket is not connected');
      return;
    }

    try {
      const pc = await createPeerConnection(activePeer.id, activeConversation.id, mediaType);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit('call:offer', {
        toUserId: activePeer.id,
        conversationId: activeConversation.id,
        offer,
        media: mediaType,
      });

      setCallState('calling');
      if (mediaType === 'video') {
        emitCameraState(true);
      }
      setChatError(null);
    } catch (error) {
      cleanupCallState();
      handleError(error);
    }
  }

  async function onAcceptCall() {
    if (!incomingCall) {
      return;
    }

    try {
      const pc = await createPeerConnection(
        incomingCall.fromUserId,
        incomingCall.conversationId,
        incomingCall.media,
        'answerer',
      );
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      await flushPendingIceCandidates(incomingCall.conversationId);
      const videoTransceiver = resolveVideoTransceiver(pc);
      videoTransceiver.direction = 'sendrecv';
      videoSenderRef.current = videoTransceiver.sender;

      if (incomingCall.media === 'video') {
        const stream = await ensureLocalStream('video');
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack) {
          await resolveVideoSender(pc).replaceTrack(videoTrack);
          setIsCameraEnabled(true);
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('call:answer', {
        toUserId: incomingCall.fromUserId,
        conversationId: incomingCall.conversationId,
        answer,
      });

      setSelectedConversationId(incomingCall.conversationId);
      setIncomingCall(null);
      setCallState('connecting');
      if (incomingCall.media === 'video') {
        emitCameraState(true);
      }
      setChatError(null);
    } catch (error) {
      cleanupCallState();
      handleError(error);
    }
  }

  function onDeclineCall() {
    if (!incomingCall) {
      return;
    }

    socketRef.current?.emit('call:reject', {
      toUserId: incomingCall.fromUserId,
      conversationId: incomingCall.conversationId,
    });

    cleanupCallState();
  }

  function onEndCall() {
    if (callPeerUserId && callConversationId) {
      socketRef.current?.emit('call:end', {
        toUserId: callPeerUserId,
        conversationId: callConversationId,
      });
    }

    cleanupCallState();
  }

  function onToggleMute() {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  }

  async function onToggleCamera() {
    if (!peerConnectionRef.current || callState === 'idle') {
      return;
    }

    try {
      const nextEnabled = !isCameraEnabled;
      const videoTransceiver = resolveVideoTransceiver(peerConnectionRef.current);
      videoTransceiver.direction = 'sendrecv';
      const sender = resolveVideoSender(peerConnectionRef.current);
      if (!sender) {
        setChatError('Video sender is not ready');
        return;
      }

      if (nextEnabled) {
        const stream = await ensureLocalStream('video');
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack) {
          await sender.replaceTrack(videoTrack);
        }
        setCallMediaType('video');
        setIsCameraEnabled(true);
        emitCameraState(true);
        return;
      }

      await sender.replaceTrack(null);
      const stream = localStreamRef.current;
      if (stream) {
        stream.getVideoTracks().forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setIsCameraEnabled(false);
      setCallMediaType('audio');
      emitCameraState(false);
    } catch (error) {
      handleError(error);
    }
  }

  async function onLogout() {
    const refreshToken = getRefreshToken();

    try {
      if (refreshToken) {
        await logout(refreshToken);
      }
    } finally {
      clearSession();
      router.replace('/');
    }
  }

  function onOpenDirect(friendId: string) {
    createDirectMutation.mutate(friendId);
  }

  function getUserLabel(user: {
    displayName?: string | null;
    username?: string | null;
    email?: string | null;
  }) {
    return user.displayName || user.username || user.email || 'Unknown user';
  }

  function getAvatarEmoji(avatarKey?: string | null) {
    const option = AVATAR_OPTIONS.find((item) => item.key === (avatarKey || 'none'));
    return option?.emoji || '🙂';
  }

  function onSelectAvatar(avatarKey: string) {
    const normalized = avatarKey === 'none' ? null : avatarKey;
    updateAvatarMutation.mutate(normalized);
  }

  function onStartDisplayNameEdit() {
    setEditingDisplayName(true);
    setDisplayNameDraft(currentUser?.displayName || '');
  }

  function onSaveDisplayName() {
    const nextName = displayNameDraft.trim();
    if (!nextName) {
      setChatError('Name cannot be empty');
      return;
    }
    updateDisplayNameMutation.mutate(nextName);
  }

  function onCancelDisplayNameEdit() {
    setEditingDisplayName(false);
    setDisplayNameDraft(currentUser?.displayName || '');
  }

  function onSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversationId) {
      setChatError('Select a conversation first');
      return;
    }

    sendMessageMutation.mutate({
      conversationId: selectedConversationId,
      text: messageText,
    });
  }

  function handleError(error: unknown) {
    const fallback = 'Request failed';

    if (error instanceof AxiosError) {
      const apiError = error as AxiosError<{ message?: string | string[] }>;
      const message = apiError.response?.data?.message;
      const parsedMessage = Array.isArray(message) ? message.join(', ') : message;
      setChatError(parsedMessage || fallback);
      return;
    }

    setChatError(fallback);
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.userBar}>
          <div className={styles.userIdentity}>
            <button
              className={styles.selfAvatarBtn}
              onClick={() => setAvatarPickerOpen((prev) => !prev)}
              title="Choose avatar"
            >
              <span>{getAvatarEmoji(currentUser?.avatarKey)}</span>
            </button>
            {editingDisplayName ? (
              <div className={styles.displayNameEditor}>
                <input
                  className={styles.aliasInput}
                  value={displayNameDraft}
                  maxLength={40}
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                />
                <button className={styles.topActionBtn} onClick={onSaveDisplayName}>
                  Save
                </button>
                <button className={styles.topActionBtn} onClick={onCancelDisplayNameEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className={styles.userEmailBtn} onClick={onStartDisplayNameEdit}>
                {getUserLabel(currentUser || {})}
              </button>
            )}
            {avatarPickerOpen ? (
              <div className={styles.avatarPicker}>
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    className={styles.avatarOption}
                    onClick={() => onSelectAvatar(option.key)}
                    title={option.label}
                  >
                    {option.emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className={styles.logoutBtn} onClick={onLogout}>
            Logout
          </button>
        </div>

        <section className={styles.block}>
          <h3>Search users</h3>
          <input
            className={styles.input}
            placeholder="type username..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <div className={styles.list}>
            {searchQuery.isLoading ? <p className={styles.status}>Searching...</p> : null}
            {searchQuery.isError ? <p className={styles.statusError}>Search failed</p> : null}
            {searchQuery.data?.map((user) => (
              <div key={user.id} className={styles.listItem}>
                <span className={styles.userLine}>
                  <span className={styles.avatarBubble}>{getAvatarEmoji(user.avatarKey)}</span>
                  <span>{getUserLabel(user)}</span>
                </span>
                <button onClick={() => sendRequestMutation.mutate(user.id)}>Request</button>
              </div>
            ))}
            {searchQuery.data?.length === 0 && searchTerm.trim().length >= 2 ? (
              <p className={styles.empty}>No users found</p>
            ) : null}
          </div>
        </section>

        {requestsQuery.data?.length ? (
          <section className={styles.block}>
            <h3>Requests</h3>
            <div className={styles.list}>
              {requestsQuery.data?.map((item) => (
                <div key={item.id} className={styles.listItemCol}>
                  <span className={styles.userLine}>
                    <span className={styles.avatarBubble}>{getAvatarEmoji(item.from.avatarKey)}</span>
                    <span>{getUserLabel(item.from)}</span>
                  </span>
                  <div className={styles.actions}>
                    <button onClick={() => acceptMutation.mutate(item.id)}>Accept</button>
                    <button onClick={() => declineMutation.mutate(item.id)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className={styles.block}>
          <h3>Friends</h3>
          <div className={styles.list}>
            {friendsQuery.isLoading ? <p className={styles.status}>Loading friends...</p> : null}
            {friendsQuery.isError ? <p className={styles.statusError}>Failed to load friends</p> : null}
            {friendsQuery.data?.map((item) => (
              <div
                key={item.id}
                className={`${styles.listItem} ${styles.friendListItem} ${
                  activePeer?.id === item.friend.id ? styles.friendListItemActive : ''
                }`}
              >
                <div className={styles.friendTopRow}>
                  <button
                    className={styles.friendMainBtn}
                    onClick={() => onOpenDirect(item.friend.id)}
                    title="Open chat"
                  >
                    <span className={styles.friendAvatarWrap}>
                      <span className={styles.avatarBubble}>{getAvatarEmoji(item.friend.avatarKey)}</span>
                      <span
                        className={item.isOnline ? styles.presenceDotOnline : styles.presenceDotOffline}
                      />
                    </span>
                    <span className={styles.friendName}>
                      {getUserLabel(item.friend)}
                    </span>
                  </button>
                </div>
              </div>
            ))}
            {!friendsQuery.data?.length ? <p className={styles.empty}>No friends yet</p> : null}
          </div>
        </section>
      </aside>

      <main className={styles.chat}>
        <div className={styles.chatHeader}>
          {callState !== 'idle' ? (
            <div className={styles.callPanel}>
              <p className={styles.callState}>
                {callState === 'calling'
                  ? callMediaType === 'video'
                    ? 'Video calling...'
                    : 'Calling...'
                  : callState === 'ringing'
                    ? incomingCall?.media === 'video'
                      ? 'Incoming video call...'
                      : 'Incoming call...'
                    : callState === 'connecting'
                      ? callMediaType === 'video'
                        ? 'Connecting video...'
                        : 'Connecting...'
                      : callMediaType === 'video'
                        ? 'In video call'
                        : 'In call'}
              </p>
              <p className={styles.callDebug}>
                Socket: {socketConnected ? 'connected' : 'disconnected'} | Peer:{' '}
                {peerConnectionState} | ICE: {iceConnectionState}
              </p>
              <div className={styles.callInlineActions}>
                <button className={styles.callBtn} onClick={onToggleMute}>
                  {isMuted ? '🎤❌' : '🎤'}
                </button>
                <button className={styles.callBtn} onClick={onToggleCamera}>
                  {isCameraEnabled ? '📹' : '📷̶'}
                </button>
                <button className={styles.callEndBtn} onClick={onEndCall}>
                  End
                </button>
              </div>
              <div className={styles.meters}>
                <div className={styles.meterItem}>
                  <span>Mic</span>
                  <div className={styles.meterTrack}>
                    <div
                      className={styles.meterFill}
                      style={{ width: `${localVoiceLevel}%` }}
                    />
                  </div>
                </div>
                <div className={styles.meterItem}>
                  <span>Peer</span>
                  <div className={styles.meterTrack}>
                    <div
                      className={styles.meterFillPeer}
                      style={{ width: `${remoteVoiceLevel}%` }}
                    />
                  </div>
                </div>
              </div>
              {isCameraEnabled || isRemoteCameraEnabled ? (
                <div className={styles.videoGrid}>
                  {isRemoteCameraEnabled ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={styles.remoteVideo}
                    />
                  ) : (
                    <div className={styles.remoteVideoPlaceholder} />
                  )}
                  {isCameraEnabled ? (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={styles.localVideo}
                    />
                  ) : (
                    <div className={styles.localVideoPlaceholder} />
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.messages}>
          {!selectedConversationId ? <p className={styles.empty}>Select a conversation</p> : null}
          {messagesQuery.isLoading && selectedConversationId ? (
            <p className={styles.status}>Loading messages...</p>
          ) : null}
          {messagesQuery.isError && selectedConversationId ? (
            <p className={styles.statusError}>Failed to load messages</p>
          ) : null}
          {messagesQuery.data?.items.map((message) => (
            <div
              key={message.id}
              className={
                message.senderId === currentUser?.id ? styles.messageMine : styles.messageOther
              }
            >
              <p>{message.text}</p>
              <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
            </div>
          ))}
          {selectedConversationId && !messagesQuery.data?.items.length ? (
            <p className={styles.empty}>No messages yet</p>
          ) : null}
        </div>

        <form className={styles.sendForm} onSubmit={onSendMessage}>
          <div className={styles.composeActions}>
            <button
              type="button"
              className={styles.iconCallBtn}
              onClick={() => onStartCall('audio')}
              disabled={!activeConversation || !activePeer || callState !== 'idle' || !socketConnected}
              title="Start audio call"
            >
              <svg
                className={styles.iconGlyph}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.59.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.46.57 3.59a1 1 0 0 1-.25 1l-2.2 2.2z" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.iconCallBtn}
              onClick={() => onStartCall('video')}
              disabled={!activeConversation || !activePeer || callState !== 'idle' || !socketConnected}
              title="Start video call"
            >
              <svg
                className={styles.iconGlyph}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.6l3.6-2A1 1 0 0 1 21 6.5v11a1 1 0 0 1-1.4.9L16 16.4V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
              </svg>
            </button>
          </div>
          <input
            ref={messageInputRef}
            className={styles.messageInput}
            placeholder={activeConversation ? 'Write a message...' : 'Open a conversation first'}
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            disabled={!selectedConversationId}
          />
          <button type="submit" disabled={!selectedConversationId || !messageText.trim()}>
            Send
          </button>
        </form>

        {chatError ? <p className={styles.error}>{chatError}</p> : null}
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </main>

      {incomingCall ? (
        <div className={styles.callModalBackdrop}>
          <div className={styles.callModal}>
            <h3>{incomingCall.media === 'video' ? 'Incoming video call' : 'Incoming audio call'}</h3>
            <p>From user: {incomingCall.fromUserId}</p>
            <div className={styles.callModalActions}>
              <button className={styles.callBtn} onClick={onAcceptCall}>
                Accept
              </button>
              <button className={styles.callEndBtn} onClick={onDeclineCall}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
