import { useApp } from "../context/AppContext";

export default function LoadingPage() {
  const { tab } = useApp();
  const hints = {
    pdf: "Reading your PDF pages...",
    image: "Scanning image content...",
    url: "Fetching URL content...",
    youtube: "Fetching video transcript...",
    topic: "Generating from topic...",
    text: "Analyzing your text...",
  };
  return (
    <div className="page">
      <div className="loading-screen">
        <div className="loading-title">Generating...</div>
        <div className="loading-bar-wrap">
          <div className="loading-bar" />
        </div>
        <div className="loading-hint">{hints[tab] || "Crafting questions..."}</div>
      </div>
    </div>
  );
}
