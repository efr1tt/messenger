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
import { getMe, searchUsers } from '@/entities/user/api/users';
import {
  CallAnswerEvent,
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
  const [localVoiceLevel, setLocalVoiceLevel] = useState(0);
  const [remoteVoiceLevel, setRemoteVoiceLevel] = useState(0);
  const [peerConnectionState, setPeerConnectionState] = useState<RTCPeerConnectionState>('new');
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState>('new');
  const [socketConnected, setSocketConnected] = useState(false);

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
  });

  const requestsQuery = useQuery({
    queryKey: queryKeys.friendRequests,
    queryFn: getIncomingRequests,
    enabled: mounted && hasToken === true,
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
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      return;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => undefined);
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      remoteVideoRef.current.play().catch(() => undefined);
    }
  }, [callState, callMediaType]);

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
    const hasVideoTrack = currentStream?.getVideoTracks().length ? true : false;

    if (currentStream && (shouldHaveVideo ? hasVideoTrack : true)) {
      if (shouldHaveVideo) {
        currentStream.getVideoTracks().forEach((track) => {
          track.enabled = true;
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = currentStream;
          localVideoRef.current.muted = true;
          localVideoRef.current.play().catch(() => undefined);
        }
      } else {
        currentStream.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      }
      return currentStream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: shouldHaveVideo,
    });

    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
    }

    localStreamRef.current = stream;
    if (localMeterCleanupRef.current) {
      localMeterCleanupRef.current();
      localMeterCleanupRef.current = null;
    }
    localMeterCleanupRef.current = startVoiceMeter(stream, setLocalVoiceLevel);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = shouldHaveVideo ? stream : null;
      if (shouldHaveVideo) {
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => undefined);
      }
    }

    return stream;
  }

  async function createPeerConnection(
    peerUserId: string,
    conversationId: string,
    mediaType: CallMediaType,
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
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => remoteStream.addTrack(track));
      if (!remoteMeterCleanupRef.current) {
        remoteMeterCleanupRef.current = startVoiceMeter(remoteStream, setRemoteVoiceLevel);
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current
          .play()
          .catch(() => undefined);
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => undefined);
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
      );
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      await flushPendingIceCandidates(incomingCall.conversationId);

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
          <div>
            <p className={styles.userTitle}>Logged in</p>
            <p className={styles.userEmail}>{currentUser?.email || 'Unknown user'}</p>
          </div>
          <button className={styles.logoutBtn} onClick={onLogout}>
            Logout
          </button>
        </div>

        <section className={styles.block}>
          <h3>Search users</h3>
          <input
            className={styles.input}
            placeholder="type email..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <div className={styles.list}>
            {searchQuery.isLoading ? <p className={styles.status}>Searching...</p> : null}
            {searchQuery.isError ? <p className={styles.statusError}>Search failed</p> : null}
            {searchQuery.data?.map((user) => (
              <div key={user.id} className={styles.listItem}>
                <span>{user.email}</span>
                <button onClick={() => sendRequestMutation.mutate(user.id)}>Request</button>
              </div>
            ))}
            {searchQuery.data?.length === 0 && searchTerm.trim().length >= 2 ? (
              <p className={styles.empty}>No users found</p>
            ) : null}
          </div>
        </section>

        <section className={styles.block}>
          <h3>Requests</h3>
          <div className={styles.list}>
            {requestsQuery.isLoading ? <p className={styles.status}>Loading requests...</p> : null}
            {requestsQuery.isError ? (
              <p className={styles.statusError}>Failed to load requests</p>
            ) : null}
            {requestsQuery.data?.map((item) => (
              <div key={item.id} className={styles.listItemCol}>
                <span>{item.from.email}</span>
                <div className={styles.actions}>
                  <button onClick={() => acceptMutation.mutate(item.id)}>Accept</button>
                  <button onClick={() => declineMutation.mutate(item.id)}>Decline</button>
                </div>
              </div>
            ))}
            {!requestsQuery.data?.length ? <p className={styles.empty}>No incoming requests</p> : null}
          </div>
        </section>

        <section className={styles.block}>
          <h3>Friends</h3>
          <div className={styles.list}>
            {friendsQuery.isLoading ? <p className={styles.status}>Loading friends...</p> : null}
            {friendsQuery.isError ? <p className={styles.statusError}>Failed to load friends</p> : null}
            {friendsQuery.data?.map((item) => (
              <div key={item.id} className={styles.listItem}>
                <span className={styles.friendRow}>
                  <span
                    className={item.isOnline ? styles.presenceDotOnline : styles.presenceDotOffline}
                  />
                  {item.friend.email}
                </span>
                <button onClick={() => onOpenDirect(item.friend.id)}>Chat</button>
              </div>
            ))}
            {!friendsQuery.data?.length ? <p className={styles.empty}>No friends yet</p> : null}
          </div>
        </section>
      </aside>

      <main className={styles.chat}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderTop}>
            <h2>Conversations</h2>
            <div className={styles.callControls}>
              <button
                className={styles.callBtn}
                onClick={() => onStartCall('audio')}
                disabled={
                  !activeConversation || !activePeer || callState !== 'idle' || !socketConnected
                }
              >
                Audio
              </button>
              <button
                className={styles.callBtn}
                onClick={() => onStartCall('video')}
                disabled={
                  !activeConversation || !activePeer || callState !== 'idle' || !socketConnected
                }
              >
                Video
              </button>
              <button
                className={styles.callBtn}
                onClick={onToggleMute}
                disabled={callState !== 'in_call'}
              >
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                className={styles.callEndBtn}
                onClick={onEndCall}
                disabled={callState === 'idle'}
              >
                End
              </button>
            </div>
          </div>
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
              {callMediaType === 'video' ? (
                <div className={styles.videoGrid}>
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={styles.remoteVideo}
                  />
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={styles.localVideo}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={styles.conversationsRow}>
            {conversationsQuery.isLoading ? (
              <p className={styles.status}>Loading conversations...</p>
            ) : null}
            {conversationsQuery.isError ? (
              <p className={styles.statusError}>Failed to load conversations</p>
            ) : null}
            {conversationsQuery.data?.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  selectedConversationId === conversation.id
                    ? styles.conversationActive
                    : styles.conversationBtn
                }
                onClick={() => setSelectedConversationId(conversation.id)}
              >
                {conversation.members
                  .filter((member) => member.id !== currentUser?.id)
                  .map((member) => member.email)
                  .join(', ') || 'Conversation'}
                {conversation.unreadCount > 0 ? (
                  <span className={styles.unreadBadge}>{conversation.unreadCount}</span>
                ) : null}
              </button>
            ))}
          </div>
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
