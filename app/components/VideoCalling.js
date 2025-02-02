"use client";

import { useEffect, useRef, useState } from "react";
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
import { useContext } from "react";
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
  participants = [],
}) {
  const { resetActiveMeetingContext } = useContext(MeetingContext);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);

  const localVideoRef = useRef(null);
  const pcRef = useRef(null);

  // Initialize local video stream
  const initializeStream = async (isVideoEnabled) => {
    try {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoEnabled,
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

      const stream = await initializeStream(true);
      if (!stream) return;

      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        console.log("Remote track received", event.streams[0]);
      };

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

  // Toggle Video
  const toggleVideo = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Toggle Audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
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
    setupCall();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [meetingId, userId]);

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
      <ResponsiveGrid>
        <ParticipantTile isLocal={true} videoRef={localVideoRef} />
        {participants.map((participant, index) => (
          <ParticipantTile key={index} participant={participant} />
        ))}
      </ResponsiveGrid>

      {/* Controls */}
      <div className="p-4 bg-gray-800 flex items-center justify-center gap-4">
        <button
          onClick={toggleAudio}
          className={`p-3 rounded-full ${
            isMuted ? "bg-red-600" : "bg-gray-700"
          } hover:bg-opacity-80 transition`}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>

        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full ${
            isVideoOff ? "bg-red-600" : "bg-gray-700"
          } hover:bg-opacity-80 transition`}
        >
          {isVideoOff ? "Enable Video" : "Disable Video"}
        </button>

        {isHost && (
          <button
            onClick={handleEndMeeting}
            className="p-3 bg-red-600 rounded-full hover:bg-opacity-80 transition"
          >
            End Meeting
          </button>
        )}
      </div>

      {/* Floating Notes Button */}
      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}

// Participant Tile Component
function ParticipantTile({ participant, isLocal = false, videoRef }) {
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
        ) : participant.videoOn ? (
          <video
            src={participant.videoStream}
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
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
          <Badge variant="secondary" className="text-xs">
            {isLocal ? "You" : participant?.name || "Anonymous"}
          </Badge>
          {(isLocal || participant?.isMuted) && (
            <Badge variant="destructive" className="text-xs">
              Muted
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
