export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthPayload = {
  sub: string;
  email: string;
};

export type AccessPayload = {
  sub: string;
  email: string;
  type: 'access';
  iat: number;
  exp: number;
};

export type RefreshPayload = {
  sub: string;
  sid: string;
  type: 'refresh';
  iat: number;
  exp: number;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
};
