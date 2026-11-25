import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDz37SPnbbxN9FpP8QfMt2Nm_R12PTHRGY",
  authDomain: "smart-attendance-1eeec.firebaseapp.com",
  projectId: "smart-attendance-1eeec",
  storageBucket: "smart-attendance-1eeec.firebasestorage.app",
  messagingSenderId: "595222818640",
  appId: "1:595222818640:web:1d1f3926df4bb3e1354655"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);

export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);