const socket = io();

const ageGate = document.getElementById("ageGate");
const chatApp = document.getElementById("chatApp");
const ageCheck = document.getElementById("ageCheck");
const enterBtn = document.getElementById("enterBtn");

const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const reportBtn = document.getElementById("reportBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusEl = document.getElementById("status");

const reportModal = document.getElementById("reportModal");
const reportCategory = document.getElementById("reportCategory");
const reportDetails = document.getElementById("reportDetails");
const cancelReport = document.getElementById("cancelReport");
const submitReport = document.getElementById("submitReport");

let localStream = null;
let peer = null;
let initiator = false;
let inCall = false;
let pendingCandidates = [];

let rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

async function loadTurnCredentials() {
  const response = await fetch(
  "https://college-tv.metered.live/api/v1/turn/credentials?apiKey=8f910d019c6ef76c11e3d3aa822dab96d32a"
);

  if (!response.ok) {
    throw new Error("Could not load TURN credentials");
  }

  const iceServers = await response.json();

  rtcConfig.iceServers = iceServers;

  console.log("TURN credentials loaded");
}

function setStatus(text) {
  statusEl.textContent = text;
}

function closePeer() {
  if (peer) {
    peer.onicecandidate = null;
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    peer.close();
    peer = null;
  }

  pendingCandidates = [];

  remoteVideo.srcObject = null;
  remotePlaceholder.classList.remove("hidden");
  inCall = false;

  nextBtn.disabled = true;
  muteBtn.disabled = true;
  cameraBtn.disabled = true;
}

function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        type: "candidate",
        candidate: event.candidate
      });
    }
  };

  peer.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    remotePlaceholder.classList.add("hidden");
  };

  peer.onconnectionstatechange = () => {
    const state = peer?.connectionState;
    if (state === "connected") {
      setStatus("Connected");
      inCall = true;
      nextBtn.disabled = false;
    } else if (["failed", "disconnected", "closed"].includes(state)) {
      setStatus("Connection ended");
    }
  };

  return peer;
}

async function startCamera() {
  if (localStream) return;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = localStream;
}

async function startSearching() {
  try {
    await startCamera();
    await loadTurnCredentials();
    closePeer();
    setStatus("Finding a stranger…");
    startBtn.disabled = true;
    socket.emit("join-queue");
  } catch (err) {
    console.error(err);
    setStatus("Could not start video chat.");
  }
}

async function handleMatched(data) {
  initiator = !!data.initiator;
  setStatus("Stranger found — connecting…");

  createPeer();

  if (initiator) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("signal", {
      type: "offer",
      description: peer.localDescription
    });
  }
}

socket.on("queue-status", () => {
  setStatus("Waiting for a stranger…");
});

socket.on("matched", handleMatched);

socket.on("signal", async ({ data }) => {
  try {
    if (!peer) createPeer();

    if (data.type === "offer") {
      await peer.setRemoteDescription(
        new RTCSessionDescription(data.description)
      );

      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(candidate);
      }
      pendingCandidates = [];

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("signal", {
        type: "answer",
        description: peer.localDescription
      });
    }

    else if (data.type === "answer") {
      await peer.setRemoteDescription(
        new RTCSessionDescription(data.description)
      );

      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(candidate);
      }
      pendingCandidates = [];
    }

    else if (data.type === "candidate" && data.candidate) {
      const candidate = new RTCIceCandidate(data.candidate);

      if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        pendingCandidates.push(candidate);
      }
    }

  } catch (err) {
    console.error("Signaling error:", err);
    setStatus("Could not establish the connection.");
  }
});

socket.on("partner-left", () => {
  closePeer();
  startBtn.disabled = false;
  setStatus("Stranger left.");
});

socket.on("partner-next", () => {
  closePeer();
  startBtn.disabled = true;
  setStatus("Finding a new stranger…");
});

socket.on("report-received", () => {
  reportModal.classList.add("hidden");
  reportDetails.value = "";
  setStatus("Report submitted. Thank you.");
});

ageCheck.addEventListener("change", () => {
  enterBtn.disabled = !ageCheck.checked;
});

enterBtn.addEventListener("click", () => {
  ageGate.classList.add("hidden");
  chatApp.classList.remove("hidden");
});

startBtn.addEventListener("click", startSearching);

nextBtn.addEventListener("click", () => {
  closePeer();
  setStatus("Finding a new stranger…");
  socket.emit("next");
});

muteBtn.addEventListener("click", () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.textContent = track.enabled ? "Mute" : "Unmute";
});

cameraBtn.addEventListener("click", () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraBtn.textContent = track.enabled ? "Camera Off" : "Camera On";
});

reportBtn.addEventListener("click", () => {
  if (!inCall) {
    setStatus("You can report a stranger during a call.");
    return;
  }
  reportModal.classList.remove("hidden");
});

cancelReport.addEventListener("click", () => {
  reportModal.classList.add("hidden");
});

submitReport.addEventListener("click", () => {
  socket.emit("report", {
    category: reportCategory.value,
    details: reportDetails.value
  });

  // End the interaction after reporting.
  closePeer();
  socket.emit("next");
  setStatus("Report submitted. Finding a new stranger…");
});

window.addEventListener("beforeunload", () => {
  localStream?.getTracks().forEach(track => track.stop());
});
