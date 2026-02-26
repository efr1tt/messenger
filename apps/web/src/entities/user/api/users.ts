import { client } from '@/shared/api/client';
import { AuthUser } from '@/entities/session/model/types';

export async function getMe() {
  const { data } = await client.get<AuthUser>('/users/me');
  return data;
}

export async function searchUsers(query: string) {
  const { data } = await client.get<
    Array<{
      id: string;
      username: string;
      displayName: string;
      avatarKey?: string | null;
      email: string;
      createdAt: string;
    }>
  >(
    '/users/search',
    {
      params: { query },
    },
  );

  return data;
}

export async function updateMyAvatar(avatarKey: string | null) {
  const { data } = await client.patch<AuthUser>('/users/me/avatar', { avatarKey });
  return data;
}

export async function updateMyDisplayName(displayName: string) {
  const { data } = await client.patch<AuthUser>('/users/me/display-name', { displayName });
  return data;
}
