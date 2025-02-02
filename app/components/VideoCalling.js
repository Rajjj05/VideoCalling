"use client";

import { useEffect, useRef, useState, useContext } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  addDoc,
  onSnapshot,
} from "firebase/firestore";
import { MeetingContext } from "../contexts/MeetingContext";
import MeetingNotes from "./MeetingNotes";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ResponsiveGrid from "./ResponsiveGrid";

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function VideoCalling({
  meetingId,
  userId,
  userName,
  onMeetingEnd,
}) {
  const { resetActiveMeetingContext } = useContext(MeetingContext);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);
  const [hasLeft, setHasLeft] = useState(false); // Track if user left the meeting

  const localVideoRef = useRef(null);
  const pcRef = useRef(null);

  // Initialize local video stream
  const initializeStream = async () => {
    try {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current
          .play()
          .catch((e) => console.log("Play error:", e));
      }

      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Failed to access camera or microphone");
      return null;
    }
  };

  // Setup WebRTC peer connection
  const setupCall = async () => {
    try {
      const meetingsRef = collection(db, "meetings");
      const meetingQuery = query(
        meetingsRef,
        where("meetingId", "==", meetingId)
      );
      const querySnapshot = await getDocs(meetingQuery);

      if (querySnapshot.empty) {
        setError("Meeting not found");
        return;
      }

      const meetingDoc = querySnapshot.docs[0];
      const meetingData = meetingDoc.data();
      setIsHost(meetingData.hostId === userId);

      const stream = await initializeStream();
      if (!stream) return;

      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      // Add local media tracks to the peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // When receiving a remote stream
      pc.ontrack = (event) => {
        console.log("Remote track received", event.streams[0]);
        // Add remote video stream to the state
        setRemoteStreams((prevStreams) => [...prevStreams, event.streams[0]]);
      };

      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          const candidateCollection = isHost
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

        onSnapshot(meetingDoc.ref, (snapshot) => {
          const data = snapshot.data();
          if (data?.answer && !pc.currentRemoteDescription) {
            const answer = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answer);
          }
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

  // Handle participant leaving the meeting
  const leaveMeeting = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    setHasLeft(true);
  };

  // Handle rejoining the meeting
  const rejoinMeeting = async () => {
    setHasLeft(false);
    await setupCall();
  };

  // Handle ending meeting
  const handleEndMeeting = async () => {
    try {
      const meetingsRef = collection(db, "meetings");
      const q = query(meetingsRef, where("meetingId", "==", meetingId));
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const meetingDoc = doc(db, "meetings", snapshot.docs[0].id);
        await updateDoc(meetingDoc, { status: "ended" });
      }

      resetActiveMeetingContext();
      onMeetingEnd();
    } catch (err) {
      console.error("Error ending meeting:", err);
      setError("Failed to end meeting");
    }
  };

  useEffect(() => {
    if (!hasLeft) {
      setupCall();
    }

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [meetingId, userId, hasLeft]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 bg-gray-200">
        <p className="text-lg font-bold">Meeting ID: {meetingId}</p>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded m-4">
          {error}
        </div>
      )}

      {/* Video Grid */}
      {!hasLeft ? (
        <ResponsiveGrid>
          <ParticipantTile isLocal={true} videoRef={localVideoRef} />
          {remoteStreams.map((stream, index) => (
            <ParticipantTile key={index} videoStream={stream} />
          ))}
        </ResponsiveGrid>
      ) : (
        <div className="flex items-center justify-center h-full">
          <button
            onClick={rejoinMeeting}
            className="p-4 bg-green-600 text-white rounded-lg shadow-lg hover:bg-green-700"
          >
            Rejoin Meeting
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="p-4 bg-gray-800 flex items-center justify-center gap-4">
        {!hasLeft ? (
          <>
            <button
              onClick={leaveMeeting}
              className="p-3 bg-yellow-600 rounded-full hover:bg-opacity-80 transition"
            >
              Leave Meeting
            </button>
            {isHost && (
              <button
                onClick={handleEndMeeting}
                className="p-3 bg-red-600 rounded-full hover:bg-opacity-80 transition"
              >
                End Meeting
              </button>
            )}
          </>
        ) : null}
      </div>

      {/* Floating Notes Button */}
      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}

// Participant Tile Component
function ParticipantTile({
  participant,
  isLocal = false,
  videoRef,
  videoStream,
}) {
  return (
    <Card className="relative aspect-video overflow-hidden">
      <CardContent className="p-0">
        {isLocal ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : videoStream ? (
          <video
            src={videoStream}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-gray-200 dark:bg-gray-700">
            <span className="text-4xl">
              {participant?.name?.[0]?.toUpperCase() || "A"}
            </span>
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex justify-start items-center">
          <Badge variant="secondary" className="text-xs">
            {isLocal ? "You" : participant?.name || "Anonymous"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
