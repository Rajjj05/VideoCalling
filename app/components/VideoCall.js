"use client";

import { useState, useEffect, useRef } from "react";
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
} from "react-icons/fa"; // Import icons
import { sendSignalingMessage } from "../lib/websocket"; // Import sendSignalingMessage
import { useRouter } from "next/navigation"; // Import router for navigation

const VideoCall = ({ meetingId, userId, isHost }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isWebSocketOpen, setIsWebSocketOpen] = useState(false); // Track WebSocket connection status

  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef([]);
  const peerConnections = useRef({}); // Store peer connections
  const router = useRouter(); // Next.js router for navigation

  const configuration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const constraints = {
          video: !isVideoOff,
          audio: !isMuted,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        localVideoRef.current.srcObject = stream;

        // Ensure WebSocket is open before sending signaling message
        if (isWebSocketOpen) {
          sendSignalingMessage({
            type: "join",
            roomId: meetingId,
            userId,
            isHost,
          });
        } else {
          console.log("WebSocket is not open, retrying...");
          const intervalId = setInterval(() => {
            if (isWebSocketOpen) {
              sendSignalingMessage({
                type: "join",
                roomId: meetingId,
                userId,
                isHost,
              });
              clearInterval(intervalId); // Stop retrying once WebSocket is open
            }
          }, 1000); // Retry every second until WebSocket is open
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
      }
    };

    getLocalStream();
  }, [isMuted, isVideoOff, meetingId, userId, isWebSocketOpen]);

  useEffect(() => {
    const handleSignalingMessage = (data) => {
      const { type, offer, answer, candidate, roomId } = data;

      if (roomId !== meetingId) return;

      switch (type) {
        case "offer":
          handleOffer(offer);
          break;
        case "answer":
          handleAnswer(answer);
          break;
        case "candidate":
          handleCandidate(candidate);
          break;
        case "new-participant":
          console.log(`${data.userId} joined the room`);
          break;
        case "participant-left":
          console.log(`${data.userId} left the room`);
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", (event) =>
      handleSignalingMessage(event.data)
    );

    return () => {
      window.removeEventListener("message", handleSignalingMessage);
    };
  }, [meetingId]);

  const handleOffer = (offer) => {
    const peerConnection = new RTCPeerConnection(configuration);

    // Set the remote description (received offer)
    peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Create an answer and set the local description
    peerConnection.createAnswer().then((answer) => {
      peerConnection.setLocalDescription(answer);
      sendSignalingMessage({ type: "answer", answer, roomId: meetingId });
    });

    // Add tracks from the local stream to the peer connection
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // Handle incoming remote streams
    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setRemoteStreams((prevStreams) => [...prevStreams, remoteStream]);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage({
          type: "candidate",
          candidate: event.candidate,
          roomId: meetingId,
        });
      }
    };

    // Save the peer connection
    peerConnections.current[meetingId] = peerConnection;
  };

  const handleAnswer = (answer) => {
    const peerConnection = peerConnections.current[meetingId];
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleCandidate = (candidate) => {
    const peerConnection = peerConnections.current[meetingId];
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  };

  const toggleAudio = () => setIsMuted((prev) => !prev);
  const toggleVideo = () => setIsVideoOff((prev) => !prev);

  // End Meeting Logic
  const endMeeting = async () => {
    if (isHost) {
      try {
        // Update the meeting status to "ended" in Firestore
        const meetingRef = doc(db, "meetings", meetingId);
        await updateDoc(meetingRef, {
          status: "ended",
        });

        // Redirect users to the meetings page
        router.push("/meetings");
      } catch (error) {
        console.error("Error ending the meeting:", error);
      }
    }
  };

  return (
    <div>
      <div>
        <button onClick={toggleAudio}>
          {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
        </button>
        <button onClick={toggleVideo}>
          {isVideoOff ? <FaVideoSlash /> : <FaVideo />}
        </button>
        {isHost && (
          <button onClick={endMeeting}>End Meeting</button> // Host can end the meeting
        )}
      </div>

      <div>
        <video ref={localVideoRef} autoPlay muted />
        {remoteStreams.map((stream, index) => (
          <video
            key={index}
            ref={(ref) => (remoteVideoRefs.current[index] = ref)}
            autoPlay
          />
        ))}
      </div>
    </div>
  );
};

export default VideoCall;
