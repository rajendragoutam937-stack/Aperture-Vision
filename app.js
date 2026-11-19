const $ = (id) => document.getElementById(id);
const state = { imageData: null, imageName: "", stream: null, detector: null, detecting: false, messages: [] };
const messagesEl = $("chatMessages");

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function addMessage(role, text) {
  const row = document.createElement("div");
  row.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = role === "user" ? "Y" : "A";
  const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = text;
  row.append(avatar, bubble); messagesEl.appendChild(row); messagesEl.scrollTop = messagesEl.scrollHeight;
}
async function checkStatus() {
  try {
    const r = await fetch("/api/status"); const d = await r.json();
    $("statusDot").style.background = d.groqConfigured ? "#39bd82" : "#e6a23c";
    $("statusText").textContent = d.groqConfigured ? "GROQ · CONNECTED" : "ADD GROQ KEY";
  } catch { $("statusText").textContent = "SERVER OFFLINE"; $("statusDot").style.background = "#e45d68"; }
}
checkStatus();

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  $("themeBtn").textContent = document.body.classList.contains("dark") ? "☀" : "☾";
});

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  state.stream = null; state.detecting = false;
  $("cameraVideo").hidden = true; $("stopCameraBtn").disabled = true;
  $("cameraBtn").disabled = false; $("previewImage").hidden = !state.imageData;
  if (!state.imageData) $("emptyState").hidden = false;
  $("detectCanvas").hidden = true;
}
$("cameraBtn").addEventListener("click", async () => {
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    $("cameraVideo").srcObject = state.stream; $("cameraVideo").hidden = false;
    $("previewImage").hidden = true; $("emptyState").hidden = true;
    $("stopCameraBtn").disabled = false; $("cameraBtn").disabled = true;
    $("detectCanvas").hidden = false; $("stageBadge").hidden = false;
    $("chatContext").textContent = "Camera is active. Object detection runs locally in your browser. Capture/upload an image to ask Groq about visual details.";
  } catch (e) { toast("Camera permission was blocked or no camera was found."); }
});
$("stopCameraBtn").addEventListener("click", stopCamera);

