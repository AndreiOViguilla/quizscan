// Firebase Auth utility
import { FIREBASE_CONFIG } from "./constants";

let app, auth;

async function getFirebase() {
  if (auth) return { auth };
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const isNew = !getApps().length;
  if (isNew) app = initializeApp(FIREBASE_CONFIG);
  else app = getApps()[0];
  auth = getAuth(app);

  // Firebase App Check — blocks direct DB access from non-browser clients
  // Setup: Firebase Console → App Check → Register app with reCAPTCHA v3
  // Then set REACT_APP_APPCHECK_KEY in your Vercel env vars
  if (isNew && process.env.REACT_APP_APPCHECK_KEY) {
    try {
      if (process.env.NODE_ENV === "development") {
        // Allows App Check to work locally without a real attestation token
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.REACT_APP_APPCHECK_DEBUG_TOKEN || true;
      }
      const { initializeAppCheck, ReCaptchaV3Provider } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js"
      );
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(process.env.REACT_APP_APPCHECK_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch {}
  }

  return { auth };
}

export async function signInWithGoogle() {
  const { auth } = await getFirebase();
  const { GoogleAuthProvider, signInWithPopup } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signInWithEmail(email, password) {
  const { auth } = await getFirebase();
  const { signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function signUpWithEmail(email, password, displayName) {
  const { auth } = await getFirebase();
  const { createUserWithEmailAndPassword, updateProfile } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(result.user, { displayName });
  return result.user;
}

export async function signOut() {
  const { auth } = await getFirebase();
  const { signOut: fbSignOut } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  await fbSignOut(auth);
}

export async function onAuthChange(callback) {
  const { auth } = await getFirebase();
  const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  return onAuthStateChanged(auth, callback);
}

export async function resetPassword(email) {
  const { auth } = await getFirebase();
  const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  await sendPasswordResetEmail(auth, email);
}
