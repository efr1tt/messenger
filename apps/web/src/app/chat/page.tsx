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
  { key: 'none', label: 'Sky', src: '/avatars/avatar-1.svg' },
  { key: 'orbit', label: 'Orbit', src: '/avatars/avatar-2.svg' },
  { key: 'ember', label: 'Ember', src: '/avatars/avatar-3.svg' },
  { key: 'mint', label: 'Mint', src: '/avatars/avatar-4.svg' },
  { key: 'neon', label: 'Neon', src: '/avatars/avatar-5.svg' },
  { key: 'sunset', label: 'Sunset', src: '/avatars/avatar-6.svg' },
  { key: 'citrus', label: 'Citrus', src: '/avatars/avatar-7.svg' },
  { key: 'midnight', label: 'Midnight', src: '/avatars/avatar-8.svg' },
  { key: 'coral', label: 'Coral', src: '/avatars/avatar-9.svg' },
] as const;

const LEGACY_AVATAR_MAP: Record<string, (typeof AVATAR_OPTIONS)[number]['key']> = {
  classic: 'orbit',
  cool: 'ember',
  smirk: 'mint',
  calm: 'neon',
  wink: 'sunset',
  monocle: 'citrus',
  nerd: 'midnight',
  mustache: 'coral',
  halo: 'ember',
  thinking: 'mint',
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
type MobileView = 'contacts' | 'chat' | 'call';
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
  const mobileCallOverlayTimeoutRef = useRef<number | null>(null);
  const callConversationRef = useRef<string | null>(null);
  const callPeerUserRef = useRef<string | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingIceCandidatesRef = useRef<PendingIceCandidate[]>([]);
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
  const [socketConnected, setSocketConnected] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('contacts');
  const [isMobileCallOverlayVisible, setIsMobileCallOverlayVisible] = useState(true);
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const syncLayout = () => {
      setIsMobileLayout(mediaQuery.matches);
    };

    syncLayout();
    mediaQuery.addEventListener('change', syncLayout);
    return () => {
      mediaQuery.removeEventListener('change', syncLayout);
    };
  }, []);

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

  const callPeerLabel = useMemo(() => {
    const peerId = callPeerUserId || incomingCall?.fromUserId || activePeer?.id;
    if (!peerId) {
      return 'SweetyCall';
    }

    const friend = friendsQuery.data?.find((item) => item.friend.id === peerId)?.friend;
    if (friend) {
      return getUserLabel(friend);
    }

    const conversationPeer = conversationsQuery.data
      ?.flatMap((conversation) => conversation.members)
      .find((member) => member.id === peerId);
    if (conversationPeer) {
      return getUserLabel(conversationPeer);
    }

    if (activePeer?.id === peerId) {
      return getUserLabel(activePeer);
    }

    return 'Contact';
  }, [callPeerUserId, incomingCall, activePeer, friendsQuery.data, conversationsQuery.data]);

  const callPeerAvatarSrc = useMemo(() => {
    const peerId = callPeerUserId || incomingCall?.fromUserId || activePeer?.id;
    if (!peerId) {
      return getAvatarSrc(null);
    }

    const friend = friendsQuery.data?.find((item) => item.friend.id === peerId)?.friend;
    if (friend) {
      return getAvatarSrc(friend.avatarKey);
    }

    const conversationPeer = conversationsQuery.data
      ?.flatMap((conversation) => conversation.members)
      .find((member) => member.id === peerId);
    if (conversationPeer) {
      return getAvatarSrc(conversationPeer.avatarKey);
    }

    if (activePeer?.id === peerId) {
      return getAvatarSrc(activePeer.avatarKey);
    }

    return getAvatarSrc(null);
  }, [callPeerUserId, incomingCall, activePeer, friendsQuery.data, conversationsQuery.data]);

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
  }, [callState, callMediaType, isCameraEnabled, isRemoteCameraEnabled, isMobileLayout, mobileView]);

  useEffect(() => {
    if (callState === 'idle') {
      return;
    }

    const nextMediaType: CallMediaType =
      isCameraEnabled || isRemoteCameraEnabled ? 'video' : 'audio';
    setCallMediaType((prev) => (prev === nextMediaType ? prev : nextMediaType));
  }, [callState, isCameraEnabled, isRemoteCameraEnabled]);

  useEffect(() => {
    if (callState !== 'in_call') {
      setCallDurationSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setCallDurationSeconds(0);
    const timer = window.setInterval(() => {
      setCallDurationSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [callState]);

  useEffect(() => {
    const shouldAutoHide =
      isMobileLayout &&
      mobileView === 'call' &&
      callMediaType === 'video' &&
      callState === 'in_call';

    if (!shouldAutoHide) {
      clearMobileCallOverlayTimeout();
      setIsMobileCallOverlayVisible(true);
      return;
    }

    setIsMobileCallOverlayVisible(true);
    scheduleMobileCallOverlayHide();

    return () => {
      clearMobileCallOverlayTimeout();
    };
  }, [isMobileLayout, mobileView, callMediaType, callState]);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileView('chat');
      return;
    }

    if (callState !== 'idle') {
      setMobileView('call');
      return;
    }

    if (selectedConversationId) {
      setMobileView('chat');
      return;
    }

    setMobileView('contacts');
  }, [isMobileLayout, callState, selectedConversationId]);

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
    clearMobileCallOverlayTimeout();

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    videoSenderRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
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
    setCameraFacingMode('user');
    setCallMediaType('audio');
  }

  function clearMobileCallOverlayTimeout() {
    if (mobileCallOverlayTimeoutRef.current !== null) {
      window.clearTimeout(mobileCallOverlayTimeoutRef.current);
      mobileCallOverlayTimeoutRef.current = null;
    }
  }

  function scheduleMobileCallOverlayHide() {
    clearMobileCallOverlayTimeout();

    mobileCallOverlayTimeoutRef.current = window.setTimeout(() => {
      setIsMobileCallOverlayVisible(false);
      mobileCallOverlayTimeoutRef.current = null;
    }, 2400);
  }

  function revealMobileCallOverlay() {
    setIsMobileCallOverlayVisible(true);

    if (
      isMobileLayout &&
      mobileView === 'call' &&
      callMediaType === 'video' &&
      callState === 'in_call'
    ) {
      scheduleMobileCallOverlayHide();
    }
  }

  function onMobileCallSurfaceTap() {
    if (!(isMobileLayout && mobileView === 'call' && callMediaType === 'video')) {
      return;
    }

    if (isMobileCallOverlayVisible) {
      clearMobileCallOverlayTimeout();
      setIsMobileCallOverlayVisible(false);
      return;
    }

    revealMobileCallOverlay();
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

  async function createVideoTrack(facingMode: 'user' | 'environment') {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
      const [videoTrack] = videoStream.getVideoTracks();
      return videoTrack || null;
    } catch {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      const [videoTrack] = fallbackStream.getVideoTracks();
      return videoTrack || null;
    }
  }

  async function ensureLocalStream(
    mediaType: CallMediaType,
    facingMode: 'user' | 'environment' = cameraFacingMode,
  ) {
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
    }

    const stream = localStreamRef.current as MediaStream;
    const hasVideoTrack = stream.getVideoTracks().length > 0;
    if (shouldHaveVideo && !hasVideoTrack) {
      const videoTrack = await createVideoTrack(facingMode);
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
      if (pc.connectionState === 'connected') {
        setCallState('in_call');
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setChatError('Call connection failed');
        cleanupCallState();
      }
    };

    pc.oniceconnectionstatechange = () => undefined;

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
        const stream = await ensureLocalStream('video', cameraFacingMode);
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
        localVideoRef.current.load();
      }
      setIsCameraEnabled(false);
      setCallMediaType('audio');
      emitCameraState(false);
    } catch (error) {
      handleError(error);
    }
  }

  async function onSwitchCameraFacing() {
    if (!peerConnectionRef.current || callState === 'idle' || !isCameraEnabled) {
      return;
    }

    try {
      const nextFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
      const sender = resolveVideoSender(peerConnectionRef.current);
      const stream = localStreamRef.current;
      if (!sender || !stream) {
        return;
      }

      const nextTrack = await createVideoTrack(nextFacingMode);
      if (!nextTrack) {
        return;
      }

      await sender.replaceTrack(nextTrack);
      stream.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      stream.addTrack(nextTrack);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => undefined);
      }

      setCameraFacingMode(nextFacingMode);
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
    if (isMobileLayout) {
      setMobileView('chat');
    }
  }

  function onMobileBack() {
    if (callState !== 'idle') {
      return;
    }
    setSelectedConversationId(null);
    setMobileView('contacts');
  }

  function getUserLabel(user: {
    displayName?: string | null;
    username?: string | null;
    email?: string | null;
  }) {
    return user.displayName || user.username || user.email || 'Unknown user';
  }

  function getAvatarOption(avatarKey?: string | null) {
    const normalizedKey = avatarKey ? (LEGACY_AVATAR_MAP[avatarKey] ?? avatarKey) : 'none';
    const option = AVATAR_OPTIONS.find((item) => item.key === normalizedKey);
    return option || AVATAR_OPTIONS[0];
  }

  function getAvatarSrc(avatarKey?: string | null) {
    return getAvatarOption(avatarKey).src;
  }

  function renderAvatar(avatarKey?: string | null, altText?: string) {
    const option = getAvatarOption(avatarKey);
    return <img className={styles.avatarImage} src={option.src} alt={altText || option.label} />;
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

  function formatCallDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function getCallStatusLabel() {
    if (callState === 'calling') {
      return callMediaType === 'video' ? 'Video calling' : 'Calling';
    }

    if (callState === 'ringing') {
      return incomingCall?.media === 'video' ? 'Incoming video call' : 'Incoming call';
    }

    if (callState === 'connecting') {
      return callMediaType === 'video' ? 'Connecting video...' : 'Connecting...';
    }

    if (callState === 'in_call') {
      const base = callMediaType === 'video' ? 'Video call' : 'Voice call';
      return `${base} • ${formatCallDuration(callDurationSeconds)}`;
    }

    return 'Call';
  }

  function renderCallPanel(isMobileCallView = false) {
    const isMobileVideoCall = isMobileCallView && callMediaType === 'video';
    const showMobileOverlay = !isMobileVideoCall || isMobileCallOverlayVisible;

    return (
      <div
        className={`${styles.callPanel} ${isMobileCallView ? styles.mobileCallPanel : ''} ${
          isMobileVideoCall ? styles.mobileCallPanelVideo : ''
        }`}
      >
        {isMobileVideoCall ? (
          <div className={styles.mobileVideoStage} onClick={onMobileCallSurfaceTap}>
            {isRemoteCameraEnabled ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                className={styles.mobileRemoteVideo}
              />
            ) : (
              <div className={styles.mobileRemotePlaceholder}>
                <span className={styles.mobileRemoteAvatar}>
                  <img className={styles.avatarImage} src={callPeerAvatarSrc} alt="Call avatar" />
                </span>
              </div>
            )}

            <div
              className={`${styles.mobileCallOverlay} ${
                showMobileOverlay ? styles.mobileCallOverlayVisible : styles.mobileCallOverlayHidden
              }`}
            >
              <div className={styles.mobileCallOverlayTop}>
                <div className={styles.callTopBar}>
                  <div className={styles.callInfo}>
                    <span className={styles.callAvatar}>
                      <img className={styles.avatarImage} src={callPeerAvatarSrc} alt="Call avatar" />
                    </span>
                    <div className={styles.callTextGroup}>
                      <p className={styles.callTitle}>{callPeerLabel}</p>
                      <p className={styles.callState}>{getCallStatusLabel()}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={styles.mobileCallOverlayBottom}
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.mobileCallActions}>
                  <button
                    className={`${styles.callBtn} ${styles.callIconBtn}`}
                    onClick={onToggleMute}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-4a3.5 3.5 0 1 0-7 0v4A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 1 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.92V20H9.5a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H13v-2.58A6 6 0 0 0 18 11.5Z" />
                      {isMuted ? (
                        <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 1 0 1.4-1.4l-16-16Z" />
                      ) : null}
                    </svg>
                  </button>
                  <button
                    className={`${styles.callBtn} ${styles.callIconBtn}`}
                    onClick={onToggleCamera}
                    title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                    aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                  >
                    <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v1.38l2.55-1.67A1 1 0 0 1 21 7.55v8.9a1 1 0 0 1-1.45.84L17 15.62V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z" />
                      {!isCameraEnabled ? (
                        <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 1 0 1.4-1.4l-16-16Z" />
                      ) : null}
                    </svg>
                  </button>
                  <button
                    className={`${styles.callBtn} ${styles.callIconBtn}`}
                    onClick={onSwitchCameraFacing}
                    disabled={!isCameraEnabled}
                    title="Switch front/back camera"
                    aria-label="Switch front/back camera"
                  >
                    <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7.8 7H16a4 4 0 0 1 3.6 2.2l.15.3 1.36-.7-.3 4.17-3.78-1.8 1.34-.68-.1-.18A2.5 2.5 0 0 0 16 8.5H7.8l1.1 1.1a1 1 0 1 1-1.4 1.4l-2.8-2.8 2.8-2.8a1 1 0 1 1 1.4 1.4L7.8 7Zm8.7 8.5-1.4-1.4a1 1 0 1 1 1.4-1.4l2.8 2.8-2.8 2.8a1 1 0 1 1-1.4-1.4l1.1-1.1H8a4 4 0 0 1-3.6-2.2l-.15-.3-1.36.7.3-4.17 3.78 1.8-1.34.68.1.18A2.5 2.5 0 0 0 8 15.5h8.5Z" />
                    </svg>
                  </button>
                  <button className={styles.callEndBtn} onClick={onEndCall} aria-label="End call">
                    End
                  </button>
                </div>
              </div>
            </div>

            <div
              className={`${styles.mobileLocalPip} ${
                showMobileOverlay ? styles.mobileLocalPipRaised : ''
              }`}
            >
              {isCameraEnabled ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={styles.mobileLocalVideo}
                />
              ) : (
                <div className={styles.mobileLocalPlaceholder} />
              )}
            </div>
          </div>
        ) : (
          <>
            <div className={styles.callTopBar}>
              <div className={styles.callInfo}>
                <span className={styles.callAvatar}>
                  <img className={styles.avatarImage} src={callPeerAvatarSrc} alt="Call avatar" />
                </span>
                <div className={styles.callTextGroup}>
                  <p className={styles.callTitle}>{callPeerLabel}</p>
                  <p className={styles.callState}>{getCallStatusLabel()}</p>
                </div>
              </div>
            </div>
            <div className={styles.callInlineActions}>
              <button
                className={`${styles.callBtn} ${styles.callIconBtn}`}
                onClick={onToggleMute}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-4a3.5 3.5 0 1 0-7 0v4A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 1 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.92V20H9.5a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H13v-2.58A6 6 0 0 0 18 11.5Z" />
                  {isMuted ? (
                    <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 1 0 1.4-1.4l-16-16Z" />
                  ) : null}
                </svg>
              </button>
              <button
                className={`${styles.callBtn} ${styles.callIconBtn}`}
                onClick={onToggleCamera}
                title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v1.38l2.55-1.67A1 1 0 0 1 21 7.55v8.9a1 1 0 0 1-1.45.84L17 15.62V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z" />
                  {!isCameraEnabled ? (
                    <path d="M4.7 3.3a1 1 0 0 0-1.4 1.4l16 16a1 1 0 1 0 1.4-1.4l-16-16Z" />
                  ) : null}
                </svg>
              </button>
              <button
                className={`${styles.callBtn} ${styles.callIconBtn}`}
                onClick={onSwitchCameraFacing}
                disabled={!isCameraEnabled}
                title="Switch front/back camera"
                aria-label="Switch front/back camera"
              >
                <svg className={styles.callGlyph} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.8 7H16a4 4 0 0 1 3.6 2.2l.15.3 1.36-.7-.3 4.17-3.78-1.8 1.34-.68-.1-.18A2.5 2.5 0 0 0 16 8.5H7.8l1.1 1.1a1 1 0 1 1-1.4 1.4l-2.8-2.8 2.8-2.8a1 1 0 1 1 1.4 1.4L7.8 7Zm8.7 8.5-1.4-1.4a1 1 0 1 1 1.4-1.4l2.8 2.8-2.8 2.8a1 1 0 1 1-1.4-1.4l1.1-1.1H8a4 4 0 0 1-3.6-2.2l-.15-.3-1.36.7.3-4.17 3.78 1.8-1.34.68.1.18A2.5 2.5 0 0 0 8 15.5h8.5Z" />
                </svg>
              </button>
              <button className={styles.callEndBtn} onClick={onEndCall} aria-label="End call">
                End
              </button>
            </div>

            {isCameraEnabled || isRemoteCameraEnabled ? (
              isMobileCallView ? (
                <div className={styles.mobileVideoStage}>
                  {isRemoteCameraEnabled ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={styles.mobileRemoteVideo}
                    />
                  ) : (
                    <div className={styles.mobileRemotePlaceholder} />
                  )}
                  <div className={styles.mobileLocalPip}>
                    {isCameraEnabled ? (
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className={styles.mobileLocalVideo}
                      />
                    ) : (
                      <div className={styles.mobileLocalPlaceholder} />
                    )}
                  </div>
                </div>
              ) : (
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
              )
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${isMobileLayout ? styles.pageMobile : ''}`}>
      <aside
        className={`${styles.sidebar} ${
          isMobileLayout && mobileView !== 'contacts' ? styles.mobilePaneHidden : ''
        }`}
      >
        <div className={styles.userBar}>
          <div className={styles.userIdentity}>
            <button
              className={styles.selfAvatarBtn}
              onClick={() => setAvatarPickerOpen((prev) => !prev)}
              title="Choose avatar"
            >
              {renderAvatar(currentUser?.avatarKey, 'Your avatar')}
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
                    <img className={styles.avatarImage} src={option.src} alt={option.label} />
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
                  <span className={styles.avatarBubble}>
                    {renderAvatar(user.avatarKey, 'User avatar')}
                  </span>
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
                    <span className={styles.avatarBubble}>
                      {renderAvatar(item.from.avatarKey, 'User avatar')}
                    </span>
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
                      <span className={styles.avatarBubble}>
                        {renderAvatar(item.friend.avatarKey, 'User avatar')}
                      </span>
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

      <main
        className={`${styles.chat} ${
          isMobileLayout && mobileView === 'contacts' ? styles.mobilePaneHidden : ''
        } ${isMobileLayout && mobileView === 'call' ? styles.mobileCallMain : ''}`}
      >
        {isMobileLayout && mobileView !== 'call' ? (
          <div className={styles.mobileChatTop}>
            <button
              type="button"
              className={styles.mobileBackBtn}
              onClick={onMobileBack}
              disabled={callState !== 'idle'}
            >
              Back
            </button>
            <p className={styles.mobileChatTitle}>
              {activePeer ? getUserLabel(activePeer) : 'Select a conversation'}
            </p>
          </div>
        ) : null}

        {isMobileLayout && mobileView === 'call' ? (
          <div className={styles.mobileCallScreen}>{renderCallPanel(true)}</div>
        ) : (
          <>
            <div className={styles.chatHeader}>{callState !== 'idle' ? renderCallPanel() : null}</div>

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
                  disabled={
                    !activeConversation || !activePeer || callState !== 'idle' || !socketConnected
                  }
                  title="Start audio call"
                >
                  <svg className={styles.iconGlyph} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.59.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.46.57 3.59a1 1 0 0 1-.25 1l-2.2 2.2z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.iconCallBtn}
                  onClick={() => onStartCall('video')}
                  disabled={
                    !activeConversation || !activePeer || callState !== 'idle' || !socketConnected
                  }
                  title="Start video call"
                >
                  <svg className={styles.iconGlyph} viewBox="0 0 24 24" aria-hidden="true">
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
          </>
        )}

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
