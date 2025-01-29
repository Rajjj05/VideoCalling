"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth"
import { auth } from "../lib/firebase"

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user)
      setLoading(false)
    })

    return () => unsubscribe();
  }, [])

  const login = () => {
    const provider = new GoogleAuthProvider()
    return signInWithPopup(auth, provider);
  }

  const logout = () => {
    return signOut(auth);
  }

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext)

