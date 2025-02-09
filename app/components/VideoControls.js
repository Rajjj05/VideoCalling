// components/VideoControls.js
const VideoControls = ({ isMuted, isVideoOff, toggleAudio, toggleVideo }) => {
  return (
    <div className="controls">
      <button onClick={toggleAudio}>{isMuted ? "Unmute" : "Mute"}</button>
      <button onClick={toggleVideo}>
        {isVideoOff ? "Turn Video On" : "Turn Video Off"}
      </button>
    </div>
  );
};

export default VideoControls;
