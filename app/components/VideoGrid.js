// components/VideoGrid.js
const VideoGrid = ({ localStream, remoteStreams }) => {
  return (
    <div className="video-grid">
      <video
        ref={(ref) => {
          if (ref && localStream) ref.srcObject = localStream;
        }}
        autoPlay
        muted
        style={{ width: "300px", height: "auto" }}
      />
      {remoteStreams.map((stream, index) => (
        <video
          key={index}
          ref={(ref) => {
            if (ref) ref.srcObject = stream;
          }}
          autoPlay
          style={{ width: "300px", height: "auto" }}
        />
      ))}
    </div>
  );
};

export default VideoGrid;
