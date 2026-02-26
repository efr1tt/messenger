export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  avatarKey?: string | null;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};
