const CYCLE_MS = 1200;
const FRAME_STEP = 2;

const tracks = {
  ".figure-core": [
    [0, "translateY(0.6px) rotate(-0.8deg)"],
    [25, "translateY(-0.8px) rotate(0.6deg)"],
    [50, "translateY(0.4px) rotate(0.9deg)"],
    [75, "translateY(-1px) rotate(-0.4deg)"],
    [100, "translateY(0.6px) rotate(-0.8deg)"],
  ],
  ".leg-l": [[0, 18], [18, 10], [35, -6], [50, -18], [68, -10], [85, 8], [100, 18]],
  ".leg-r": [[0, -18], [18, -10], [35, 6], [50, 18], [68, 10], [85, -8], [100, -18]],
  ".knee-l": [[0, 24], [18, 14], [35, 2], [50, 0], [68, 8], [85, 20], [100, 24]],
  ".knee-r": [[0, 0], [18, -8], [35, -20], [50, -24], [68, -14], [85, -2], [100, 0]],
  ".arm-l": [[0, -18], [18, -9], [35, 4], [50, 16], [68, 10], [85, -6], [100, -18]],
  ".arm-r": [[0, 16], [18, 9], [35, -4], [50, -18], [68, -10], [85, 6], [100, 16]],
  ".elbow-l": [[0, 18], [18, 28], [35, 24], [50, 10], [68, 8], [85, 14], [100, 18]],
  ".elbow-r": [[0, -10], [18, -8], [35, -14], [50, -18], [68, -28], [85, -24], [100, -10]],
};

const transformOrigins = {
  ".figure-core": "10px 24px",
  ".arm-l": "9.4px 14px",
  ".arm-r": "10.6px 14px",
  ".elbow-l": "6.1px 20px",
  ".elbow-r": "13.9px 20px",
  ".leg-l": "9.2px 26px",
  ".leg-r": "10.8px 26px",
  ".knee-l": "7.1px 34px",
  ".knee-r": "12.9px 34px",
};

const figure = document.getElementById("walk-figure");
const slider = document.getElementById("frame-slider");
const frameLabel = document.getElementById("frame-label");
const poseReadout = document.getElementById("pose-readout");
const playToggle = document.getElementById("play-toggle");
const prevFrame = document.getElementById("prev-frame");
const nextFrame = document.getElementById("next-frame");
const directionLeft = document.getElementById("direction-left");

if (
  !(figure instanceof SVGSVGElement)
  || !(slider instanceof HTMLInputElement)
  || !(frameLabel instanceof HTMLElement)
  || !(poseReadout instanceof HTMLOutputElement)
  || !(playToggle instanceof HTMLButtonElement)
  || !(prevFrame instanceof HTMLButtonElement)
  || !(nextFrame instanceof HTMLButtonElement)
  || !(directionLeft instanceof HTMLInputElement)
) {
  throw new Error("Walk sandbox controls not found");
}

let frame = Number(slider.value);
let playing = true;
let lastFrameAt = performance.now();
let animationFrame = null;

function interpolate(track, percent) {
  for (let i = 1; i < track.length; i += 1) {
    const previous = track[i - 1];
    const next = track[i];
    if (percent <= next[0]) {
      const range = next[0] - previous[0] || 1;
      const local = (percent - previous[0]) / range;
      return previous[1] + ((next[1] - previous[1]) * local);
    }
  }
  return track[track.length - 1][1];
}

function setTransform(selector, transform) {
  const element = figure.querySelector(selector);
  if (!(element instanceof SVGElement)) return;
  element.style.transform = transform;
  element.style.transformBox = "view-box";
  element.style.transformOrigin = transformOrigins[selector] || "center";
}

function render() {
  const poseFrame = directionLeft.checked ? 100 - frame : frame;

  figure.classList.toggle("walk-figure--left", directionLeft.checked);
  setTransform(".figure-core", sampleBody(poseFrame));

  for (const [selector, track] of Object.entries(tracks)) {
    if (selector === ".figure-core") continue;
    setTransform(selector, `rotate(${interpolate(track, poseFrame).toFixed(2)}deg)`);
  }

  slider.value = String(Math.round(frame));
  frameLabel.textContent = `Frame ${Math.round(frame)}`;
  poseReadout.value = [
    `body ${sampleBody(poseFrame)}`,
    `leg-l ${interpolate(tracks[".leg-l"], poseFrame).toFixed(1)}deg`,
    `leg-r ${interpolate(tracks[".leg-r"], poseFrame).toFixed(1)}deg`,
    `arm-l ${interpolate(tracks[".arm-l"], poseFrame).toFixed(1)}deg`,
    `arm-r ${interpolate(tracks[".arm-r"], poseFrame).toFixed(1)}deg`,
  ].join(" · ");
}

function sampleBody(percent) {
  const bodyTrack = tracks[".figure-core"];
  for (let i = 1; i < bodyTrack.length; i += 1) {
    const previous = bodyTrack[i - 1];
    const next = bodyTrack[i];
    if (percent <= next[0]) {
      const range = next[0] - previous[0] || 1;
      const local = (percent - previous[0]) / range;
      const previousValues = parseBody(previous[1]);
      const nextValues = parseBody(next[1]);
      const y = previousValues.y + ((nextValues.y - previousValues.y) * local);
      const rotate = previousValues.rotate + ((nextValues.rotate - previousValues.rotate) * local);
      return `translateY(${y.toFixed(2)}px) rotate(${rotate.toFixed(2)}deg)`;
    }
  }
  return bodyTrack[bodyTrack.length - 1][1];
}

function parseBody(value) {
  const match = value.match(/translateY\((-?[\d.]+)px\) rotate\((-?[\d.]+)deg\)/);
  if (!match) return { y: 0, rotate: 0 };
  return { y: Number(match[1]), rotate: Number(match[2]) };
}

function setFrame(nextFrame) {
  frame = (nextFrame + 101) % 101;
  render();
}

function setPlaying(nextPlaying) {
  playing = nextPlaying;
  playToggle.textContent = playing ? "Pause" : "Play";
  lastFrameAt = performance.now();
}

function tick(now) {
  if (playing) {
    const dt = now - lastFrameAt;
    setFrame(frame + ((dt / CYCLE_MS) * 100));
  }
  lastFrameAt = now;
  animationFrame = requestAnimationFrame(tick);
}

slider.addEventListener("input", () => {
  setPlaying(false);
  setFrame(Number(slider.value));
});

playToggle.addEventListener("click", () => setPlaying(!playing));
prevFrame.addEventListener("click", () => {
  setPlaying(false);
  setFrame(frame - FRAME_STEP);
});
nextFrame.addEventListener("click", () => {
  setPlaying(false);
  setFrame(frame + FRAME_STEP);
});
directionLeft.addEventListener("change", render);

render();
animationFrame = requestAnimationFrame(tick);

window.addEventListener("pagehide", () => {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
});
