/** Per-route auth limits. The global limiter remains a backstop for other routes. */
export const authRateLimitWindow = "15 minutes";

export const authRateLimits = {
  register: { max: 5, timeWindow: authRateLimitWindow },
  login: { max: 10, timeWindow: authRateLimitWindow },
  totpConfirm: { max: 10, timeWindow: authRateLimitWindow },
  forgotPassword: { max: 5, timeWindow: authRateLimitWindow },
  resetPassword: { max: 5, timeWindow: authRateLimitWindow },
  logout: { max: 30, timeWindow: authRateLimitWindow },
} as const;
