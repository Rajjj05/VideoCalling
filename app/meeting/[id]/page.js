"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useAuth } from "../../contexts/AuthContext"
import VideoCalling from "../../components/VideoCalling"
import { Loader2 } from "lucide-react"

export default function MeetingPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Wait for user authentication
    if (user) {
      setIsLoading(false)
    }
  }, [user])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg">Please sign in to join the meeting.</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 h-screen">
      <VideoCalling
        meetingId={id}
        userId={user.uid}
        userName={user.displayName || 'Anonymous'}
      />
    </div>
  )
}
