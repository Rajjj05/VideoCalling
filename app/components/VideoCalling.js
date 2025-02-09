import { useEffect, useRef, useState } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  onSnapshot,
  addDoc,
  doc,
} from "firebase/firestore";
import MeetingNotes from "./MeetingNotes";
import MeetingControls from "./MeetingControl";
import ScreenShareButton from "./ScreenShareButton";
import { Button } from "@/components/ui/button"; // ✅ Importing ShadCN Button
import { ClipboardCopy } from "lucide-react"; // ✅ ShadCN Icon for Copy Button

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function VideoCalling({
  meetingId,
  userId,
  userName,
  onMeetingEnd,
}) {
  const localVideoRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // Store multiple participant streams
  const [peerConnections, setPeerConnections] = useState({});
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [copied, setCopied] = useState(false); // ✅ State to show "Copied!"

  useEffect(() => {
    let unsubscribe = null;
    let stream = null;

    const initializeMeeting = async () => {
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
        const roomRef = meetingDoc.ref;

        unsubscribe = onSnapshot(roomRef, (snapshot) => {
          const data = snapshot.data();
          if (data?.status === "ended") {
            setMeetingEnded(true);
          }
        });

        if (meetingData.status === "ended") {
          setMeetingEnded(true);
          return;
        }

        // Get user media
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Handle new participants
        const participantsRef = collection(roomRef, "participants");
        await addDoc(participantsRef, { userId, userName });

        onSnapshot(participantsRef, async (snapshot) => {
          const participants = snapshot.docs.map((doc) => doc.data());
          const newPeerConnections = { ...peerConnections };

          for (const participant of participants) {
            if (
              participant.userId !== userId &&
              !newPeerConnections[participant.userId]
            ) {
              const pc = new RTCPeerConnection(configuration);
              stream.getTracks().forEach((track) => pc.addTrack(track, stream));

              pc.ontrack = (event) => {
                setRemoteStreams((prev) => [...prev, event.streams[0]]);
              };

              pc.onicecandidate = async (event) => {
                if (event.candidate) {
                  const iceRef = collection(
                    roomRef,
                    `iceCandidates_${userId}_${participant.userId}`
                  );
                  await addDoc(iceRef, event.candidate.toJSON());
                }
              };

              newPeerConnections[participant.userId] = pc;
            }
          }

          setPeerConnections(newPeerConnections);
        });
      } catch (err) {
        console.error("Error during setup:", err);
        setError("An error occurred while setting up the call.");
      }
    };

    initializeMeeting();

    return () => {
      if (unsubscribe) unsubscribe();
      for (const pc of Object.values(peerConnections)) {
        pc.close();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingId, userId]);

  const handleLeaveMeeting = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    for (const pc of Object.values(peerConnections)) {
      pc.close();
    }
    setLocalStream(null);
    setError("You have left the meeting.");
  };

  const handleEndMeeting = async () => {
    try {
      const meetingRef = doc(db, "meetings", meetingId);
      await updateDoc(meetingRef, { status: "ended" });
      setMeetingEnded(true);
      onMeetingEnd();
    } catch (err) {
      console.error("Error ending meeting:", err);
      setError("An error occurred while ending the meeting.");
    }
  };

  // ✅ Toggle Video
  const toggleVideo = () => {
    if (localStream) {
      const newState = !isVideoOn;
      setIsVideoOn(newState);
      localStream.getVideoTracks()[0].enabled = newState;
    }
  };

  // ✅ Toggle Audio
  const toggleAudio = () => {
    if (localStream) {
      const newState = !isAudioOn;
      setIsAudioOn(newState);
      localStream.getAudioTracks()[0].enabled = newState;
    }
  };

  // ✅ Copy Meeting ID
  const copyMeetingId = () => {
    navigator.clipboard.writeText(meetingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // Reset "Copied!" after 2 sec
  };

  return (
    <div className="h-full flex flex-col">
      {meetingEnded && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded m-4">
          <p className="text-lg font-bold">Meeting has ended.</p>
        </div>
      )}

      {/* ✅ Meeting ID with Copy Button */}
      <div className="flex items-center justify-between p-4 bg-gray-200">
        <p className="text-lg font-bold">Meeting ID: {meetingId}</p>
        <Button
          onClick={copyMeetingId}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded"
        >
          <ClipboardCopy size={18} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 p-4">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-1/3 bg-black rounded"
        />
        {remoteStreams.map((stream, index) => (
          <video
            key={index}
            autoPlay
            playsInline
            className="w-1/3 bg-black rounded"
            ref={(el) => el && (el.srcObject = stream)}
          />
        ))}
      </div>

      {/* ✅ Audio/Video Toggle Buttons */}
      <div className="p-4 flex justify-center gap-4">
        <Button onClick={toggleAudio} className="bg-green-600 text-white">
          {isAudioOn ? "Mute Audio" : "Unmute Audio"}
        </Button>
        <Button onClick={toggleVideo} className="bg-green-600 text-white">
          {isVideoOn ? "Turn Off Video" : "Turn On Video"}
        </Button>
      </div>

      <ScreenShareButton
        pc={peerConnections[userId]}
        localStream={localStream}
      />

      <MeetingControls
        meetingId={meetingId}
        userId={userId}
        isHost={isHost}
        onLeave={handleLeaveMeeting}
        onEnd={handleEndMeeting}
        localStream={localStream}
      />

      <MeetingNotes meetingId={meetingId} userId={userId} />
    </div>
  );
}
