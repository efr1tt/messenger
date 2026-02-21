import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  updateTokens,
} from '@/entities/session/model/storage';
import { AuthResponse } from '@/entities/session/model/types';

type RetryableConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';

export const client: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

const refreshClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

let refreshPromise: Promise<string | null> | null = null;

client.interceptors.request.use((config) => {
  const token = getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalConfig = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    if (!originalConfig || status !== 401 || originalConfig._retry) {
      return Promise.reject(error);
    }

    const requestUrl = originalConfig.url || '';
    const isAuthEndpoint =
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/register') ||
      requestUrl.includes('/auth/refresh');

    if (isAuthEndpoint) {
      return Promise.reject(error);
    }

    originalConfig._retry = true;

    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }

    try {
      const nextAccessToken = await refreshPromise;
      if (!nextAccessToken) {
        return Promise.reject(error);
      }

      originalConfig.headers.Authorization = `Bearer ${nextAccessToken}`;
      return client(originalConfig);
    } finally {
      refreshPromise = null;
    }
  },
);

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return null;
  }

  try {
    const { data } = await refreshClient.post<AuthResponse>('/auth/refresh', {
      refreshToken,
    });

    updateTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearSession();
    return null;
  }
}
