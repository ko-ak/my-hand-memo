import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyAQoUY1JaFCrMZqEL0jrOQpPBu3WwtqRFI",
  authDomain: "codel-hand-memo.firebaseapp.com",
  projectId: "codel-hand-memo",
  storageBucket: "codel-hand-memo.firebasestorage.app",
  messagingSenderId: "205887830808",
  appId: "1:205887830808:web:28be768dc15cc0a8147c6d",
  measurementId: "G-1NFLS7KWDW"
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const googleProvider = new GoogleAuthProvider()

export const firebaseSignIn = async (): Promise<User> => {
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

export const firebaseSignOut = async (): Promise<void> => {
  await signOut(auth)
}

export const onFirebaseAuthStateChanged = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback)
}

export { auth }
