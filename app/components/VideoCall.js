"use client"; // Ensure this is a client-side component

import { useState, useEffect, useRef } from "react";
import {
  FaMicrophone,
  FaMicrophoneSlash,
  FaVideo,
  FaVideoSlash,
} from "react-icons/fa"; // Import icons
import { useRouter } from "next/navigation"; // Import router for navigation
import { sendSignalingMessage } from "../lib/websocket"; // WebSocket signaling
import { db } from "../lib/firebase";
import { doc, updateDoc } from "firebase/firestore";

// WebRTC configuration
const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const VideoCall = ({ meetingId, isHost, meetingHostId }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef([]);
  const [meetingStatus, setMeetingStatus] = useState("active");
  const [peerConnections, setPeerConnections] = useState({});
  const router = useRouter();

  // Function to end the meeting and update Firestore
  const endMeeting = async () => {
    try {
      if (!isHost) return; // Only host can end the meeting

      const meetingRef = doc(db, "meetings", meetingId);
      await updateDoc(meetingRef, {
        status: "ended",
      });

      // Update status to ended
      setMeetingStatus("ended");
      console.log("Meeting ended");

      // Redirect the user to /meetings page
      router.push("/meetings");
    } catch (error) {
      console.error("Error ending the meeting:", error);
    }
  };

  // Function to get local stream (audio + video)
  useEffect(() => {
    const getLocalStream = async () => {
      try {
        const constraints = {
          video: !isVideoOff,
          audio: !isMuted,
        };

        // If both audio and video are off, fallback to video on
        if (!constraints.video && !constraints.audio) {
          constraints.video = true; // Fallback to video if both are off
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        sendSignalingMessage({ type: "join", meetingId }); // Notify server when joining the meeting
      } catch (error) {
        console.error("Error accessing media devices:", error);
      }
    };

    getLocalStream();
  }, [isMuted, isVideoOff, meetingId]);

  // WebRTC signaling for remote streams
  useEffect(() => {
    const handleSignalingMessage = (data) => {
      const { type, offer, answer, candidate, meetingId } = data;

      if (meetingId !== meetingId) return;

      if (type === "offer") {
        // Handle offer
        const peerConnection = new RTCPeerConnection(configuration);
        peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        peerConnection.createAnswer().then((answer) => {
          peerConnection.setLocalDescription(answer);
          sendSignalingMessage({ type: "answer", answer, meetingId });
        });

        peerConnection.ontrack = (event) => {
          setRemoteStreams((prevStreams) => [...prevStreams, event.streams[0]]);
        };
        setPeerConnections((prev) => ({
          ...prev,
          [meetingId]: peerConnection,
        }));
      } else if (type === "answer") {
        // Handle answer
        peerConnections[meetingId].setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } else if (type === "candidate") {
        // Handle ICE candidate
        const candidate = new RTCIceCandidate(candidate);
        peerConnections[meetingId].addIceCandidate(candidate);
      }
    };

    // Listen for signaling messages
    window.addEventListener("message", (event) => {
      handleSignalingMessage(event.data);
    });

    return () => {
      window.removeEventListener("message", handleSignalingMessage);
    };
  }, [meetingId, peerConnections]);

  const toggleAudio = () => {
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    setIsVideoOff(!isVideoOff);
  };

  return (
    <div className="video-call-container">
      <div className="controls">
        {/* Audio Toggle */}
        <button onClick={toggleAudio} className="control-button">
          {isMuted ? (
            <FaMicrophoneSlash className="icon" />
          ) : (
            <FaMicrophone className="icon" />
          )}
        </button>

        {/* Video Toggle */}
        <button onClick={toggleVideo} className="control-button">
          {isVideoOff ? (
            <FaVideoSlash className="icon" />
          ) : (
            <FaVideo className="icon" />
          )}
        </button>

        {/* End Meeting Button */}
        {isHost && meetingStatus === "active" && (
          <button onClick={endMeeting} className="end-button">
            End Meeting
          </button>
        )}
      </div>

      <div className="video-grid">
        {/* Display local video */}
        {localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            style={{ width: "300px", height: "auto", margin: "10px" }}
          />
        )}

        {/* Display remote videos */}
        {remoteStreams.map((stream, index) => (
          <video
            key={index}
            ref={(ref) => {
              if (ref) remoteVideoRefs.current[index] = ref;
            }}
            autoPlay
            style={{ width: "300px", height: "auto", margin: "10px" }}
          />
        ))}
      </div>
    </div>
  );
};

export default VideoCall;
