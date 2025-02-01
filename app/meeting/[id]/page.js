"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "../../contexts/AuthContext"
import VideoCalling from "../../components/VideoCalling"
import { Loader2 } from "lucide-react"
import { collection, query, where, getDocs } from "firebase/firestore"
import { db } from "../../lib/firebase"

export default function MeetingPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true;

    const checkMeetingAndAuth = async () => {
      try {
        if (!user) {
          if (mounted) setIsLoading(false);
          return;
        }

        // Verify meeting exists and is active
        const meetingsRef = collection(db, 'meetings');
        const meetingQuery = query(meetingsRef, where('meetingId', '==', id));
        const querySnapshot = await getDocs(meetingQuery);

        if (!querySnapshot.empty) {
          const meetingData = querySnapshot.docs[0].data();
          if (meetingData.status === 'ended') {
            throw new Error('This meeting has ended');
          }
        } else {
          throw new Error('Meeting not found');
        }

        if (mounted) {
          setIsLoading(false);
          setError(null);
        }
      } catch (err) {
        console.error('Error checking meeting:', err);
        if (mounted) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    };

    checkMeetingAndAuth();

    return () => {
      mounted = false;
    };
  }, [user, id]);

  const handleMeetingEnd = () => {
    router.push('/meetings');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg mb-4">Please sign in to join the meeting.</p>
          <button
            onClick={() => router.push('/login')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-red-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/meetings')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 h-screen">
      <VideoCalling
        meetingId={id}
        userId={user.uid}
        userName={user.displayName || 'Anonymous'}
        onMeetingEnd={handleMeetingEnd}
      />
    </div>
  );
}
