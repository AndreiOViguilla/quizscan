from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
import json
import re

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        # Parse query params
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        video_id = None

        # Get videoId directly
        if "videoId" in params:
            video_id = params["videoId"][0]

        # Or extract from url param
        elif "url" in params:
            url = params["url"][0]
            match = re.search(r"(?:v=|youtu\.be/|embed/)([a-zA-Z0-9_-]{11})", url)
            if match:
                video_id = match.group(1)

        if not video_id:
            self._respond(400, {"error": "Missing videoId or url parameter"})
            return

        try:
            # Try English first, then any available language
            try:
                transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US", "en-GB"])
            except NoTranscriptFound:
                # Fall back to any available language
                transcript_list = YouTubeTranscriptApi.get_transcript(video_id)

            # Join all text segments
            text = " ".join(
                entry["text"].strip()
                for entry in transcript_list
                if entry.get("text", "").strip()
            )

            # Clean up
            text = re.sub(r"\[.*?\]", "", text)  # remove [Music] [Applause] etc
            text = re.sub(r"\s+", " ", text).strip()

            if not text:
                self._respond(404, {"error": "Transcript was empty"})
                return

            self._respond(200, {
                "videoId": video_id,
                "text": text,
                "wordCount": len(text.split()),
                "segments": len(transcript_list)
            })

        except TranscriptsDisabled:
            self._respond(404, {"error": "Transcripts are disabled for this video."})
        except VideoUnavailable:
            self._respond(404, {"error": "Video is unavailable or private."})
        except NoTranscriptFound:
            self._respond(404, {"error": "No transcript found. The video may not have captions."})
        except Exception as e:
            self._respond(500, {"error": f"Failed to fetch transcript: {str(e)}"})

    def _respond(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # suppress default logging
