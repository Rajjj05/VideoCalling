import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  orderBy,
  Timestamp,
  doc,
  updateDoc
} from 'firebase/firestore';

// Notes Collection Functions
export const saveNote = async (meetingId, userId, content) => {
  try {
    const noteData = {
      meetingId,
      userId,
      content,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    
    const docRef = await addDoc(collection(db, 'notes'), noteData);
    return docRef.id;
  } catch (error) {
    console.error('Error saving note:', error);
    throw error;
  }
};

export const getUserNotes = async (userId) => {
  try {
    const q = query(
      collection(db, 'notes'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching notes:', error);
    throw error;
  }
};

export const updateNote = async (noteId, content) => {
  try {
    const noteRef = doc(db, 'notes', noteId);
    await updateDoc(noteRef, {
      content,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    console.error('Error updating note:', error);
    throw error;
  }
};

// Meeting History Functions
export const saveMeetingHistory = async (userId, meetingId, duration) => {
  try {
    const meetingData = {
      userId,
      meetingId,
      duration,
      joinedAt: Timestamp.now()
    };
    
    const docRef = await addDoc(collection(db, 'meetingHistory'), meetingData);
    return docRef.id;
  } catch (error) {
    console.error('Error saving meeting history:', error);
    throw error;
  }
};

export const getUserMeetingHistory = async (userId) => {
  try {
    const q = query(
      collection(db, 'meetingHistory'),
      where('userId', '==', userId),
      orderBy('joinedAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching meeting history:', error);
    throw error;
  }
}; 