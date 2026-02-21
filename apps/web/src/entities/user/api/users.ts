import { client } from '@/shared/api/client';
import { AuthUser } from '@/entities/session/model/types';

export async function getMe() {
  const { data } = await client.get<AuthUser>('/users/me');
  return data;
}

export async function searchUsers(query: string) {
  const { data } = await client.get<Array<{ id: string; email: string; createdAt: string }>>(
    '/users/search',
    {
      params: { query },
    },
  );

  return data;
}
