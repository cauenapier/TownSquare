import { mountTownSquare } from "./townsquare.mjs";

const root = document.getElementById("townsquare-root");
if (!root) {
  throw new Error("TownSquare demo root element not found");
}

mountTownSquare(root, {
  socketPath: "/townsquare/live",
});
