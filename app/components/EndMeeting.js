// EndMeeting.js
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useContext } from "react";
import { MeetingContext } from "../contexts/MeetingContext";

const endMeeting = async (meetingId, user) => {
  const meetingRef = doc(db, "meetings", meetingId);

  await updateDoc(meetingRef, {
    status: "inactive",
  });

  // Update user's active meeting
  const userRef = doc(db, "users", user.uid);
  await updateDoc(userRef, { activeMeeting: null });

  // Update context
  setActiveMeeting(null);
};
