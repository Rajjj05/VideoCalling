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
  const [isMeetingEnded, setIsMeetingEnded] = useState(false); // Track meeting end status

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);

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

      // Update peer connection if exists
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        const videoSender = senders.find(
          (sender) => sender.track?.kind === "video"
        );
        const audioSender = senders.find(
          (sender) => sender.track?.kind === "audio"
        );

        if (videoSender) {
          videoSender.replaceTrack(stream.getVideoTracks()[0]);
        }
        if (audioSender) {
          audioSender.replaceTrack(stream.getAudioTracks()[0]);
        }
      }

      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error("Error accessing media devices:", err);
      setError("Failed to access camera or microphone");
      return null;
    }
  };

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
      const hostFlag = meetingData.hostId === userId;
      setIsHost(hostFlag);

      // Initialize stream
      const stream = await initializeStream(true);
      if (!stream) return;

      // Create the RTCPeerConnection
      const pc = new RTCPeerConnection(configuration);
      pcRef.current = pc;

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle incoming tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          const candidateCollection = hostFlag
            ? collection(meetingDoc.ref, "callerCandidates")
            : collection(meetingDoc.ref, "calleeCandidates");
          await addDoc(candidateCollection, event.candidate.toJSON());
        }
      };

      // Set up signaling based on role (host/guest)
      if (hostFlag) {
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
          setIsMeetingEnded(true); // Set meeting as ended when status is updated
        }
      });
    } catch (err) {
      console.error("Error in setupCall:", err);
      setError("Failed to setup call");
    }
  };

  // Handle video toggle
  const toggleVideo = async () => {
    try {
      if (!isVideoOff) {
        // Turn off video
        if (localStream) {
          const videoTracks = localStream.getVideoTracks();
          videoTracks.forEach((track) => {
            track.stop();
            localStream.removeTrack(track);
          });

          // Clear the video element
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
          }
        }
        setIsVideoOff(true);
      } else {
        // Turn on video
        await initializeStream(true);
        setIsVideoOff(false);
      }
    } catch (err) {
      console.error("Error toggling video:", err);
      setError("Failed to toggle video");
    }
  };

  // Handle audio toggle
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!isMuted);
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

      // Reset active meeting status and context
      resetActiveMeetingContext();
      onMeetingEnd(); // Trigger callback to update the UI
    } catch (err) {
      console.error("Error ending meeting:", err);
      setError("Failed to end meeting");
    }
  };

  // Initialize call on component mount
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

      <div className="flex flex-1">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-1/2 bg-black"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-1/2 bg-black"
        />
      </div>

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
    </div>
  );
}