$("imageInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast("Please choose an image smaller than 8 MB."); return; }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast("Use JPG, PNG or WEBP."); return; }
  stopCamera();
  const reader = new FileReader();
  reader.onload = () => {
    state.imageData = reader.result; state.imageName = file.name;
    $("previewImage").src = state.imageData; $("previewImage").hidden = false;
    $("emptyState").hidden = true; $("stageBadge").hidden = false;
    $("stageBadge").textContent = "IMAGE READY";
    $("detectBtn").disabled = false;
    $("chatContext").textContent = `Image loaded: ${file.name}. Ask a question to analyze it with Groq Vision.`;
    addMessage("assistant", "Image loaded. You can ask me to describe it, identify something, or answer a question about it.");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

$("clearBtn").addEventListener("click", () => {
  stopCamera(); state.imageData = null; state.imageName = "";
  $("previewImage").hidden = true; $("emptyState").hidden = false;
  $("stageBadge").hidden = true; $("detectBtn").disabled = true;
  $("objectCount").textContent = "0"; $("detectionList").textContent = "No detections yet";
  $("chatContext").textContent = "Upload an image to ask questions about it, or start a conversation.";
  const ctx = $("detectCanvas").getContext("2d"); ctx.clearRect(0,0,$("detectCanvas").width,$("detectCanvas").height);
});

async function getDetector() {
  if (state.detector) return state.detector;
  if (!window.cocoSsd) throw new Error("Object detection library did not load. Check your internet connection and refresh.");
  toast("Loading object detection model…");
  state.detector = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  return state.detector;
}
function drawBoxes(predictions, source, canvas) {
  const rect = source.getBoundingClientRect();
  const width = source.videoWidth || source.naturalWidth || rect.width;
  const height = source.videoHeight || source.naturalHeight || rect.height;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0,0,width,height);
  ctx.lineWidth = Math.max(2, width / 450); ctx.font = `${Math.max(13,width/55)}px DM Sans`;
  predictions.forEach(p => {
    const [x,y,w,h] = p.bbox;
    ctx.strokeStyle = "#766cff"; ctx.fillStyle = "#766cff"; ctx.strokeRect(x,y,w,h);
    const label = `${p.class} ${Math.round(p.score*100)}%`;
    const tw = ctx.measureText(label).width + 12;
    ctx.fillRect(x, Math.max(0,y-25), tw, 23); ctx.fillStyle = "#fff"; ctx.fillText(label,x+6,Math.max(16,y-9));
  });
  $("objectCount").textContent = predictions.length;
  $("detectionList").textContent = predictions.length ? predictions.map(p => `${p.class} (${Math.round(p.score*100)}%)`).join(" · ") : "No common objects detected";
}
$("detectBtn").addEventListener("click", async () => {
  if (!state.imageData) return;
  try {
    const model = await getDetector();
    const predictions = await model.detect($("previewImage"));
    drawBoxes(predictions, $("previewImage"), $("detectCanvas"));
    $("detectCanvas").hidden = false; $("stageBadge").textContent = "LOCAL DETECTION";
    toast(`Detected ${predictions.length} object(s).`);
  } catch (e) { toast(e.message); }
});

let cameraLoop = false;
async function runCameraDetection() {
  if (!state.stream || cameraLoop) return;
  cameraLoop = true;
  try {
    const model = await getDetector();
    const video = $("cameraVideo"), canvas = $("detectCanvas");
    async function frame() {
      if (!state.stream || !cameraLoop) { cameraLoop = false; return; }
      if (video.readyState >= 2) {
        const predictions = await model.detect(video);
        drawBoxes(predictions, video, canvas);
      }
      requestAnimationFrame(frame);
    }
    frame();
  } catch (e) { cameraLoop = false; toast(e.message); }
}
$("cameraBtn").addEventListener("click", () => setTimeout(runCameraDetection, 700));
$("stopCameraBtn").addEventListener("click", () => { cameraLoop = false; });

async function sendChat(text) {
  const prompt = text.trim(); if (!prompt) return;
  addMessage("user", prompt);
  state.messages.push({ role: "user", content: prompt });
  $("chatInput").value = "";
  const waiting = document.createElement("div"); waiting.className = "message assistant-message";
  waiting.innerHTML = '<div class="avatar">A</div><div class="bubble">Thinking…</div>';
  messagesEl.appendChild(waiting); messagesEl.scrollTop = messagesEl.scrollHeight;
  try {
    const payload = { messages: state.messages, image: state.imageData || undefined };
    const response = await fetch("/api/chat", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    const data = await response.json();
    waiting.remove();
    if (!response.ok) throw new Error(data.error || "AI request failed.");
    state.messages.push({ role:"assistant", content:data.answer });
    addMessage("assistant", data.answer);
  } catch (e) {
    waiting.remove(); addMessage("assistant", `I couldn't complete that request: ${e.message}`);
  }
}
$("chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat($("chatInput").value); });
$("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chatForm").requestSubmit(); }
});
document.querySelectorAll(".suggestion").forEach(btn => btn.addEventListener("click", () => sendChat(btn.textContent)));

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  $("micBtn").addEventListener("click", () => {
    const recognition = new SpeechRecognition(); recognition.lang = "en-IN"; recognition.interimResults = false;
    recognition.onresult = e => { $("chatInput").value = e.results[0][0].transcript; $("chatInput").focus(); };
    recognition.onerror = () => toast("Voice input was unavailable.");
    recognition.start(); toast("Listening…");
  });
} else {
  $("micBtn").addEventListener("click", () => toast("Voice input is not supported in this browser. Try Chrome."));
}
