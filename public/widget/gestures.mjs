/**
 * Scene prop rendering plus avatar movement and gesture state.
 */

import { HIGH_FIVE_MS, JUMP_MS, POSE_STAND_MS, RAISED_HAND_MS } from "./constants.mjs";

/**
 * @param {HTMLElement} container
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} props
 */
export function renderProps(container, props = []) {
  for (const prop of props) {
    const el = document.createElement("div");
    el.className = `prop prop--${prop.kind}`;
    el.style.left = `${(prop.x * 100).toFixed(2)}%`;
    el.style.width = `${prop.width}px`;
    el.style.height = `${prop.height}px`;
    el.innerHTML = prop.svg;
    if (prop.lightRadius) {
      const light = document.createElement("div");
      light.className = "prop__light";
      light.setAttribute("aria-hidden", "true");
      el.appendChild(light);
    }
    container.appendChild(el);
  }
}

/**
 * @param {AvatarView} avatar
 * @param {number} x
 */
export function renderAvatar(avatar, x) {
  avatar.el.style.left = `${(x * 100).toFixed(2)}%`;
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} movingLeft
 */
export function setFacing(avatar, movingLeft) {
  avatar.el.classList.toggle("townsquare-avatar--flipped", movingLeft);
}

/**
 * @param {AvatarView} avatar
 * @param {boolean} walking
 */
export function setWalking(avatar, walking) {
  if (walking) clearHighFiveState(avatar);
  avatar.el.classList.toggle("townsquare-avatar--walking", walking);
}

/**
 * @param {AvatarView} avatar
 */
export function playJump(avatar) {
  avatar.el.classList.remove("townsquare-avatar--jumping");
  clearTimeout(avatar.jumpTimer);
  void avatar.el.offsetWidth;
  avatar.el.classList.add("townsquare-avatar--jumping");
  avatar.jumpTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--jumping");
    avatar.jumpTimer = null;
  }, JUMP_MS);
}

/**
 * @param {AvatarView} avatar
 */
export function clearRaisedHand(avatar) {
  clearTimeout(avatar.raisedHandTimer);
  avatar.raisedHandTimer = null;
  avatar.el.classList.remove("townsquare-avatar--raised-hand");
}

/**
 * @param {AvatarView} avatar
 */
export function clearHighFiveState(avatar) {
  clearRaisedHand(avatar);
  clearTimeout(avatar.highFiveTimer);
  avatar.highFiveTimer = null;
  avatar.el.classList.remove("townsquare-avatar--high-five");
}

/**
 * @param {AvatarView} avatar
 */
export function playRaisedHand(avatar) {
  clearTimeout(avatar.raisedHandTimer);
  avatar.el.classList.add("townsquare-avatar--raised-hand");
  avatar.raisedHandTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--raised-hand");
    avatar.raisedHandTimer = null;
  }, RAISED_HAND_MS);
}

/**
 * @param {AvatarView} avatar
 */
export function playHighFive(avatar) {
  clearHighFiveState(avatar);
  void avatar.el.offsetWidth;
  avatar.el.classList.add("townsquare-avatar--high-five");
  avatar.highFiveTimer = setTimeout(() => {
    avatar.el.classList.remove("townsquare-avatar--high-five");
    avatar.highFiveTimer = null;
  }, HIGH_FIVE_MS);
}

/**
 * @param {{ pose: string | null }} presence
 * @returns {boolean}
 */
export function needsStandUp(presence) {
  return presence.pose === "sitting" || presence.pose === "resting";
}

/**
 * @param {{ pose: string | null, propId: string | null, avatar: AvatarView, x: number }} presence
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} sceneProps
 */
export function clearPresencePose(presence, sceneProps) {
  presence.pose = null;
  presence.propId = null;
  updatePose(presence.avatar, presence.pose);
  updatePropEffects(presence.avatar, presence.x, presence.propId, sceneProps);
  setWalking(presence.avatar, false);
}

/**
 * @param {{ avatar: AvatarView, x: number }} initiator
 * @param {{ avatar: AvatarView, x: number }} target
 * @param {boolean} standUpFirst
 */
export function playHighFivePair(initiator, target, standUpFirst) {
  const play = () => {
    setFacing(initiator.avatar, target.x < initiator.x);
    setFacing(target.avatar, initiator.x < target.x);
    playHighFive(initiator.avatar);
    playHighFive(target.avatar);
  };
  if (standUpFirst) {
    setTimeout(play, POSE_STAND_MS);
  } else {
    play();
  }
}

/**
 * @param {AvatarView} avatar
 * @param {string | null} pose
 */
export function updatePose(avatar, pose) {
  avatar.el.classList.toggle("townsquare-avatar--sitting", pose === "sitting");
  avatar.el.classList.toggle("townsquare-avatar--resting", pose === "resting");
  if (pose) {
    setWalking(avatar, false);
  }
}

/**
 * @param {AvatarView} avatar
 * @param {number} x
 * @param {string | null} propId
 * @param {Array<import("../shared/scene-props.mjs").SceneProp>} props
 */
export function updatePropEffects(avatar, x, propId, props = []) {
  const activeProp = props.find((prop) => prop.id === propId);
  if (activeProp?.faceAway) {
    setFacing(avatar, x >= activeProp.x);
  }

  avatar.el.classList.toggle(
    "townsquare-avatar--shaded",
    props.some((prop) => prop.shadeRadius && Math.abs(x - prop.x) < prop.shadeRadius),
  );
  avatar.el.classList.toggle(
    "townsquare-avatar--lit",
    props.some((prop) => prop.lightRadius && Math.abs(x - prop.x) < prop.lightRadius),
  );
}
