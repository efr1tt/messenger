export function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
}

export function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
}
