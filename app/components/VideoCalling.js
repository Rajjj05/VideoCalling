"use client";

import { useEffect, useRef, useState, useContext } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { MeetingContext } from "../contexts/MeetingContext";
import MeetingNotes from "./MeetingNotes";

// STUN server configuration
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
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [hasLeft, setHasLeft] = useState(false); // Track if user left the meeting

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

      // Add local stream tracks to the peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // When receiving a remote stream
      pc.ontrack = (event) => {
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

      if (isHost) {
        // Host creates offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await updateDoc(meetingDoc.ref, {
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        });

        // Listen for answer from the participant
        onSnapshot(meetingDoc.ref, (snapshot) => {
          const data = snapshot.data();
          if (data?.answer && !pc.currentRemoteDescription) {
            const answer = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answer);
          }
        });

        // Listen for ICE candidates from the callee
        const calleeCandidates = collection(meetingDoc.ref, "calleeCandidates");
        onSnapshot(calleeCandidates, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const candidate = new RTCIceCandidate(change.doc.data());
              pc.addIceCandidate(candidate);
            }
          });
        });
      } else {
        // Participant creates answer after receiving the host's offer
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

        // Listen for ICE candidates from the host
        const callerCandidates = collection(meetingDoc.ref, "callerCandidates");
        onSnapshot(callerCandidates, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const candidate = new RTCIceCandidate(change.doc.data());
              pc.addIceCandidate(candidate);
            }
          });
        });
      }
    } catch (err) {
      console.error("Error during setup:", err);
      setError("An error occurred while setting up the call.");
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

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
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
      {/* Display the meeting ID */}
      <div className="p-4 bg-gray-200">
        <p className="text-lg font-bold">Meeting ID: {meetingId}</p>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded m-4">
          {error}
        </div>
      )}

      {/* Video display */}
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

      {/* Control Bar */}
      <div className="p-4 bg-gray-800 flex items-center justify-center gap-4">
        {!hasLeft ? (
          <>
            <button
              onClick={toggleAudio}
              className="p-3 bg-gray-700 rounded-full hover:bg-opacity-80 transition"
            >
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={toggleVideo}
              className="p-3 bg-gray-700 rounded-full hover:bg-opacity-80 transition"
            >
              {isVideoOff ? "Enable Video" : "Disable Video"}
            </button>
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

      {/* Meeting Notes */}
      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}
