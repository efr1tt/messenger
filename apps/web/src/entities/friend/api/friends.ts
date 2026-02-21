import { client } from '@/shared/api/client';

export type FriendItem = {
  id: string;
  createdAt: string;
  friend: {
    id: string;
    email: string;
    createdAt: string;
  };
};

export type IncomingRequestItem = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED';
  createdAt: string;
  from: {
    id: string;
    email: string;
    createdAt: string;
  };
};

export async function getFriends() {
  const { data } = await client.get<FriendItem[]>('/friends');
  return data;
}

export async function getIncomingRequests() {
  const { data } = await client.get<IncomingRequestItem[]>('/friends/requests');
  return data;
}

export async function sendFriendRequest(toUserId: string) {
  const { data } = await client.post('/friends/request', { toUserId });
  return data;
}

export async function acceptFriendRequest(requestId: string) {
  const { data } = await client.post('/friends/accept', { requestId });
  return data;
}

export async function declineFriendRequest(requestId: string) {
  const { data } = await client.post('/friends/decline', { requestId });
  return data;
}
