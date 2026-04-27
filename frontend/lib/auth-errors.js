const authErrorMessages = {
  CredentialsSignin: "The email or password is incorrect.",
  AccessDenied: "Access was denied for this account.",
  Configuration:
    "Authentication is not configured correctly. Check NEXTAUTH_SECRET in frontend/.env.local.",
  Verification: "Verification failed. Please try again.",
  Default: "Authentication failed. Please try again.",
};

export function getAuthErrorMessage(errorCode) {
  if (!errorCode) {
    return "";
  }

  return authErrorMessages[errorCode] || authErrorMessages.Default;
}

