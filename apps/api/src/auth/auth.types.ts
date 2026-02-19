export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthPayload = {
  sub: string;
  email: string;
};

export type RefreshPayload = {
  sub: string;
  sid: string;
  type: 'refresh';
  iat: number;
  exp: number;
};
