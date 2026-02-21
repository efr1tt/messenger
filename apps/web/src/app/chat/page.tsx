'use client';

import {
  acceptFriendRequest,
  declineFriendRequest,
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
import { createChatSocket, MessageNewEvent } from '@/shared/socket/chat-socket';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import styles from './page.module.css';

const queryKeys = {
  me: ['me'] as const,
  friends: ['friends'] as const,
  friendRequests: ['friendRequests'] as const,
  conversations: ['conversations'] as const,
  messages: (conversationId: string | null) => ['messages', conversationId] as const,
  userSearch: (term: string) => ['userSearch', term] as const,
};

export default function ChatPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const selectedConversationRef = useRef<string | null>(null);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [messageText, setMessageText] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

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

    socket.on('message:new', onMessageNew);

    return () => {
      socket.off('message:new', onMessageNew);
      socket.disconnect();
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

  useEffect(() => {
    if (!selectedConversationId || hasToken !== true) {
      return;
    }

    markReadMutation.mutate(selectedConversationId);
  }, [selectedConversationId, hasToken]);

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
                <span>{item.friend.email}</span>
                <button onClick={() => onOpenDirect(item.friend.id)}>Chat</button>
              </div>
            ))}
            {!friendsQuery.data?.length ? <p className={styles.empty}>No friends yet</p> : null}
          </div>
        </section>
      </aside>

      <main className={styles.chat}>
        <div className={styles.chatHeader}>
          <h2>Conversations</h2>
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
      </main>
    </div>
  );
}
