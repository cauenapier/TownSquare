/**
 * Enable/disable the interactive widget without tearing down the mount.
 */

import { setLocalTyping } from "./chat.mjs";

/**
 * @param {import("./context.mjs").WidgetContext} ctx
 * @param {boolean} quiet
 * @param {(expanded: boolean) => void} setExpanded
 */
export function setQuiet(ctx, quiet, setExpanded) {
  ctx.quiet = quiet;
  if (quiet) setLocalTyping(ctx, false);
  if (quiet) setExpanded(false);
  ctx.app.classList.toggle("townsquare--quiet", quiet);
  ctx.enableToggle.checked = !quiet;
  ctx.enableToggle.setAttribute("aria-label", quiet ? "TownSquare disabled" : "TownSquare enabled");
  ctx.enableToggle.title = quiet ? "Enable TownSquare" : "Disable TownSquare";
  ctx.self.movingLeft = false;
  ctx.self.movingRight = false;
  ctx.self.avatar.composer?.reset();
  if (ctx.self.avatar.composer && ctx.self.avatar.plate) {
    ctx.self.avatar.composer.hidden = true;
    ctx.self.avatar.plate.hidden = false;
  }
}
