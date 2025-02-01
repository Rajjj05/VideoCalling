// components/VideoCalling.js
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
} from "firebase/firestore";

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
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const [error, setError] = useState(null);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    // Wrap the async setup in an IIFE
    (async () => {
      try {
        // 1. Fetch meeting document to determine if current user is the host
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

        // 2. Get user media (local video & audio)
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        // 3. Create the RTCPeerConnection
        const pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        // Add local stream tracks to the peer connection
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });

        // Display remote stream when received
        pc.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        // Reference to the meeting document for signaling
        const roomRef = meetingDoc.ref;

        // 4. Handle ICE candidates: send them to Firestore in corresponding subcollection
        pc.onicecandidate = async (event) => {
          if (!event.candidate) return;
          const jsonCandidate = event.candidate.toJSON();
          if (hostFlag) {
            const callerCandidates = collection(roomRef, "callerCandidates");
            await addDoc(callerCandidates, jsonCandidate);
          } else {
            const calleeCandidates = collection(roomRef, "calleeCandidates");
            await addDoc(calleeCandidates, jsonCandidate);
          }
        };

        if (hostFlag) {
          // 5A. Host: Create offer, set local description, and update Firestore with the offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await updateDoc(roomRef, {
            offer: {
              type: offer.type,
              sdp: offer.sdp,
            },
          });

          // Listen for answer from the participant
          onSnapshot(roomRef, (snapshot) => {
            const data = snapshot.data();
            if (data?.answer && !pc.currentRemoteDescription) {
              const answer = new RTCSessionDescription(data.answer);
              pc.setRemoteDescription(answer);
            }
          });

          // Listen for ICE candidates from the callee
          const calleeCandidates = collection(roomRef, "calleeCandidates");
          onSnapshot(calleeCandidates, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              if (change.type === "added") {
                const candidate = new RTCIceCandidate(change.doc.data());
                pc.addIceCandidate(candidate);
              }
            });
          });
        } else {
          // 5B. Participant: Wait for the host's offer, then create answer
          onSnapshot(roomRef, async (snapshot) => {
            const data = snapshot.data();
            if (data?.offer && !pc.currentRemoteDescription) {
              await pc.setRemoteDescription(
                new RTCSessionDescription(data.offer)
              );
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await updateDoc(roomRef, {
                answer: {
                  type: answer.type,
                  sdp: answer.sdp,
                },
              });
            }
          });

          // Listen for ICE candidates from the host
          const callerCandidates = collection(roomRef, "callerCandidates");
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
    })();

    // Cleanup: close peer connection on component unmount
    return () => {
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

      {/* End call button */}
      <div className="p-4">
        <button
          onClick={onMeetingEnd}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          End Call
        </button>
      </div>
    </div>
  );
}
