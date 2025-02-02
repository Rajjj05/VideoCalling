"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";
import VideoCalling from "../../components/VideoCalling";
import { Loader2 } from "lucide-react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

export default function MeetingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);

  // Initialize local video stream

  const setupCall = async () => {
    try {
      // Fetch meeting data from Firestore
      const meetingsRef = collection(db, "meetings");
      const meetingQuery = query(meetingsRef, where("meetingId", "==", id));
      const querySnapshot = await getDocs(meetingQuery);

      if (querySnapshot.empty) {
        setError("Meeting not found");
        return;
      }

      const meetingDoc = querySnapshot.docs[0];
      const meetingData = meetingDoc.data();
      setIsHost(meetingData.hostId === user.uid);

      const stream = await initializeStream();
      if (!stream) return;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Add local stream tracks to the peer connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle incoming tracks
      pc.ontrack = (event) => {
        setRemoteStreams((prevStreams) => [...prevStreams, event.streams[0]]);
      };

      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          const candidateCollection =
            meetingData.hostId === user.uid
              ? collection(meetingDoc.ref, "callerCandidates")
              : collection(meetingDoc.ref, "calleeCandidates");
          await addDoc(candidateCollection, event.candidate.toJSON());
        }
      };

      // Set up signaling based on role (host/guest)
      if (isHost) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await updateDoc(meetingDoc.ref, {
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        });
      } else {
        onSnapshot(meetingDoc.ref, async (snapshot) => {
          const data = snapshot.data();
          if (data?.offer && !pc.currentRemoteDescription) {
            await pc.setRemoteDescription(
              new RTCSessionDescription(data.offer)
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await updateDoc(meetingDoc.ref, {
              answer: {
                type: answer.type,
                sdp: answer.sdp,
              },
            });
          }
        });
      }

      // Listen for meeting status changes
      onSnapshot(meetingDoc.ref, (snapshot) => {
        const data = snapshot.data();
        if (data?.status === "ended") {
          setIsMeetingEnded(true);
        }
      });
    } catch (err) {
      console.error("Error in setupCall:", err);
      setError("Failed to setup call");
    }
  };

  useEffect(() => {
    let mounted = true;

    const checkMeetingAndAuth = async () => {
      try {
        if (!user) {
          if (mounted) setIsLoading(false);
          return;
        }

        // Verify meeting exists and is active
        const meetingsRef = collection(db, "meetings");
        const meetingQuery = query(meetingsRef, where("meetingId", "==", id));
        const querySnapshot = await getDocs(meetingQuery);

        if (!querySnapshot.empty) {
          const meetingData = querySnapshot.docs[0].data();
          if (meetingData.status === "ended") {
            throw new Error("This meeting has ended");
          }
        } else {
          throw new Error("Meeting not found");
        }

        if (mounted) {
          setIsLoading(false);
          setError(null);
          await setupCall();
        }
      } catch (err) {
        console.error("Error checking meeting:", err);
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
    router.push("/meetings");
  };

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
            onClick={() => router.push("/login")}
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
            onClick={() => router.push("/meetings")}
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
        userName={user.displayName || "Anonymous"}
        onMeetingEnd={handleMeetingEnd}
        remoteStreams={remoteStreams} // Pass remote streams to VideoCalling component
        localStream={localStream} // Pass local stream to VideoCalling component
      />
    </div>
  );
}
