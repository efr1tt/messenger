import { client } from '@/shared/api/client';
import { AuthResponse } from '../model/types';

export type AuthCredentials = {
  email: string;
  password: string;
};

export type RegisterCredentials = AuthCredentials & {
  username: string;
  displayName: string;
};

export async function register(payload: RegisterCredentials) {
  const { data } = await client.post<AuthResponse>('/auth/register', payload);
  return data;
}

export async function login(payload: AuthCredentials) {
  const { data } = await client.post<AuthResponse>('/auth/login', payload);
  return data;
}

export async function logout(refreshToken: string) {
  const { data } = await client.post<{ success: boolean }>('/auth/logout', {
    refreshToken,
  });
  return data;
}
